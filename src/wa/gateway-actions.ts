import { existsSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { GatewayProfileBase } from './gateway-profile.js'
import { getSettings } from '../config.js'
import { displayJid } from '../format.js'
import { errorMessage } from './decode.js'
import { expandHome, guessMimetype } from './paths.js'
import type { MediaKind, Screen, ThreadData, WaMediaInfo } from './types.js'

export class GatewayActionsBase extends GatewayProfileBase {
  async activateChat(jid: string, resubscribe = false): Promise<void> {
    const t = this.thread(jid)
    this.activeJid = jid
    let changed = false
    if (this.state.activeJid !== jid) {
      this.set({ activeJid: jid })
    }
    if (t.unread > 0) {
      t.unread = 0
      changed = true
      void this.markThreadRead(jid)
    }
    if (resubscribe && !jid.endsWith('@newsletter') && this.client) {
      try {
        await this.client.presence.subscribe(jid)
      } catch {
      }
    }
    if (changed) this.bump(t)
    if (jid.endsWith('@newsletter')) {
      void this.openChannel(jid)
      return
    }
    if (
      getSettings().autoLoadHistory &&
      t.messages.length === 0 &&
      !t.historyRequested &&
      !t.exhausted &&
      this.client
    ) {
      t.historyRequested = true
      this.bump(t)
      void this.requestOlderMessages(jid)
    }
  }

  /** Page older history for a chat — like WhatsApp Web's on-demand backfill. */
  async requestOlderMessages(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    const client = this.client
    if (!t || t.loadingOlder || t.exhausted) return
    if (this.state.demo) {
      if (this.handleDemoLoadOlder(jid)) return
    }
    if (!client) return
    const pageSize = Math.max(10, Math.min(100, getSettings().historyPageSize || 50))
    const oldest = t.messages[0]
    t.loadingOlder = true
    this.bump(t)
    this.oldestBeforeRequest.set(jid, oldest?.id ?? null)
    const input = oldest
      ? {
          chatJid: jid,
          oldestMsgId: oldest.id,
          oldestMsgFromMe: oldest.fromMe,
          oldestMsgTimestampMs: oldest.ts,
          count: pageSize,
        }
      : { chatJid: jid, count: pageSize }
    try {
      await client.message.requestHistorySync(input)
    } catch {
      t.loadingOlder = false
      this.oldestBeforeRequest.delete(jid)
      this.bump(t)
    }
  }

  async send(jid: string, text: string): Promise<void> {
    const client = this.client
    const trimmed = text.trim()
    if (!trimmed) return
    const t = this.thread(jid)
    if (this.state.demo) {
      if (this.handleDemoSend(t, trimmed)) return
    }
    if (!client) {
      t.messages.push({ id: `local-${Date.now()}`, fromMe: true, text: trimmed, ts: Date.now(), status: 'failed' })
      t.lastTs = Date.now()
      this.bump(t)
      return
    }
    const pendingId = `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    t.messages.push({ id: pendingId, fromMe: true, text: trimmed, ts: Date.now(), status: 'pending' })
    t.lastTs = Date.now()
    this.bump(t)
    if (jid.endsWith('@newsletter')) {
      try {
        const result = (await client.newsletter.send(jid, trimmed)) as unknown as { stanzaId?: string; id?: string }
        const msg = t.messages.find((m) => m.id === pendingId)
        if (msg) {
          msg.id = result.stanzaId ?? result.id ?? pendingId
          msg.status = 'sent'
        }
      } catch {
        const msg = t.messages.find((m) => m.id === pendingId)
        if (msg) msg.status = 'failed'
      }
      this.bump(t)
      return
    }
    try {
      const result = await client.message.send(jid, trimmed)
      const msg = t.messages.find((m) => m.id === pendingId)
      if (msg) {
        msg.id = result.id
        msg.status = 'sent'
      }
      this.bump(t)
    } catch {
      const msg = t.messages.find((m) => m.id === pendingId)
      if (msg) msg.status = 'failed'
      this.bump(t)
    }
  }

  protected typingSentFor = new Map<string, ReturnType<typeof setTimeout>>()

  /** Demo hooks — overridden by the demo layer; base is a no-op. */
  protected handleDemoSend(_t: ThreadData, _text: string): boolean {
    return false
  }

  protected handleDemoLoadOlder(_jid: string): boolean {
    return false
  }

  /** Attach and send media — /img /vid /gif /ptv /aud /vn /doc /stk from the input box. */
  async sendMedia(jid: string, kind: MediaKind, rawPath: string, caption?: string, opts?: { viewOnce?: boolean }): Promise<void> {
    const client = this.client
    const t = this.thread(jid)
    const abs = expandHome(rawPath)
    const fileBase = basename(abs)
    const viewOnce = opts?.viewOnce === true
    const onceSuffix = viewOnce ? ' · 👁️ once' : ''
    const icons: Record<MediaKind, string> = {
      image: '[📷 photo]',
      video: '[🎬 video]',
      gif: '[🎞️ gif]',
      ptv: '[⭕ video note]',
      audio: '[🎧 audio]',
      voice: '[🎤 voice]',
      document: `[📄 ${fileBase}]`,
      sticker: '[✨ sticker]',
    }
    const baseIcon = icons[kind] ?? '[📎 media]'
    const placeholder = (caption ? `${baseIcon} ${caption}` : baseIcon) + onceSuffix

    const mediaInfo: WaMediaInfo = {
      kind: kind === 'voice' ? 'voice' : kind === 'gif' ? 'gif' : kind,
      caption,
      fileName: kind === 'document' ? fileBase : undefined,
      viewOnce: viewOnce || undefined,
      localPath: abs,
      downloadable: false,
    }

    if (this.state.demo) {
      t.messages.push({ id: `demo-media-${Date.now()}`, fromMe: true, text: placeholder, ts: Date.now(), status: 'read', media: mediaInfo })
      t.lastTs = Date.now()
      this.bump(t)
      return
    }

    if (!client) {
      t.messages.push({ id: `media-${Date.now()}`, fromMe: true, text: `${placeholder} · send failed: not connected`, ts: Date.now(), status: 'failed', media: mediaInfo })
      t.lastTs = Date.now()
      this.bump(t)
      return
    }

    if (!existsSync(abs)) {
      t.messages.push({ id: `err-${Date.now()}`, fromMe: false, text: `File not found: ${abs}`, ts: Date.now(), status: 'read', system: true })
      this.bump(t)
      return
    }

    const pendingId = `media-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    t.messages.push({ id: pendingId, fromMe: true, text: placeholder, ts: Date.now(), status: 'pending', media: mediaInfo })
    t.lastTs = Date.now()
    this.bump(t)

    const mimetype = guessMimetype(abs, kind)
    const sendOpts = viewOnce ? { viewOnce: true } : undefined
    try {
      let content: Record<string, unknown>
      if (kind === 'image') content = { type: 'image', media: abs, mimetype, caption }
      else if (kind === 'video') {
        const isGif = extname(abs).toLowerCase() === '.gif'
        content = isGif
          ? { type: 'video', media: abs, mimetype: mimetype === 'application/octet-stream' ? 'image/gif' : mimetype, caption, gifPlayback: true }
          : { type: 'video', media: abs, mimetype, caption }
      } else if (kind === 'gif') content = { type: 'video', media: abs, mimetype: mimetype === 'application/octet-stream' ? 'image/gif' : mimetype, caption, gifPlayback: true }
      else if (kind === 'ptv') content = { type: 'ptv', media: abs, mimetype }
      else if (kind === 'voice') content = { type: 'audio', media: abs, mimetype, ptt: true }
      else if (kind === 'audio') content = { type: 'audio', media: abs, mimetype }
      else if (kind === 'sticker') content = { type: 'sticker', media: abs, mimetype: mimetype === 'application/octet-stream' ? 'image/webp' : mimetype }
      else content = { type: 'document', media: abs, mimetype, fileName: fileBase, caption }
      const result = await client.message.send(jid, content as never, sendOpts as never)
      const msg = t.messages.find((m) => m.id === pendingId)
      if (msg) {
        msg.id = result.id
        msg.status = 'sent'
      }
      this.bump(t)
    } catch (err) {
      const msg = t.messages.find((m) => m.id === pendingId)
      if (msg) msg.status = 'failed'
      t.messages.push({ id: `err-${Date.now()}`, fromMe: false, text: `Send failed: ${errorMessage(err)}`, ts: Date.now(), status: 'read', system: true })
      this.bump(t)
    }
  }

  async setTyping(jid: string, typing: boolean): Promise<void> {
    const client = this.client
    if (!client || this.state.demo || !getSettings().typingIndicator) return
    const prev = this.typingSentFor.get(jid)
    if (prev) {
      clearTimeout(prev)
      this.typingSentFor.delete(jid)
    }
    if (!typing) {
      client.presence.sendChatstate(jid, { state: 'paused' }).catch(() => undefined)
      return
    }
    this.typingSentFor.set(
      jid,
      setTimeout(() => {
        this.typingSentFor.delete(jid)
        client.presence.sendChatstate(jid, { state: 'composing' }).catch(() => undefined)
        this.typingSentFor.set(
          jid,
          setTimeout(() => {
            this.typingSentFor.delete(jid)
            client.presence.sendChatstate(jid, { state: 'paused' }).catch(() => undefined)
          }, 3_000),
        )
      }, 400),
    )
  }

  async togglePin(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    if (!t) return
    t.pinned = !t.pinned
    this.bump(t)
    this.client?.chat.setChatPin(jid, t.pinned).catch(() => undefined)
  }

  async toggleMute(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    if (!t) return
    t.muted = !t.muted
    this.bump(t)
    if (!this.client) return
    if (t.muted) {
      const forever = Date.now() + 5 * 365 * 86_400_000
      this.client.chat.setChatMute(jid, true, forever).catch(() => undefined)
    } else {
      this.client.chat.setChatMute(jid, false).catch(() => undefined)
    }
  }

  async setUnread(jid: string, unread: boolean): Promise<void> {
    const t = this.threads.get(jid)
    if (!t) return
    t.unread = unread ? Math.max(1, t.unread) : 0
    this.bump(t)
    this.client?.chat.setChatRead(jid, !unread).catch(() => undefined)
  }

  async toggleArchive(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    if (!t) return
    t.archived = !t.archived
    this.bump(t)
    this.client?.chat.setChatArchive(jid, t.archived).catch(() => undefined)
  }

  async refreshGroupInfo(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    if (!t || !this.client || this.state.demo) return
    try {
      const md = await this.client.group.queryGroupMetadata(jid)
      const meta = md as unknown as { subject?: string; participants?: unknown[]; size?: number; desc?: unknown; description?: unknown }
      const count = meta.participants?.length ?? meta.size ?? 0
      t.infoSummary = `${meta.subject ?? t.name} · ${count} participants`
      t.memberCount = count > 0 ? count : undefined
      const descRaw = meta.desc ?? meta.description
      t.groupDesc = typeof descRaw === 'string' && descRaw ? descRaw : undefined
      this.bump(t)
    } catch {
      t.infoSummary = 'Group info unavailable right now'
      this.bump(t)
    }
  }

  async refreshContactInfo(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    const store = this.store
    if (!t) return
    if (this.state.demo || !store) {
      t.infoSummary = `${t.name} · ${displayJid(jid)}`
      this.bump(t)
      return
    }
    try {
      const sess = store.session('default')
      const contact = await sess.contacts.getByJid(jid)
      const name = contact?.displayName ?? contact?.pushName
      if (name && !t.nameSet) {
        t.name = name
        t.nameSet = true
      }
      t.infoSummary = `${name ?? displayJid(jid)}${contact?.username ? ` · @${contact.username}` : ''}`
      this.bump(t)
    } catch {
      t.infoSummary = displayJid(jid)
      this.bump(t)
    }
  }

  async unlink(): Promise<void> {
    this.set({
      note: 'Unlinking this device… Local history will be cleared (like WhatsApp Web).',
      qr: null,
      pairingCode: null,
    })
    try {
      await this.client?.logout()
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
    this.qrAttempt = 0
    void this.resetLocalHistory()
    this.set({
      phase: 'pairing',
      session: 'relink',
      me: null,
      activeJid: null,
      note: 'Device unlinked. Local history was cleared — re-pair to continue.',
    })
    void this.client?.connect().catch((err) => this.set({ error: errorMessage(err) }))
  }

  setScreen(screen: Screen): void {
    this.set({ screen })
  }

  async requestPairingCode(phoneNumber: string): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      const code = await client.auth.requestPairingCode(phoneNumber)
      this.set({ pairingCode: code, error: null })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }
}
