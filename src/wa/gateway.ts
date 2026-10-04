import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  WaClient,
  createStore,
  getContentType,
  isNewsletterJid,
  isStatusBroadcastJid,
  proto,
} from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import type { WaIncomingMessageEvent, WaStore } from 'zapo-js'
import { displayJid } from '../format.js'
import { getSettings, subscribeSettings } from '../config.js'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = resolvePath(ROOT, '.auth')
const DATA_FILE = resolvePath(DATA_DIR, 'state.sqlite')

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker'

export interface ProfileView {
  name: string | null
  about: string | null
  privacy: Record<string, string> | null
}

/** Allowed values per privacy category (from the zapo privacy guide). */
const PRIVACY_CYCLES: Record<string, readonly string[]> = {
  lastSeen: ['all', 'contacts', 'contact_blacklist', 'none'],
  profilePicture: ['all', 'contacts', 'contact_blacklist', 'none'],
  about: ['all', 'contacts', 'contact_blacklist', 'none'],
  groupAdd: ['all', 'contacts', 'contact_blacklist', 'none'],
  online: ['all', 'none'],
  readReceipts: ['all', 'none'],
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.oga': 'audio/ogg; codecs=opus',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
}

function guessMimetype(filePath: string, kind: MediaKind): string {
  const mime = MIME_BY_EXT[extname(filePath).toLowerCase()]
  if (mime) return mime
  if (kind === 'image') return 'image/jpeg'
  if (kind === 'video') return 'video/mp4'
  if (kind === 'sticker') return 'image/webp'
  if (kind === 'voice') return 'audio/ogg; codecs=opus'
  if (kind === 'audio') return 'audio/mpeg'
  return 'application/octet-stream'
}

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolvePath(homedir(), p.slice(2))
  return resolvePath(p)
}

export interface WaMsg {
  id: string
  fromMe: boolean
  senderJid?: string
  senderName?: string
  text: string
  ts: number
  status: 'pending' | 'sent' | 'read' | 'failed'
  system?: boolean
}

export interface WaThread {
  jid: string
  name: string
  messages: WaMsg[]
  unread: number
  typing: boolean
  lastTs: number
  pinned: boolean
  muted: boolean
  archived: boolean
  loadingOlder: boolean
  exhausted: boolean
  infoSummary?: string
  /** Bumped on every mutation — memo stability key for React components. */
  rev: number
}

interface ThreadData extends WaThread {
  senderNames: Record<string, string>
  historyRequested: boolean
  nameSet: boolean
  /** A saved-contact display name resolved — it wins over pushName forever. */
  contactResolved: boolean
}

export type WaPhase = 'boot' | 'pairing' | 'online' | 'reconnecting'
export type WaSession = 'ok' | 'relink'
export type Screen = 'main' | 'settings' | 'chatMenu' | 'help' | 'profile'

export interface GatewayState {
  phase: WaPhase
  session: WaSession
  screen: Screen
  me: string | null
  activeJid: string | null
  error: string | null
  note: string | null
  qr: { value: string; expiresAt: number; attempt: number } | null
  pairingCode: string | null
  reconnection: { attempt: number; max: number; delayMs: number } | null
  bootSteps: string[]
  historyProgress: number | null
  profile: ProfileView | null
  demo: boolean
}

// zapo's Proto.IMessage arrives fully typed; we only read the fields we render.
interface LooseMsg {
  conversation?: string | null
  extendedTextMessage?: { text?: string | null } | null
  imageMessage?: { caption?: string | null } | null
  videoMessage?: { caption?: string | null; gifPlayback?: boolean | null } | null
  audioMessage?: unknown
  documentMessage?: { caption?: string | null; fileName?: string | null } | null
  stickerMessage?: unknown
  pollCreationMessage?: { name?: string | null } | null
  locationMessage?: { name?: string | null } | null
  liveLocationMessage?: unknown
  contactMessage?: { displayName?: string | null } | null
}

export class WaGateway {
  private listeners = new Set<() => void>()
  private notifyScheduled: ReturnType<typeof setTimeout> | null = null

  private client: WaClient | null = null
  private store: WaStore | null = null
  private hydrateTimer: ReturnType<typeof setTimeout> | null = null
  private progressTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private typingClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private demoTimers: Array<ReturnType<typeof setTimeout>> = []

  private threads = new Map<string, ThreadData>()
  private viewDirty = true
  private viewCache: WaThread[] = []
  private receiptSent = new Set<string>()
  private contactLookups = new Set<string>()
  private oldestBeforeRequest = new Map<string, string | null>()
  private activeJid: string | null = null
  private reconnectAttempt = 0
  private qrAttempt = 0
  private disposed = false
  private demoReplyIdx = 0

  state: GatewayState = {
    phase: 'boot',
    session: 'ok',
    screen: 'main',
    me: null,
    activeJid: null,
    error: null,
    note: null,
    qr: null,
    pairingCode: null,
    reconnection: null,
    bootSteps: [],
    historyProgress: null,
    profile: null,
    demo: false,
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): GatewayState => this.state

  /**
   * Identity-stable thread list. Rebuilt only when thread data actually
   * changed, so React memo comparisons work and the UI stays smooth.
   */
  getThreadsSnapshot = (): WaThread[] => {
    if (this.viewDirty) {
      const sort = getSettings().chatSort
      // Archived threads stay in the snapshot on purpose: the main list filters
      // them out per view, and ChatMenu must still find an archived chat to
      // offer "Unarchive".
      const all = [...this.threads.values()]
      all.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        if (sort === 'name') return a.name.localeCompare(b.name)
        if (sort === 'unread') {
          if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1
        }
        return b.lastTs - a.lastTs
      })
      this.viewCache = all
      this.viewDirty = false
    }
    return this.viewCache
  }

  private set(patch: Partial<GatewayState>): void {
    this.state = { ...this.state, ...patch }
    this.scheduleNotify()
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled !== null || this.disposed) return
    this.notifyScheduled = setTimeout(() => {
      this.notifyScheduled = null
      for (const listener of this.listeners) listener()
    }, 40)
  }

  /** Flag thread data as changed and schedule a coalesced UI update. */
  private bump(t: ThreadData): void {
    t.rev += 1
    this.viewDirty = true
    this.scheduleNotify()
  }

  private pushStep(step: string): void {
    this.set({ bootSteps: [...this.state.bootSteps, step] })
  }

  private thread(jid: string): ThreadData {
    let t = this.threads.get(jid)
    if (!t) {
      t = {
        jid,
        name: displayJid(jid),
        messages: [],
        unread: 0,
        typing: false,
        lastTs: 0,
        pinned: false,
        muted: false,
        archived: false,
        loadingOlder: false,
        exhausted: false,
        senderNames: {},
        historyRequested: false,
        nameSet: false,
        contactResolved: false,
        rev: 0,
      }
      this.threads.set(jid, t)
      this.viewDirty = true
    }
    return t
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    subscribeSettings(() => {
      this.viewDirty = true
      this.scheduleNotify()
    })
    try {
      this.pushStep('Preparing the SQLite store')
      mkdirSync(DATA_DIR, { recursive: true })
      const store = createStore({
        backends: {
          sqlite: createSqliteStore({ path: DATA_FILE, driver: 'auto' }),
        },
        providers: {
          auth: 'sqlite',
          signal: 'sqlite',
          preKey: 'sqlite',
          session: 'sqlite',
          identity: 'sqlite',
          senderKey: 'sqlite',
          appState: 'sqlite',
          privacyToken: 'sqlite',
          messages: 'sqlite',
          threads: 'sqlite',
          contacts: 'sqlite',
        },
      })
      this.store = store
      this.pushStep('Creating the zapo client')
      this.client = new WaClient({
        store,
        sessionId: 'default',
        connectTimeoutMs: 20_000,
        nodeQueryTimeoutMs: 30_000,
        // Self-heal when WhatsApp rotates the web version (HTTP 405).
        recoverFromClientTooOld: true,
        history: { enabled: true },
      })
      this.wireClient()
      void this.hydrateFromStore()
      this.pushStep('Connecting to WhatsApp')
      await this.client.connect()
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async shutdown(): Promise<void> {
    this.disposed = true
    for (const timer of this.demoTimers) clearTimeout(timer)
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    if (this.hydrateTimer !== null) clearTimeout(this.hydrateTimer)
    if (this.progressTimer !== null) clearTimeout(this.progressTimer)
    for (const timer of this.typingClearTimers.values()) clearTimeout(timer)
    try {
      await this.client?.disconnect()
    } catch {
      // best effort on exit
    }
  }

  // ------------------------------------------------------------------- events

  private wireClient(): void {
    const client = this.client
    if (!client) return

    client.on('auth_qr', ({ qr, ttlMs }) => {
      this.qrAttempt += 1
      this.set({
        phase: 'pairing',
        qr: { value: qr, expiresAt: Date.now() + ttlMs, attempt: this.qrAttempt },
        pairingCode: null,
        reconnection: null,
      })
    })

    client.on('auth_paired', () => {
      this.pushStep('Paired successfully')
      this.set({ qr: null, pairingCode: null, error: null })
    })

    client.on('connection', (event) => {
      if (event.status === 'open') {
        this.reconnectAttempt = 0
        this.set({
          phase: 'online',
          session: 'ok',
          me: client.getCredentials()?.meJid ?? this.state.me,
          reconnection: null,
          error: null,
          note: null,
        })
        void this.afterOpen()
        return
      }
      if (event.isLogout) {
        // The device was unlinked (phone-side logout / server purge).
        // Credentials are gone but the local archive stays — re-pair to resume.
        this.qrAttempt = 0
        this.set({
          phase: 'pairing',
          session: 'relink',
          me: null,
          qr: null,
          pairingCode: null,
          reconnection: null,
          note: 'This device was unlinked from the phone. Your local chat history is preserved — scan again (any number) to re-pair.',
        })
        void client.connect().catch((err) => this.set({ error: errorMessage(err) }))
        return
      }
      this.scheduleReconnect(event.reason)
    })

    client.on('message', (event) => {
      this.ingestMessage(event)
    })

    client.on('history_sync_chunk', (event) => {
      const progress = typeof event.progress === 'number' ? event.progress : null
      this.set({ historyProgress: progress })
      if (this.progressTimer !== null) clearTimeout(this.progressTimer)
      this.progressTimer = setTimeout(() => this.set({ historyProgress: null }), 5_000)
      // zapo persisted the chunk into the store — pull it into the UI shortly.
      if (event.messagesCount > 0) this.scheduleHydrate()
    })

    client.on('receipt', (event) => {
      if (event.status !== 'read' && event.status !== 'delivered') return
      const chatJid = event.chatJid
      if (!chatJid) return
      const t = this.threads.get(chatJid)
      if (!t) return
      const nextStatus = event.status === 'read' ? 'read' : 'sent'
      let touched = false
      for (const id of event.messageIds) {
        const msg = t.messages.find((m) => m.id === id && m.fromMe)
        if (msg && msg.status !== nextStatus) {
          msg.status = nextStatus
          touched = true
        }
      }
      if (touched) this.bump(t)
    })

    client.on('chatstate', (event) => {      const payload = event as unknown as {
        state?: string
        chatJid?: string
        key?: { remoteJid?: string }
      }
      const jid = payload.chatJid ?? payload.key?.remoteJid
      if (!jid) return
      const t = this.threads.get(jid)
      if (!t) return
      const composing = payload.state === 'composing'
      if (t.typing === composing) return
      t.typing = composing
      const prev = this.typingClearTimers.get(jid)
      if (prev) clearTimeout(prev)
      if (composing) {
        this.typingClearTimers.set(
          jid,
          setTimeout(() => {
            t.typing = false
            this.bump(t)
          }, 7_000),
        )
      }
      this.bump(t)
    })

    // Channel (newsletter) activity — typed events; ingest defensively.
    client.on('newsletter', (event) => this.ingestNewsletterEvent(event as unknown as Record<string, unknown>))
    client.on('newsletter_message_update', (event) => this.ingestNewsletterEvent(event as unknown as Record<string, unknown>))
  }

  private async afterOpen(): Promise<void> {
    const client = this.client
    if (!client || this.disposed) return
    void client.presence.send('available').catch(() => undefined)
    void this.loadChannels()
    // Resolve group subjects in one batched query; purely cosmetic.
    try {
      const groups = await client.group.queryAllGroups()
      for (const g of groups) {
        const meta = g as unknown as { jid?: string; id?: string; subject?: string }
        const jid = meta.jid ?? meta.id
        if (!jid || !meta.subject) continue
        const t = this.threads.get(jid)
        if (t && !t.nameSet) {
          t.name = meta.subject
          t.nameSet = true
          this.bump(t)
        }
      }
    } catch {
      // cosmetic — ignore
    }
    if (this.activeJid) void this.activateChat(this.activeJid, true)
  }

  private scheduleReconnect(reason?: string): void {
    if (this.disposed || this.reconnectTimer !== null) return
    const max = getSettings().reconnectAttempts
    if (this.reconnectAttempt >= max) {
      this.set({
        phase: 'reconnecting',
        reconnection: null,
        error: `Connection lost${reason ? ` (${reason})` : ''} — retries exhausted. Restart WhatsAppTUI to try again.`,
      })
      return
    }
    const delayMs = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.set({
      phase: 'reconnecting',
      reconnection: { attempt: this.reconnectAttempt, max, delayMs },
    })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.disposed || !this.client) return
      this.client.connect().catch(() => this.scheduleReconnect())
    }, delayMs)
  }

  // ------------------------------------------------------------- message flow

  private ingestMessage(event: WaIncomingMessageEvent): void {
    const jid = event.key.remoteJid
    if (!jid || isStatusBroadcastJid(jid) || isNewsletterJid(jid)) return

    const t = this.thread(jid)
    const id = event.key.id
    const ts = (event.timestampSeconds ?? Math.floor(Date.now() / 1000)) * 1000
    const text = renderMessageText(event.message)

    if (event.pushName) {
      if (event.key.isGroup && event.key.participant && !event.key.fromMe) {
        t.senderNames[event.key.participant] = event.pushName
      } else if (!event.key.isGroup && !t.contactResolved) {
        // Pushname is a fallback — a saved-contact name (resolved async below)
        // always wins over it, like the phone app.
        t.name = event.pushName
      }
    }
    if (!event.key.isGroup) void this.resolveNameFromContacts(jid)

    const existing = t.messages.find((m) => m.id === id && m.fromMe === event.key.fromMe)
    if (existing) {
      if (text) existing.text = text
      if (t.lastTs < ts) t.lastTs = ts
      this.bump(t)
      return
    }

    const senderName = event.key.isGroup
      ? (event.key.participant ? t.senderNames[event.key.participant] : undefined) ?? event.pushName
      : undefined

    t.messages.push({
      id,
      fromMe: event.key.fromMe,
      senderJid: event.key.participant,
      senderName,
      text,
      ts,
      status: 'sent',
    })
    t.typing = false
    t.lastTs = Math.max(t.lastTs, ts)

    if (!event.key.fromMe) {
      if (this.activeJid === jid) {
        void this.markRead(event)
      } else {
        t.unread += 1
        if (getSettings().bellOnNewMessage) process.stdout.write('\x07')
      }
    }
    this.bump(t)
  }

  private async markRead(event: WaIncomingMessageEvent): Promise<void> {
    const client = this.client
    if (!client || !getSettings().readReceipts) return
    const id = event.key.id
    if (!id || this.receiptSent.has(id)) return
    this.receiptSent.add(id)
    try {
      await client.message.sendReceipt(event, { type: 'read' })
    } catch {
      // read receipt is best-effort
    }
  }

  /** Read receipts for messages that arrived while another chat was open. */
  private async markThreadRead(jid: string): Promise<void> {
    const client = this.client
    if (!client || !getSettings().readReceipts) return
    const t = this.threads.get(jid)
    if (!t) return
    const pending = t.messages
      .filter((m) => !m.fromMe && !m.system && !this.receiptSent.has(m.id))
      .slice(-50)
    // Group receipts are addressed per participant; direct chats need none.
    const byParticipant = new Map<string | undefined, string[]>()
    for (const m of pending) {
      this.receiptSent.add(m.id)
      const participant = jid.endsWith('@g.us') ? m.senderJid : undefined
      const ids = byParticipant.get(participant) ?? []
      ids.push(m.id)
      byParticipant.set(participant, ids)
    }
    for (const [participant, ids] of byParticipant) {
      try {
        await client.message.sendReceipt(jid, ids, {
          type: 'read',
          ...(participant ? { participant } : {}),
        })
      } catch {
        // read receipt is best-effort
      }
    }
  }

  // -------------------------------------------------------- store hydration

  /** Show the saved contact name, else the phone number — never a raw JID/LID. */
  private async resolveNameFromContacts(jid: string): Promise<void> {
    const store = this.store
    if (!store || this.contactLookups.has(jid)) return
    this.contactLookups.add(jid)
    try {
      const sess = store.session('default')
      const contact = await sess.contacts.getByJid(jid)
      const t = this.threads.get(jid)
      if (!t) return
      // Precedence, like the phone app: saved display name > pushname > number.
      // A masked display name ("+62∙∙∙∙∙90") means the number is NOT saved —
      // fall through to the clean phone number instead.
      const raw = contact?.displayName ?? null
      const displayName = raw && !raw.includes('∙') ? raw : null
      if (displayName) {
        t.name = displayName
        t.nameSet = true
        t.contactResolved = true
        this.bump(t)
        return
      }
      if (t.contactResolved || t.nameSet) return
      const phone = contact?.phoneNumber ? `+${contact.phoneNumber.replace(/\D/g, '')}` : null
      const fallback = contact?.pushName ?? phone
      if (fallback) {
        t.name = fallback
        this.bump(t)
      }
    } catch {
      // cosmetic
    }
  }

  private scheduleHydrate(): void {
    if (this.hydrateTimer !== null) clearTimeout(this.hydrateTimer)
    this.hydrateTimer = setTimeout(() => {
      this.hydrateTimer = null
      void this.hydrateFromStore().then(() => this.resolveOlderRequests())
    }, 1200)
  }

  private resolveOlderRequests(): void {
    for (const [jid, oldestId] of this.oldestBeforeRequest) {
      const t = this.threads.get(jid)
      if (!t || !t.loadingOlder) continue
      const nowOldest = t.messages[0]?.id ?? null
      if (nowOldest === oldestId) t.exhausted = true
      t.loadingOlder = false
      this.bump(t)
      this.oldestBeforeRequest.delete(jid)
    }
  }

  private async hydrateFromStore(): Promise<void> {
    const store = this.store
    if (!store) return
    try {
      const sess = store.session('default')
      const threadRecords = await sess.threads.list(300)
      // Threads hydrate independently — fan out so one slow SQLite read
      // doesn't serialize the whole boot.
      await Promise.all(
        threadRecords.map(async (rec) => {
          try {
            if (isStatusBroadcastJid(rec.jid) || isNewsletterJid(rec.jid)) return
            const t = this.thread(rec.jid)
            let changed = false
            if (rec.name && !t.nameSet) {
              t.name = rec.name
              t.nameSet = true
              changed = true
            }
            if (!rec.jid.endsWith('@g.us')) void this.resolveNameFromContacts(rec.jid)
            const unread = rec.unreadCount ?? 0
            if (unread > t.unread) {
              t.unread = unread
              changed = true
            }
            const pinned = (rec.pinned ?? 0) > 0
            if (pinned !== t.pinned) {
              t.pinned = pinned
              changed = true
            }
            const muted = (rec.muteEndMs ?? 0) > Date.now()
            if (muted !== t.muted) {
              t.muted = muted
              changed = true
            }
            const archived = rec.archived === true
            if (archived !== t.archived) {
              t.archived = archived
              changed = true
            }
            const stored = await sess.messages.listByThread(rec.jid, 120)
            const unnamedSenders = new Set<string>()
            for (const m of stored) {
              if (t.messages.some((x) => x.id === m.id && x.fromMe === m.fromMe)) continue
              const participant = m.participantJid ?? m.senderJid
              if (participant && !t.senderNames[participant]) unnamedSenders.add(participant)
              t.messages.push({
                id: m.id,
                fromMe: m.fromMe,
                senderJid: participant,
                senderName: participant ? t.senderNames[participant] : undefined,
                text: decodeStoredMessage(m.messageBytes),
                ts: m.timestampMs ?? Date.now(),
                status: 'read',
              })
              changed = true
            }
            await Promise.all(
              [...unnamedSenders].map(async (senderJid) => {
                try {
                  const contact = await sess.contacts.getByJid(senderJid)
                  const name = contact?.displayName ?? contact?.pushName
                  if (name) t.senderNames[senderJid] = name
                } catch {
                  // cosmetic
                }
              }),
            )
            if (changed) {
              t.messages.sort((a, b) => a.ts - b.ts)
              for (const m of t.messages) {
                if (!m.fromMe && m.senderJid) m.senderName = t.senderNames[m.senderJid] ?? m.senderName
              }
              t.lastTs = Math.max(t.lastTs, t.messages[t.messages.length - 1]?.ts ?? 0)
              this.bump(t)
            }
          } catch {
            // per-thread best effort — one bad record must not stall the rest
          }
        }),
      )
    } catch {
      // hydration is best-effort — live events still populate the UI
    }
  }

  // ---------------------------------------------------------------- channels

  async loadChannels(): Promise<void> {
    const client = this.client
    if (this.state.demo || !client) return // demo seeds its own channel
    try {
      const subs = await client.newsletter.listSubscribed()
      for (const n of subs) {
        const meta = n as unknown as { jid?: string; id?: string; name?: string; title?: string }
        const jid = meta.jid ?? meta.id
        if (!jid || !jid.endsWith('@newsletter')) continue
        const t = this.thread(jid)
        if (!t.nameSet) {
          const name = meta.name ?? meta.title
          if (name) {
            t.name = name
            t.nameSet = true
          }
        }
        this.bump(t)
      }
    } catch {
      // channels are optional — ignore failures
    }
  }

  async openChannel(jid: string): Promise<void> {
    const t = this.threads.get(jid)
    const client = this.client
    if (!t || t.historyRequested) return
    t.historyRequested = true
    this.bump(t)
    if (this.state.demo) {
      if (t.messages.length === 0) {
        const now = Date.now()
        const H = 3600_000
        t.messages.push(
          { id: 'demo-nl-2', fromMe: false, text: 'v0.4 — channels are in: read & post from the terminal', ts: now - 2 * H, status: 'read' },
          { id: 'demo-nl-1', fromMe: true, text: 'media attach landed too: /img /vid /aud /vn /doc /stk', ts: now - H, status: 'read' },
        )
        t.lastTs = Math.max(t.lastTs, now - H)
        this.bump(t)
      }
      return
    }
    if (!client) return
    void client.newsletter.subscribeLiveUpdates(jid).catch(() => undefined)
    try {
      const page = await client.newsletter.fetchMessages({ newsletterJid: jid, count: 30 })
      const nodes = collectNewsletterMessages(page as unknown as NewsletterNode)
      let changed = false
      for (const n of nodes) {
        const id = n.id ?? `nl-${Date.now()}-${Math.random()}`
        if (t.messages.some((m) => m.id === id)) continue
        t.messages.push({ id, fromMe: false, text: n.text || '[channel message]', ts: n.ts ?? Date.now(), status: 'read' })
        changed = true
      }
      if (changed) {
        t.messages.sort((a, b) => a.ts - b.ts)
        t.lastTs = Math.max(t.lastTs, t.messages[t.messages.length - 1]?.ts ?? 0)
        this.bump(t)
      }
    } catch {
      // history fetch is best-effort — live updates still work
    }
  }

  private ingestNewsletterEvent(e: Record<string, unknown>): void {
    const key = e.key as Record<string, unknown> | undefined
    const jid = (e.jid ?? e.newsletterJid ?? key?.remoteJid) as string | undefined
    if (!jid || !jid.endsWith('@newsletter')) return
    const inner = (e.message ?? e) as { message?: unknown }
    const text = renderMessageText(inner.message ?? inner)
    if (!text) return
    const t = this.thread(jid)
    const id = String(e.serverId ?? e.messageId ?? key?.id ?? `nl-live-${Date.now()}`)
    if (t.messages.some((m) => m.id === id)) return
    const tsSec = Number(e.timestampSeconds ?? e.timestamp ?? 0)
    t.messages.push({ id, fromMe: e.fromMe === true, text, ts: tsSec > 0 ? tsSec * 1000 : Date.now(), status: 'read' })
    t.lastTs = Date.now()
    this.bump(t)
  }

  // ----------------------------------------------------------------- profile

  async loadProfile(): Promise<void> {
    const client = this.client
    if (this.state.demo) {
      this.set({
        profile: {
          name: 'Demo User',
          about: 'chatting from the terminal',
          privacy: { lastSeen: 'contacts', profilePicture: 'all', about: 'contacts', online: 'all', readReceipts: 'all', groupAdd: 'contacts' },
        },
      })
      return
    }
    if (!client) return
    const creds = client.getCredentials() as unknown as { meJid?: string; pushName?: string } | null
    let about: string | null = null
    try {
      if (creds?.meJid) {
        const res = await client.profile.getStatus(creds.meJid)
        about = typeof res === 'string' ? res : ((res as unknown as { status?: string })?.status ?? null)
      }
    } catch {
      // optional field
    }
    let privacy: Record<string, string> | null = null
    try {
      privacy = { ...(await client.privacy.getPrivacySettings()) as unknown as Record<string, string> }
    } catch {
      // optional field
    }
    this.set({ profile: { name: creds?.pushName ?? null, about, privacy } })
  }

  async setProfileName(name: string): Promise<void> {
    const client = this.client
    const current = this.state.profile ?? { name: null, about: null, privacy: null }
    if (this.state.demo || !client) {
      this.set({ profile: { ...current, name: name || null } })
      return
    }
    try {
      await client.profile.setPushName(name)
      this.set({ profile: { ...current, name: name || null } })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async setProfileAbout(text: string): Promise<void> {
    const client = this.client
    const current = this.state.profile ?? { name: null, about: null, privacy: null }
    if (this.state.demo || !client) {
      this.set({ profile: { ...current, about: text || null } })
      return
    }
    try {
      await client.profile.setStatus(text)
      this.set({ profile: { ...current, about: text || null } })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async setProfilePicturePath(rawPath: string): Promise<void> {
    const client = this.client
    const abs = expandHome(rawPath)
    if (!existsSync(abs)) {
      this.set({ error: `File not found: ${abs}` })
      return
    }
    if (this.state.demo || !client) {
      this.set({ note: `Demo: profile picture would be set from ${abs}` })
      return
    }
    try {
      await client.profile.setProfilePicture(await readFile(abs))
      this.set({ note: 'Profile picture updated' })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async cyclePrivacy(setting: string): Promise<void> {
    const values = PRIVACY_CYCLES[setting] ?? ['all', 'contacts', 'contact_blacklist', 'none']
    const current = this.state.profile?.privacy?.[setting] ?? values[0]!
    const next = values[(values.indexOf(current) + 1) % values.length]!
    const privacy = { ...(this.state.profile?.privacy ?? {}), [setting]: next }
    this.set({ profile: { ...(this.state.profile ?? { name: null, about: null }), privacy } })
    if (this.state.demo || !this.client) return
    try {
      await (this.client.privacy.setPrivacySetting as (setting: string, value: string) => Promise<string | null>)(setting, next)
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  // ----------------------------------------------------------------- actions

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
        // presence subscription is optional
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
      this.demoLoadOlder(jid)
      return
    }
    if (!client) return
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
          count: 50,
        }
      : { chatJid: jid, count: 50 }
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
      this.demoSend(t, trimmed)
      return
    }
    if (!client) {
      // Offline but not a demo: keep the draft visible, marked as failed.
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

  private typingSentFor = new Map<string, ReturnType<typeof setTimeout>>()

  /** Attach and send media — /img /vid /aud /vn /doc /stk from the input box. */
  async sendMedia(jid: string, kind: MediaKind, rawPath: string, caption?: string): Promise<void> {
    const client = this.client
    const t = this.thread(jid)
    const abs = expandHome(rawPath)
    const fileBase = basename(abs)
    const icons: Record<MediaKind, string> = {
      image: '[📷 photo]',
      video: '[🎬 video]',
      audio: '[🎧 audio]',
      voice: '[🎧 voice note]',
      document: `[📄 ${fileBase}]`,
      sticker: '[✨ sticker]',
    }
    const placeholder = caption ? `${icons[kind]} ${caption}` : icons[kind]!

    if (this.state.demo) {
      t.messages.push({ id: `demo-media-${Date.now()}`, fromMe: true, text: placeholder, ts: Date.now(), status: 'read' })
      t.lastTs = Date.now()
      this.bump(t)
      return
    }

    if (!client) {
      t.messages.push({ id: `media-${Date.now()}`, fromMe: true, text: `${placeholder} · send failed: not connected`, ts: Date.now(), status: 'failed' })
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
    t.messages.push({ id: pendingId, fromMe: true, text: placeholder, ts: Date.now(), status: 'pending' })
    t.lastTs = Date.now()
    this.bump(t)

    const mimetype = guessMimetype(abs, kind)
    try {
      let content: Record<string, unknown>
      if (kind === 'image') content = { type: 'image', media: abs, mimetype, caption }
      else if (kind === 'video') content = { type: 'video', media: abs, mimetype, caption }
      else if (kind === 'voice') content = { type: 'audio', media: abs, mimetype, ptt: true }
      else if (kind === 'audio') content = { type: 'audio', media: abs, mimetype }
      else if (kind === 'sticker') content = { type: 'sticker', media: abs, mimetype: mimetype === 'application/octet-stream' ? 'image/webp' : mimetype }
      else content = { type: 'document', media: abs, mimetype, fileName: fileBase, caption }
      const result = await client.message.send(jid, content as never)
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
    // Debounce: send composing after a short pause, auto-pause after 3s idle.
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

  // ------------------------------------------------- per-chat switches (menu)

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
      const meta = md as unknown as { subject?: string; participants?: unknown[]; size?: number }
      const count = meta.participants?.length ?? meta.size ?? 0
      t.infoSummary = `${meta.subject ?? t.name} · ${count} participants`
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
      note: 'Unlinking this device… Your local chat history is preserved.',
      qr: null,
      pairingCode: null,
    })
    try {
      await this.client?.logout()
    } catch (err) {
      // Even if the server call fails, the local session can't resume safely.
      this.set({ error: errorMessage(err) })
    }
    this.qrAttempt = 0
    this.set({
      phase: 'pairing',
      session: 'relink',
      me: null,
      note: 'Device unlinked. Your chat history is preserved — re-pair to continue.',
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

  // -------------------------------------------------------------------- demo

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
        unread: 3,
        msgs: [          [false, 'Gilang', '[📷 photo] golden hour today was unreal', now - 8 * H],
          [false, 'Mega', '[🎬 video] the timelapse version', now - 7 * H],
          [true, '', '[🎧 voice message]', now - 6 * H],
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
      { id: 'demo-chan-1', fromMe: true, text: 'media attach landed: /img /vid /aud /vn /doc /stk <file>', ts: now - H, status: 'read' },
    )
    channel.lastTs = now - H
    this.viewDirty = true
    this.pushStep('Demo mode — sample conversations loaded')
    this.set({ phase: 'online', me: '628999000001@s.whatsapp.net' })
    this.scheduleDemoEvents()
  }

  private scheduleDemoEvents(): void {
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

  private demoTyping(jid: string, typing: boolean): void {
    const t = this.threads.get(jid)
    if (!t) return
    t.typing = typing
    this.bump(t)
  }

  private demoIncoming(jid: string, senderOrText: string, maybeText?: string): void {
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

  private demoSend(t: ThreadData, text: string): void {
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
    // Keep the conversation alive: a peer answers so the demo shows the loop.
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
      // A group member chimes in after a beat.
      const members = ['Sinta', 'Andi', 'Gilang', 'Mega']
      const who = members[this.demoReplyIdx % members.length]!
      this.demoReplyIdx += 1
      this.demoTimers.push(
        setTimeout(() => this.demoIncoming(t.jid, who, 'haha nice one 😄'), 3_000),
      )
    }
  }

  private demoLoadOlder(jid: string): void {
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
          { id: `demo-old-${jid}-1`, fromMe: true, text: 'and it keeps your archive in a local SQLite store', ts: base - 2 * day + 5 * 60_000, status: 'read' },
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

export function renderMessageText(message: unknown): string {
  const m = (message ?? null) as LooseMsg | null
  if (!m) return ''
  if (m.conversation) return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  if (m.imageMessage) return withCaption('[📷 photo]', m.imageMessage.caption)
  if (m.videoMessage) return withCaption(m.videoMessage.gifPlayback ? '[🎞️ gif]' : '[🎬 video]', m.videoMessage.caption)
  if (m.audioMessage) return '[🎧 voice message]'
  if (m.documentMessage) return `[📄 ${m.documentMessage.fileName ?? 'document'}]`
  if (m.stickerMessage) return '[✨ sticker]'
  if (m.pollCreationMessage) return `[📊 poll: ${m.pollCreationMessage.name ?? '?'}]`
  if (m.locationMessage) return `[📍 ${m.locationMessage.name ?? 'location'}]`
  if (m.liveLocationMessage) return '[📍 live location]'
  if (m.contactMessage) return `[📇 ${m.contactMessage.displayName ?? 'contact'}]`
  const kind = getContentType(m as Parameters<typeof getContentType>[0])
  return kind ? `[${kind}]` : ''
}

function withCaption(prefix: string, caption?: string | null): string {
  return caption ? `${prefix} ${caption}` : prefix
}

interface NewsletterNode {
  tag: string
  attrs?: Record<string, unknown>
  content?: unknown
}

function extractNodeText(node: NewsletterNode): string {
  if (typeof node.content === 'string') return node.content
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (typeof child === 'string') return child
      if (child && typeof child === 'object') {
        const found = extractNodeText(child as NewsletterNode)
        if (found) return found
      }
    }
  }
  return ''
}

function collectNewsletterMessages(node: NewsletterNode, out: Array<{ id?: string; ts?: number; text: string }> = []): Array<{ id?: string; ts?: number; text: string }> {
  if (!node || typeof node !== 'object') return out
  if (node.tag === 'message') {
    const tsSec = Number(node.attrs?.t ?? 0)
    out.push({
      id: node.attrs?.id ? String(node.attrs.id) : undefined,
      ts: tsSec > 0 ? tsSec * 1000 : undefined,
      text: extractNodeText(node),
    })
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === 'object') collectNewsletterMessages(child as NewsletterNode, out)
    }
  }
  return out
}

export function decodeStoredMessage(bytes?: Uint8Array): string {
  if (!bytes || bytes.length === 0) return ''
  try {
    return renderMessageText(proto.Message.decode(bytes))
  } catch {
    return ''
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export const gateway = new WaGateway()
