import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { GatewayConnectionBase } from './gateway-connection.js'
import { ensureDemoAssets } from './demo-assets.js'
import { wavDurationSec } from '../media.js'
import { getSettings } from '../config.js'
import { BUNDLED_DEMO_PHOTO, BUNDLED_DEMO_VOICE, MEDIA_DIR } from './paths.js'
import { inferDemoMedia } from './decode.js'
import type { ThreadData, WaMsg } from './types.js'

export type AuthDemoSlug =
  | 'loading'
  | 'qr'
  | 'code'
  | 'code-ready'
  | 'reconnecting'
  | 'boot-error'
  | 'main'

export const AUTH_DEMO_SLUGS: AuthDemoSlug[] = [
  'loading',
  'qr',
  'code',
  'code-ready',
  'reconnecting',
  'boot-error',
  'main',
]

/** Offline demo: sample conversations, scripted events and auth-screen slugs. */
export class GatewayDemoBase extends GatewayConnectionBase {
  protected demoTimers: Array<ReturnType<typeof setTimeout>> = []
  protected demoReplyIdx = 0

  protected override clearExtraTimers(): void {
    for (const timer of this.demoTimers) clearTimeout(timer)
    this.demoTimers = []
  }

  protected override handleDemoSend(t: ThreadData, text: string): boolean {
    this.demoSend(t, text)
    return true
  }

  protected override handleDemoLoadOlder(jid: string): boolean {
    this.demoLoadOlder(jid)
    return true
  }

  seedDemo(): void {
    this.state = { ...this.state, demo: true }
    const now = Date.now()
    const H = 3600_000
    const M = 60_000
    const seed: Array<{
      name: string
      jid: string
      unread: number
      pinned?: boolean
      muted?: boolean
      archived?: boolean
      msgs: Array<[fromMe: boolean, sender: string, text: string, ts: number]>
    }> = [
      {
        name: 'Dina',
        jid: '6281234500001@s.whatsapp.net',
        unread: 2,
        msgs: [
          [false, '', 'hey, have you seen WhatsAppTUI yet?', now - 26 * M],
          [false, '', 'full WhatsApp chats but in the terminal — wild 😄', now - 25 * M],
          [true, '', 'just built it actually, fresh out of the oven', now - 24 * M],
          [false, '', 'perfect for people who never leave the terminal lol', now - 23 * M],
        ],
      },
      {
        name: 'Family',
        jid: '120363000000000001@g.us',
        unread: 1,
        pinned: true,
        msgs: [
          [false, 'Mom', 'bring home meatballs this afternoon ok', now - 3 * H],
          [true, '', 'yes chef 🫡', now - 3 * H + M],
          [false, 'Sis', 'yesss 🎉', now - 2 * H],
        ],
      },
      {
        name: 'Raka',
        jid: '6281234500002@s.whatsapp.net',
        unread: 0,
        msgs: [
          [false, '', 'futsal tomorrow still on?', now - 5 * H],
          [true, '', "on! 8 o'clock", now - 4 * H],
          [false, '', 'deal 👍', now - 4 * H + 2 * M],
        ],
      },
      {
        name: 'Dev Team',
        jid: '120363000000000002@g.us',
        unread: 0,
        muted: true,
        msgs: [
          [false, 'Sinta', 'deploy is all green ✅', now - 30 * H],
          [false, 'Andi', 'nice — rollout notes?', now - 29 * H - 10 * M],
          [false, 'Sinta', 'pinned in the channel, check thread', now - 29 * H],
          [true, '', 'great work everyone', now - 28 * H - 30 * M],
          [false, 'Andi', 'long messages also render cleanly btw, like this one that just keeps going and going so you can see how the bubble wraps across multiple lines without colliding with anything around it', now - 28 * H],
          [false, '', 'Andi added Budi', now - 27 * H],
        ],
      },
      {
        name: '+6281234500003',
        jid: '6281234500003@s.whatsapp.net',
        unread: 0,
        archived: true,
        msgs: [[false, '', 'Your package has been shipped. Track: wa.me/track/123', now - 27 * H]],
      },
      {
        name: 'Photography Club',
        jid: '120363000000000003@g.us',
        unread: 2,
        msgs: [
          [false, 'Mega', '[🎬 video] the timelapse version', now - 7 * H],
          [false, 'Gilang', '[📊 poll: best edit?] · 12 votes', now - 5 * H],
        ],
      },
    ]
    for (const s of seed) {
      const t = this.thread(s.jid)
      t.name = s.name
      t.nameSet = true
      t.pinned = s.pinned ?? false
      t.muted = s.muted ?? false
      t.archived = s.archived ?? false
      for (const [fromMe, sender, text, ts] of s.msgs) {
        t.messages.push({
          id: `demo-${s.jid}-${t.messages.length}`,
          fromMe,
          senderJid: fromMe ? undefined : sender || s.jid,
          senderName: fromMe || !sender ? undefined : sender,
          text,
          ts,
          status: 'read',
          system: !fromMe && !sender,
          media: inferDemoMedia(text),
        })
        t.lastTs = Math.max(t.lastTs, ts)
      }
      t.unread = s.unread
      this.viewDirty = true
    }
    const channel = this.thread('123456789012345@newsletter')
    channel.name = 'Dev Channel'
    channel.nameSet = true
    channel.unread = 2
    channel.messages.push(
      { id: 'demo-chan-2', fromMe: false, text: 'v0.4 — channels are here: read, post, swipe 👆', ts: now - 2 * H, status: 'read' },
      { id: 'demo-chan-1', fromMe: true, text: 'media attach: /img /vid /gif /ptv /aud /vn /doc /stk <file> [| caption] [--once]', ts: now - H, status: 'read' },
    )
    channel.lastTs = now - H
    this.viewDirty = true
    this.seedDemoMedia()
    this.pushStep('Demo mode — sample conversations loaded')
    this.set({ phase: 'online', me: '628999000001@s.whatsapp.net' })
    this.scheduleDemoEvents()
  }

  /**
   * Auth/loading screen playground — seed ONE screen by slug so UI work never
   * needs a real phone. Slugs: loading · qr · code · code-ready ·
   * reconnecting · boot-error · main (full chat demo).
   */
  seedAuthDemo(slug: AuthDemoSlug): void {
    // Every slug starts from a clean slate so jumping 1..7 never stacks
    // threads from the previous screen.
    this.clearThreadCache()
    this.clearMediaCaches()
    this.demoReplyIdx = 0
    this.state = {
      ...this.state,
      demo: true,
      screen: 'main',
      profile: null,
      historyProgress: null,
      activeJid: null,
      me: null,
      error: null,
      note: null,
    }
    this.clearExtraTimers()
    const now = Date.now()
    switch (slug) {
      case 'loading':
        this.set({
          phase: 'boot',
          session: 'ok',
          me: null,
          error: null,
          note: null,
          qr: null,
          pairingCode: null,
          reconnection: null,
          bootSteps: ['Preparing local storage', 'Starting WA connection'],
        })
        break
      case 'qr':
        this.qrAttempt = 1
        this.set({
          phase: 'pairing',
          session: 'ok',
          me: null,
          error: null,
          note: null,
          pairingCode: null,
          reconnection: null,
          bootSteps: ['Preparing local storage', 'Starting WA connection', 'Connecting to WhatsApp'],
          qr: {
            // A stable demo payload — the real QR rotates every ~20s.
            value: 'https://demo.whatsapptui/qr?demo=1&token=WHATSAPPTUI-DEMO-QR',
            expiresAt: now + 60_000,
            attempt: 1,
          },
        })
        break
      case 'code':
        this.set({
          phase: 'pairing',
          session: 'ok',
          me: null,
          error: null,
          note: 'Demo: press P, type any 8+ digit number, Enter — no SMS is sent.',
          pairingCode: null,
          reconnection: null,
          bootSteps: ['Preparing local storage', 'Starting WA connection', 'Connecting to WhatsApp'],
          qr: null,
        })
        break
      case 'code-ready':
        this.set({
          phase: 'pairing',
          session: 'ok',
          me: null,
          error: null,
          note: null,
          reconnection: null,
          bootSteps: ['Preparing local storage', 'Starting WA connection', 'Connecting to WhatsApp'],
          qr: null,
          pairingCode: 'ABCDEFGH',
        })
        break
      case 'reconnecting':
        this.seedDemoThreads()
        this.set({
          phase: 'reconnecting',
          session: 'ok',
          error: null,
          note: null,
          qr: null,
          pairingCode: null,
          reconnection: { attempt: 2, max: 10, delayMs: 4000 },
        })
        break
      case 'boot-error':
        this.set({
          phase: 'boot',
          session: 'ok',
          me: null,
          error: 'Demo: connection timeout after 20s (use --demo=main to skip this screen).',
          note: null,
          qr: null,
          pairingCode: null,
          reconnection: null,
          bootSteps: ['Preparing local storage', 'Starting WA connection'],
        })
        break
      case 'main':
      default:
        this.seedDemo()
        break
    }
  }

  /** Seed just the chat threads (no phase flip) — shared by main + reconnecting demos. */
  protected seedDemoThreads(): void {
    if (this.threads.size > 0) return
    const now = Date.now()
    const M = 60_000
    const t = this.thread('6281234500001@s.whatsapp.net')
    t.name = 'Dina'
    t.nameSet = true
    t.messages.push(
      { id: 'demo-slug-1', fromMe: false, text: 'hey, have you seen WhatsAppTUI yet?', ts: now - 26 * M, status: 'read' },
      { id: 'demo-slug-2', fromMe: true, text: 'just built it actually, fresh out of the oven', ts: now - 24 * M, status: 'read' },
    )
    t.lastTs = now - 24 * M
    t.unread = 1
    this.viewDirty = true
    this.pushStep('Demo mode — sample conversations loaded')
    this.set({ me: '628999000001@s.whatsapp.net' })
  }

  /**
   * Demo media: prefers the bundled real assets in assets/demo (a golden-hour
   * photo that renders inline in the terminal + a spoken voice note) and falls
   * back to generated files — either way open/play/download work end-to-end.
   */
  protected seedDemoMedia(): void {
    try {
      const fallback = ensureDemoAssets(resolvePath(MEDIA_DIR, 'demo'))
      const photoPath = existsSync(BUNDLED_DEMO_PHOTO) ? BUNDLED_DEMO_PHOTO : fallback.photoPath
      const voicePath = existsSync(BUNDLED_DEMO_VOICE) ? BUNDLED_DEMO_VOICE : fallback.voicePath
      const jid = '120363000000000003@g.us'
      const t = this.thread(jid)
      const now = Date.now()
      const M = 60_000
      const items: WaMsg[] = [
        { id: 'demo-media-photo', fromMe: false, senderJid: jid, senderName: 'Gilang', text: '[📷 photo] golden hour today was unreal', ts: now - 30 * M, status: 'read', media: { kind: 'image', caption: 'golden hour today was unreal', mimetype: 'image/png', downloadable: true, localPath: photoPath } },
        { id: 'demo-media-voice', fromMe: false, senderJid: jid, senderName: 'Mega', text: '[🎤 voice note]', ts: now - 20 * M, status: 'read', media: { kind: 'voice', isPtt: true, durationSec: wavDurationSec(voicePath) || 2, mimetype: 'audio/wav', downloadable: true, localPath: voicePath } },
      ]
      let changed = false
      for (const m of items) {
        if (t.messages.some((x) => x.id === m.id)) continue
        t.messages.push(m)
        t.lastTs = Math.max(t.lastTs, m.ts)
        t.unread += 1
        changed = true
      }
      if (changed) {
        t.messages.sort((a, b) => a.ts - b.ts)
        this.bump(t)
      }
    } catch {
    }
  }

  protected scheduleDemoEvents(): void {
    const at = (delayMs: number, fn: () => void): void => {
      this.demoTimers.push(setTimeout(fn, delayMs))
    }
    const dina = '6281234500001@s.whatsapp.net'
    const family = '120363000000000001@g.us'
    const raka = '6281234500002@s.whatsapp.net'

    at(6_000, () => this.demoTyping(dina, true))
    at(8_000, () => {
      this.demoTyping(dina, false)
      this.demoIncoming(dina, 'btw the settings screen works too — press Ctrl+S')
    })
    at(14_000, () => this.demoIncoming(family, 'Mom', 'dinner at 7, do not be late'))
    at(20_000, () => this.demoTyping(raka, true))
    at(22_000, () => {
      this.demoTyping(raka, false)
      this.demoIncoming(raka, 'gg on the launch 🚀')
    })
    at(30_000, () => this.demoIncoming('120363000000000003@g.us', 'Mega', 'psst — the mouse works too, try clicking a chat'))
  }

  protected demoTyping(jid: string, typing: boolean): void {
    const t = this.threads.get(jid)
    if (!t) return
    t.typing = typing
    this.bump(t)
  }

  protected demoIncoming(jid: string, senderOrText: string, maybeText?: string): void {
    const t = this.threads.get(jid)
    if (!t) return
    const sender = maybeText === undefined ? '' : senderOrText
    const text = maybeText ?? senderOrText
    t.messages.push({
      id: `demo-in-${Date.now()}`,
      fromMe: false,
      senderJid: sender || jid,
      senderName: sender || undefined,
      text,
      ts: Date.now(),
      status: 'read',
    })
    t.typing = false
    t.lastTs = Date.now()
    if (this.activeJid !== jid) {
      t.unread += 1
      if (getSettings().bellOnNewMessage) process.stdout.write('\x07')
    }
    this.bump(t)
  }

  protected demoSend(t: ThreadData, text: string): void {
    const id = `demo-out-${Date.now()}`
    t.messages.push({ id, fromMe: true, text, ts: Date.now(), status: 'pending' })
    t.lastTs = Date.now()
    this.bump(t)
    const setStatus = (status: 'sent' | 'read'): void => {
      const msg = t.messages.find((m) => m.id === id)
      if (msg) msg.status = status
      this.bump(t)
    }
    this.demoTimers.push(setTimeout(() => setStatus('sent'), 400))
    this.demoTimers.push(setTimeout(() => setStatus('read'), 1_400))
    if (!t.jid.endsWith('@g.us')) {
      const replies = [
        'nice, it really works!',
        'wait, you typed that in a terminal? 😂',
        'ok this is actually smooth',
        'send me the repo link!',
      ]
      const reply = replies[this.demoReplyIdx % replies.length]!
      this.demoReplyIdx += 1
      this.demoTimers.push(setTimeout(() => this.demoTyping(t.jid, true), 2_200))
      this.demoTimers.push(
        setTimeout(() => {
          this.demoTyping(t.jid, false)
          this.demoIncoming(t.jid, reply)
        }, 3_600),
      )
    } else {
      const members = ['Sinta', 'Andi', 'Gilang', 'Mega']
      const who = members[this.demoReplyIdx % members.length]!
      this.demoReplyIdx += 1
      this.demoTimers.push(
        setTimeout(() => this.demoIncoming(t.jid, who, 'haha nice one 😄'), 3_000),
      )
    }
  }

  protected demoLoadOlder(jid: string): void {
    const t = this.threads.get(jid)
    if (!t || t.loadingOlder) return
    t.loadingOlder = true
    this.bump(t)
    this.demoTimers.push(
      setTimeout(() => {
        const tt = this.threads.get(jid)
        if (!tt) return
        if (tt.exhausted) {
          tt.loadingOlder = false
          this.bump(tt)
          return
        }
        const day = 86_400_000
        const base = tt.messages[0]?.ts ?? Date.now()
        const older: WaMsg[] = [
          { id: `demo-old-${jid}-2`, fromMe: false, senderName: tt.jid.endsWith('@g.us') ? 'Mom' : undefined, senderJid: tt.jid, text: 'this is what synced history looks like — same as WhatsApp Web', ts: base - 2 * day, status: 'read' },
          { id: `demo-old-${jid}-1`, fromMe: true, text: 'and it keeps your chats saved on this device', ts: base - 2 * day + 5 * 60_000, status: 'read' },
          { id: `demo-old-${jid}-0`, fromMe: false, senderName: tt.jid.endsWith('@g.us') ? 'Sis' : undefined, senderJid: tt.jid, text: 'older pages load on demand when you scroll up', ts: base - day, status: 'read' },
        ]
        for (const m of older) {
          if (!tt.messages.some((x) => x.id === m.id)) {
            m.senderName = m.senderName ?? (tt.jid.endsWith('@g.us') ? undefined : tt.name)
            tt.messages.unshift(m)
          }
        }
        tt.messages.sort((a, b) => a.ts - b.ts)
        tt.exhausted = true
        tt.loadingOlder = false
        this.bump(tt)
      }, 900),
    )
  }
}
