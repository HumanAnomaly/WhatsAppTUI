import type { WaClient, WaStore } from 'zapo-js'
import { displayJid } from '../format.js'
import { getSettings } from '../config.js'
import type { GatewayState, ThreadData, WaThread } from './types.js'

/**
 * Root of the gateway class chain (state → media → messages → channels →
 * profile → actions → connection → demo). Holds the reactive state, the
 * identity-stable thread cache, and the shared client/store handles so every
 * layer can use `this.*` exactly like the former mega-class.
 */
export class GatewayStateBase {
  protected listeners = new Set<() => void>()
  protected notifyScheduled: ReturnType<typeof setTimeout> | null = null

  protected client: WaClient | null = null
  protected store: WaStore | null = null
  protected disposed = false

  protected threads = new Map<string, ThreadData>()
  protected viewDirty = true
  protected viewCache: WaThread[] = []
  protected activeJid: string | null = null
  protected reconnectAttempt = 0
  protected qrAttempt = 0

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
    syncing: false,
    profile: null,
    demo: false,
    download: null,
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

  protected set(patch: Partial<GatewayState>): void {
    this.state = { ...this.state, ...patch }
    this.scheduleNotify()
  }

  protected scheduleNotify(): void {
    if (this.notifyScheduled !== null || this.disposed) return
    this.notifyScheduled = setTimeout(() => {
      this.notifyScheduled = null
      for (const listener of this.listeners) listener()
    }, 40)
  }

  /** Flag thread data as changed and schedule a coalesced UI update. */
  protected bump(t: ThreadData): void {
    t.rev += 1
    this.viewDirty = true
    this.scheduleNotify()
  }

  protected pushStep(step: string): void {
    this.set({ bootSteps: [...this.state.bootSteps, step] })
  }

  protected thread(jid: string): ThreadData {
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
}
