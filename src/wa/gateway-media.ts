import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { proto, resolveMediaPayload } from 'zapo-js'
import type { WaIncomingMessageEvent } from 'zapo-js'
import { GatewayStateBase } from './gateway-state.js'
import { MEDIA_DIR } from './paths.js'
import { extForMimetype, sanitizeBase, sanitizeJidForPath } from './paths.js'
import { hasAudioPlayer, openExternalFile, playAudioFile } from './media-os.js'
import { errorMessage } from './decode.js'
import type { ThreadData, WaMediaInfo, WaMsg, WaPlaybackState, WaReplyRef } from './types.js'

/** Media cache, download/open/play pipeline and voice-note playback state. */
export class GatewayMediaBase extends GatewayStateBase {
  /** Raw proto per message for download/open (key `${jid}\n${id}`). mediaKey lives here, never logged. */
  protected mediaSources = new Map<string, proto.Message>()
  /** Full live events for reupload-capable retry (only live messages). */
  protected mediaEvents = new Map<string, WaIncomingMessageEvent>()
  /** Message id under the cursor per chat (synced from MessageList hover). */
  protected hoveredMedia = new Map<string, string>()
  /** Last clicked media per chat — keyboard o/d/p prefers it. */
  protected activeMedia = new Map<string, string>()

  private mediaMapKey(jid: string, id: string): string {
    return `${jid}\n${id}`
  }

  /** FIFO-trim a cache: Maps/Sets iterate in insertion order, so the head is oldest. */
  private trimCache(cache: Map<unknown, unknown> | Set<unknown>, max: number): void {
    if (cache.size <= max) return
    let drop = cache.size - max
    for (const k of cache.keys()) {
      cache.delete(k as never)
      if (--drop <= 0) break
    }
  }

  protected rememberMedia(jid: string, id: string, message?: unknown, event?: WaIncomingMessageEvent | null): void {
    try {
      if (message && typeof message === 'object') {
        this.mediaSources.set(this.mediaMapKey(jid, id), message as proto.Message)
        this.trimCache(this.mediaSources, 400)
      }
      if (event) {
        this.mediaEvents.set(this.mediaMapKey(jid, id), event)
        this.trimCache(this.mediaEvents, 400)
      }
    } catch {
    }
  }

  getMessage(jid: string, id: string): WaMsg | undefined {
    return this.threads.get(jid)?.messages.find((m) => m.id === id)
  }

  /** Most recent openable media in a thread (for `o/d/p` keyboard shortcuts). */
  findLastMedia(jid: string): WaMsg | undefined {
    const t = this.threads.get(jid)
    if (!t) return undefined
    for (let i = t.messages.length - 1; i >= 0; i -= 1) {
      const m = t.messages[i]!
      if (m.media && !m.media.unavailableKind && (m.media.downloadable || m.media.localPath)) return m
    }
    return undefined
  }

  setHoveredMedia(jid: string, id: string | null): void {
    if (id) this.hoveredMedia.set(jid, id)
    else this.hoveredMedia.delete(jid)
  }

  setActiveMedia(jid: string, id: string): void {
    this.activeMedia.set(jid, id)
  }

  /** Cursor/click-directed media target: hovered → clicked → most recent. */
  resolveMediaTarget(jid: string): WaMsg | undefined {
    const t = this.threads.get(jid)
    if (!t) return undefined
    const pick = (id: string | undefined): WaMsg | undefined => {
      if (!id) return undefined
      const m = t.messages.find((x) => x.id === id)
      if (m?.media && !m.media.unavailableKind && (m.media.downloadable || m.media.localPath)) return m
      return undefined
    }
    return pick(this.hoveredMedia.get(jid)) ?? pick(this.activeMedia.get(jid)) ?? this.findLastMedia(jid)
  }

  /** Reply target: hovered/clicked message → most recent message in the chat. */
  resolveReplyTarget(jid: string): WaReplyRef | undefined {
    const t = this.threads.get(jid)
    if (!t) return undefined
    const pick = (id: string | undefined): WaMsg | undefined => {
      if (!id) return undefined
      const m = t.messages.find((x) => x.id === id)
      return m && !m.system ? m : undefined
    }
    const m = pick(this.hoveredMedia.get(jid)) ?? pick(this.activeMedia.get(jid))
      ?? [...t.messages].reverse().find((x) => !x.system)
    if (!m) return undefined
    const senderName = m.senderName ?? (m.fromMe ? 'you' : 'them')
    return {
      id: m.id,
      fromMe: m.fromMe,
      ...(m.senderJid ? { participant: m.senderJid } : {}),
      senderName,
      text: m.text,
    }
  }

  /** Download (or reuse cached) media bytes to `.media/<chat>/<id>_<name>`. Returns absolute path. */
  async ensureMediaFile(jid: string, id: string): Promise<string> {
    const t = this.threads.get(jid)
    const msg = t?.messages.find((m) => m.id === id)
    if (!msg?.media) throw new Error('Message has no media')
    if (msg.media.unavailableKind) {
      if (msg.media.unavailableKind === 'view_once') throw new Error('View-once no longer available (already opened elsewhere)')
      throw new Error('Media no longer available on server')
    }
    if (!msg.media.downloadable) throw new Error('This message type cannot be downloaded')
    if (msg.media.localPath && existsSync(msg.media.localPath)) {
      if (msg.media.viewOnce && !msg.media.opened) {
        msg.media.opened = true
        this.bump(t!)
      }
      return msg.media.localPath
    }
    if (this.state.demo) throw new Error('Demo mode: media download is disabled')
    const client = this.client
    if (!client) throw new Error('Not connected')
    const key = this.mediaMapKey(jid, id)
    // One download per message: concurrent open+play taps share the same promise.
    const inflight = this.downloadInflight.get(key)
    if (inflight) return inflight
    const run = this.downloadMediaFile(jid, id)
    this.downloadInflight.set(key, run)
    try {
      return await run
    } finally {
      this.downloadInflight.delete(key)
    }
  }

  /** In-flight downloads by media key — concurrent taps share one promise. */
  private downloadInflight = new Map<string, Promise<string>>()

  private async downloadMediaFile(jid: string, id: string): Promise<string> {
    const client = this.client
    const t = this.threads.get(jid)
    const msg = t?.messages.find((m) => m.id === id)
    if (!msg?.media || !client || !t) throw new Error('Download no longer available')
    const key = this.mediaMapKey(jid, id)
    const source = this.mediaSources.get(key)
    if (!source) throw new Error('Media source expired (history message without proto). Ask sender to resend.')
    try {
      const payload = resolveMediaPayload(source as never)
      if (!payload) throw new Error('No downloadable media in this message')
    } catch (e) {
      if ((e as Error)?.message?.startsWith('No downloadable')) throw e
    }
    mkdirSync(MEDIA_DIR, { recursive: true })
    const chatDir = resolvePath(MEDIA_DIR, sanitizeJidForPath(jid))
    mkdirSync(chatDir, { recursive: true })
    const mimeExt = extForMimetype(msg.media.mimetype)
    const fallbackName =
      msg.media.fileName ??
      (msg.media.kind === 'image'
        ? `photo${mimeExt || '.jpg'}`
        : msg.media.kind === 'video' || msg.media.kind === 'gif'
          ? `video${mimeExt || '.mp4'}`
          : msg.media.kind === 'ptv'
            ? `ptv${mimeExt || '.mp4'}`
            : msg.media.kind === 'voice' || msg.media.kind === 'audio'
              ? `audio${mimeExt || '.ogg'}`
              : msg.media.kind === 'sticker'
                ? `sticker${mimeExt || '.webp'}`
                : `file${mimeExt || ''}`)
    const fileName = `${sanitizeBase(id)}_${sanitizeBase(fallbackName)}`
    const dest = resolvePath(chatDir, fileName)
    const dlSource = this.mediaEvents.get(key) ?? (source as never)
    this.set({ download: { jid, id, label: fileName } })
    try {
      await client.message.downloadToFile(dlSource as never, dest, { timeoutMs: 120_000 })
    } catch (err) {
      const msgText = (err as Error)?.message ?? String(err)
      const looksExpired = /404|410|not.?found|expired|no such|gone/i.test(msgText)
      const liveEvent = this.mediaEvents.get(key)
      if (looksExpired && liveEvent) {
        try {
          this.set({ note: 'Media expired — requesting reupload…' })
          const retry = await client.message.requestMediaReupload(liveEvent as never, { timeoutMs: 30_000 })
          if (retry.result !== 'success') throw new Error(`reupload ${retry.result}`)
          await client.message.downloadToFile(liveEvent as never, dest, { timeoutMs: 120_000 })
        } catch (reErr) {
          try {
            unlinkSync(dest)
          } catch {
            // partial file may not exist — nothing to clean
          }
          throw new Error(`Download failed even after reupload: ${errorMessage(reErr) || msgText}`)
        }
      } else {
        try {
          unlinkSync(dest)
        } catch {
          // partial file may not exist — nothing to clean
        }
        throw new Error(`Download failed: ${msgText}`)
      }
    } finally {
      this.set({ download: null })
    }
    msg.media.localPath = dest
    if (msg.media.viewOnce) msg.media.opened = true
    this.bump(t!)
    return dest
  }

  async openMedia(jid: string, id: string): Promise<string> {
    const path = await this.ensureMediaFile(jid, id)
    if (!openExternalFile(path)) throw new Error(`No viewer to open it here (headless?) — file at ${path}`)
    return path
  }

  protected playback: WaPlaybackState | null = null
  protected playbackTimer: ReturnType<typeof setTimeout> | null = null
  protected playbackChild: { kill(): void } | null = null
  private playbackListeners = new Set<() => void>()

  subscribePlayback = (listener: () => void): (() => void) => {
    this.playbackListeners.add(listener)
    return () => {
      this.playbackListeners.delete(listener)
    }
  }

  getPlaybackSnapshot = (): WaPlaybackState | null => this.playback

  protected setPlayback(p: WaPlaybackState | null): void {
    this.playback = p
    for (const listener of this.playbackListeners) listener()
  }

  protected stopPlayback(): void {
    if (this.playbackTimer !== null) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
    this.playbackChild?.kill()
    this.playbackChild = null
    if (this.playback) this.setPlayback(null)
  }

  /** Play/pause toggle, like tapping a voice note on the phone. */
  async togglePlayMedia(jid: string, id: string): Promise<'playing' | 'paused'> {
    if (this.playback?.jid === jid && this.playback.id === id) {
      this.stopPlayback()
      return 'paused'
    }
    this.stopPlayback()
    const path = await this.ensureMediaFile(jid, id)
    if (!hasAudioPlayer(path)) throw new Error(`No audio player (mpv/ffplay) — file at ${path}`)
    const msg = this.getMessage(jid, id)
    const durationSec = msg?.media?.durationSec ?? 0
    this.setPlayback({ jid, id, durationSec, startedAtMs: Date.now() })
    this.playbackChild = playAudioFile(path)
    if (durationSec > 0) {
      this.playbackTimer = setTimeout(() => {
        this.playbackTimer = null
        this.setPlayback(null)
      }, durationSec * 1000 + 250)
    }
    return 'playing'
  }

  async downloadMedia(jid: string, id: string): Promise<string> {
    return this.ensureMediaFile(jid, id)
  }

  /** Clear per-account caches so a new login starts with a clean slate (WA Web behavior). */
  protected clearMediaCaches(): void {
    this.mediaSources.clear()
    this.mediaEvents.clear()
    this.hoveredMedia.clear()
    this.activeMedia.clear()
    this.stopPlayback()
  }
}

export type { ThreadData, WaMediaInfo }
