import { GatewayMessagesBase } from './gateway-messages.js'
import { collectNewsletterMessages, describeMessage } from './decode.js'
import type { NewsletterNode } from './decode.js'

/** Channel (newsletter) listing, history and live updates. */
export class GatewayChannelsBase extends GatewayMessagesBase {
  async loadChannels(): Promise<void> {
    const client = this.client
    if (this.state.demo || !client) return
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
    }
  }

  protected ingestNewsletterEvent(e: Record<string, unknown>): void {
    const key = e.key as Record<string, unknown> | undefined
    const jid = (e.jid ?? e.newsletterJid ?? key?.remoteJid) as string | undefined
    if (!jid || !jid.endsWith('@newsletter')) return
    const inner = (e.message ?? e) as { message?: unknown }
    const described = describeMessage(inner.message ?? inner)
    const text = described.text
    if (!text) return
    const t = this.thread(jid)
    const id = String(e.serverId ?? e.messageId ?? key?.id ?? `nl-live-${Date.now()}`)
    if (t.messages.some((m) => m.id === id)) return
    const tsSec = Number(e.timestampSeconds ?? e.timestamp ?? 0)
    t.messages.push({ id, fromMe: e.fromMe === true, text, ts: tsSec > 0 ? tsSec * 1000 : Date.now(), status: 'read', media: described.media ?? null })
    t.lastTs = Date.now()
    this.bump(t)
  }
}
