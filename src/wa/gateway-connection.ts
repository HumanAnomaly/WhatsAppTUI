import { mkdirSync } from 'node:fs'
import { WaClient, createStore } from 'zapo-js'
import type { WaIncomingUnavailableMessageEvent } from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import { GatewayActionsBase } from './gateway-actions.js'
import { DATA_DIR, DATA_FILE } from './paths.js'
import { errorMessage } from './decode.js'
import { readActiveProfile, sameOwner, writeActiveProfile } from './profiles.js'
import { getSettings, subscribeSettings } from '../config.js'

/** Connection lifecycle: store setup, event wiring, reconnect policy. */
export class GatewayConnectionBase extends GatewayActionsBase {
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null
  protected progressTimer: ReturnType<typeof setTimeout> | null = null
  protected typingClearTimers = new Map<string, ReturnType<typeof setTimeout>>()

  async start(): Promise<void> {
    subscribeSettings(() => {
      this.viewDirty = true
      this.scheduleNotify()
    })
    try {
      this.pushStep('Preparing local storage')
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
      this.pushStep('Starting WA connection')
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
    this.clearExtraTimers()
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    if (this.hydrateTimer !== null) clearTimeout(this.hydrateTimer)
    if (this.progressTimer !== null) clearTimeout(this.progressTimer)
    if (this.playbackTimer !== null) clearTimeout(this.playbackTimer)
    this.playbackChild?.kill()
    for (const timer of this.typingClearTimers.values()) clearTimeout(timer)
    try {
      await this.client?.disconnect()
    } catch {
    }
  }

  /** Subclass hook — the demo layer clears its scripted-event timers here. */
  protected clearExtraTimers(): void {
  }

  protected wireClient(): void {
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
        const meJid = client.getCredentials()?.meJid ?? this.state.me
        this.set({
          phase: 'online',
          session: 'ok',
          me: meJid,
          reconnection: null,
          error: null,
          note: null,
        })
        this.handleAccountSwitch(meJid)
        void this.afterOpen()
        return
      }
      if (event.isLogout) {
        // The device was unlinked (phone-side logout / server purge).
        // Like WhatsApp Web, logout drops the local history — the next
        // number that pairs starts from a clean slate and re-syncs.
        this.qrAttempt = 0
        void this.resetLocalHistory()
        this.set({
          phase: 'pairing',
          session: 'relink',
          me: null,
          activeJid: null,
          qr: null,
          pairingCode: null,
          reconnection: null,
          note: 'This device was unlinked from the phone. Local history was cleared (like WhatsApp Web) — scan again (any number) to re-pair.',
        })
        void client.connect().catch((err) => this.set({ error: errorMessage(err) }))
        return
      }
      this.scheduleReconnect(event.reason)
    })

    client.on('message', (event) => {
      this.ingestMessage(event)
    })

    try {
      const anyOn = (client as unknown as { on: (ev: string, cb: (e: never) => void) => void }).on.bind(client)
      anyOn('message_unavailable', ((event: never) => {
        this.ingestUnavailable(event as unknown as WaIncomingUnavailableMessageEvent)
      }) as never)
    } catch {
      // older zapo without message_unavailable — view-once fallback still works via placeholder
    }

    client.on('history_sync_chunk', (event) => {
      const progress = typeof event.progress === 'number' ? event.progress : null
      this.set({ historyProgress: progress })
      if (this.progressTimer !== null) clearTimeout(this.progressTimer)
      this.progressTimer = setTimeout(() => this.set({ historyProgress: null }), 5_000)
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

    client.on('newsletter', (event) => this.ingestNewsletterEvent(event as unknown as Record<string, unknown>))
    client.on('newsletter_message_update', (event) => this.ingestNewsletterEvent(event as unknown as Record<string, unknown>))
  }

  protected async afterOpen(): Promise<void> {
    const client = this.client
    if (!client || this.disposed) return
    void client.presence.send('available').catch(() => undefined)
    void this.loadChannels()
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
    }
    if (this.activeJid) void this.activateChat(this.activeJid, true)
  }

  protected scheduleReconnect(reason?: string): void {
    if (this.disposed || this.reconnectTimer !== null) return
    const max = Math.max(1, Math.min(30, getSettings().reconnectAttempts || 10))
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

  /**
   * Per-number history guard — runs on every successful login. When the
   * logged-in number differs from `.auth/active-profile.json` (a different
   * SIM paired after a logout, or the first login ever), the cached chats of
   * the previous owner are dropped from memory and the store, exactly like
   * WhatsApp Web starting from a clean slate. Same number → no-op.
   */
  protected handleAccountSwitch(meJid: string | null | undefined): void {
    if (!meJid) return
    const prev = readActiveProfile()
    if (prev && sameOwner(prev.meJid, meJid)) {
      if (prev.meJid !== meJid) writeActiveProfile(meJid)
      return
    }
    if (!prev) {
      // First run with tracking: adopt whatever is already cached. Wiping
      // here once destroyed a real user's history — never clear blindly.
      writeActiveProfile(meJid)
      return
    }
    void this.resetLocalHistory()
    writeActiveProfile(meJid)
    this.set({
      activeJid: null,
      note: `Switched account — loaded a fresh history for the new number.`,
    })
  }
}
