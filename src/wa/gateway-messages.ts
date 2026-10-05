import { isNewsletterJid, isStatusBroadcastJid } from 'zapo-js'
import type { WaIncomingMessageEvent, WaIncomingUnavailableMessageEvent } from 'zapo-js'
import { GatewayMediaBase } from './gateway-media.js'
import { decodeStoredMessageFull, describeMessage } from './decode.js'
import { backupStoreFile } from './profiles.js'
import { getSettings } from '../config.js'
import type { ThreadData, WaMediaInfo } from './types.js'

export class GatewayMessagesBase extends GatewayMediaBase {
  protected receiptSent = new Set<string>()
  protected contactLookups = new Set<string>()
  protected oldestBeforeRequest = new Map<string, string | null>()
  protected hydrateTimer: ReturnType<typeof setTimeout> | null = null

  protected ingestMessage(event: WaIncomingMessageEvent): void {
    const jid = event.key.remoteJid
    if (!jid || isStatusBroadcastJid(jid)) return
    // Channel posts arrive here too, as decoded proto bodies — the old code
    // dropped them, leaving channels forever empty.
    const isChannel = event.key.isNewsletter === true || isNewsletterJid(jid)

    const t = this.thread(jid)
    const id = event.key.id
    const serverId = typeof event.key.serverId === 'number' ? event.key.serverId : undefined
    const ts = (event.timestampSeconds ?? Math.floor(Date.now() / 1000)) * 1000
    const described = describeMessage(event.message, event.expirationSeconds)
    const text = described.text
    if (described.media || event.message) this.rememberMedia(jid, id, event.message as unknown, event)

    if (event.pushName) {
      if (event.key.isGroup && event.key.participant && !event.key.fromMe) {
        t.senderNames[event.key.participant] = event.pushName
      } else if (!event.key.isGroup && !isChannel && !t.contactResolved) {
        // Pushname is a fallback — a saved-contact name (resolved async below)
        // always wins over it, like the phone app.
        t.name = event.pushName
      }
    }
    if (!event.key.isGroup && !isChannel) void this.resolveNameFromContacts(jid)

    const existing = t.messages.find(
      (m) => (m.id === id && m.fromMe === event.key.fromMe) || (serverId !== undefined && m.serverId === serverId),
    )
    if (existing) {
      if (text) existing.text = text
      if (described.media) existing.media = described.media
      if (t.lastTs < ts) t.lastTs = ts
      this.bump(t)
      return
    }

    const senderName = event.key.isGroup
      ? (event.key.participant ? t.senderNames[event.key.participant] : undefined) ?? event.pushName
      : undefined

    t.messages.push({
      id,
      ...(serverId !== undefined ? { serverId } : {}),
      fromMe: event.key.fromMe,
      senderJid: event.key.participant,
      senderName,
      text,
      ts,
      status: 'sent',
      media: described.media ?? null,
    })
    t.typing = false
    t.lastTs = Math.max(t.lastTs, ts)

    if (!event.key.fromMe) {
      // Channels use view receipts, not chat read receipts.
      if (this.activeJid === jid && !isChannel) {
        void this.markRead(event)
      } else {
        t.unread += 1
        if (getSettings().bellOnNewMessage) process.stdout.write('\x07')
      }
    }
    this.bump(t)
    // Professional touch: incoming photos fetch themselves in the background
    // so they render inline without pressing `o` first. Live messages only —
    // history stays on-demand, view-once stays manual, demo has no server.
    if (
      !event.key.fromMe &&
      getSettings().autoDownload &&
      described.media?.kind === 'image' &&
      !described.media.viewOnce &&
      described.media.downloadable &&
      !this.state.demo &&
      this.client
    ) {
      void this.ensureMediaFile(jid, id).catch(() => undefined)
    }
  }

  protected ingestUnavailable(event: WaIncomingUnavailableMessageEvent): void {
    try {
      const key = (event as unknown as { key?: { remoteJid?: string; id?: string; fromMe?: boolean; participant?: string; isGroup?: boolean } }).key
      const jid = key?.remoteJid
      if (!jid || isStatusBroadcastJid(jid) || isNewsletterJid(jid)) return
      const t = this.thread(jid)
      const id = key?.id ?? `unavail-${Date.now()}`
      const ts = ((event as unknown as { timestampSeconds?: number }).timestampSeconds ?? Math.floor(Date.now() / 1000)) * 1000
      const kind = (event as unknown as { kind?: string }).kind as WaMediaInfo['unavailableKind'] | undefined
      const text =
        kind === 'view_once'
          ? '[👁️ view-once no longer available]'
          : kind === 'hosted' || kind === 'bot'
            ? '[media no longer available]'
            : '[message no longer available — open on phone]'
      if (t.messages.some((m) => m.id === id)) return
      t.messages.push({
        id,
        fromMe: key?.fromMe === true,
        senderJid: key?.participant,
        text,
        ts,
        status: 'read',
        media: { kind: 'image', unavailableKind: (kind ?? 'other') as NonNullable<WaMediaInfo['unavailableKind']>, downloadable: false },
      })
      t.lastTs = Math.max(t.lastTs, ts)
      if (this.activeJid !== jid && !key?.fromMe) {
        t.unread += 1
        if (getSettings().bellOnNewMessage) process.stdout.write('\x07')
      }
      this.bump(t)
    } catch {
    }
  }

  protected async markRead(event: WaIncomingMessageEvent): Promise<void> {
    const client = this.client
    if (!client || !getSettings().readReceipts) return
    const id = event.key.id
    if (!id || this.receiptSent.has(id)) return
    this.receiptSent.add(id)
    try {
      await client.message.sendReceipt(event, { type: 'read' })
    } catch {
    }
  }

  /** Read receipts for messages that arrived while another chat was open. */
  protected async markThreadRead(jid: string): Promise<void> {
    const client = this.client
    if (!client || !getSettings().readReceipts || isNewsletterJid(jid)) return
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
      }
    }
  }

  /** Show the saved contact name, else the phone number — never a raw JID/LID. */
  protected async resolveNameFromContacts(jid: string): Promise<void> {
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
    }
  }

  protected scheduleHydrate(): void {
    if (this.hydrateTimer !== null) clearTimeout(this.hydrateTimer)
    this.hydrateTimer = setTimeout(() => {
      this.hydrateTimer = null
      void this.hydrateFromStore().then(() => this.resolveOlderRequests())
    }, 1200)
  }

  protected resolveOlderRequests(): void {
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

  protected async hydrateFromStore(): Promise<void> {
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
              const decoded = decodeStoredMessageFull(m.messageBytes)
              if (decoded.raw) this.rememberMedia(rec.jid, m.id, decoded.raw, null)
              t.messages.push({
                id: m.id,
                fromMe: m.fromMe,
                senderJid: participant,
                senderName: participant ? t.senderNames[participant] : undefined,
                text: decoded.text,
                ts: m.timestampMs ?? Date.now(),
                status: 'read',
                media: decoded.media ?? null,
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
          }
        }),
      )
    } catch {
    }
  }

  /** Drop the in-memory conversation cache (logout / account switch). */
  protected clearThreadCache(): void {
    this.threads.clear()
    this.viewCache = []
    this.viewDirty = true
    this.activeJid = null
    this.receiptSent.clear()
    this.contactLookups.clear()
    this.oldestBeforeRequest.clear()
  }

  /**
   * Drop this account's local history (memory + store), with a timestamped
   * backup first. A false account-switch must never mean lost chats again.
   */
  protected async resetLocalHistory(): Promise<void> {
    this.clearThreadCache()
    this.clearMediaCaches()
    backupStoreFile()
    await this.clearStoredMailbox()
  }

  /**
   * Drop the persisted chat cache for this session (logout / account switch).
   * Auth + signal state are untouched — only threads/messages, so the next
   * login syncs a fresh history like WhatsApp Web. Best-effort by design.
   */
  protected async clearStoredMailbox(): Promise<void> {
    try {
      const sess = this.store?.session('default')
      if (!sess) return
      try {
        await sess.threads.clear()
      } catch {
      }
      try {
        await sess.messages.clear()
      } catch {
      }
    } catch {
    }
  }
}

export type { ThreadData }
