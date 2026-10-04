export type MediaKind = 'image' | 'video' | 'ptv' | 'gif' | 'audio' | 'voice' | 'document' | 'sticker'

export type WaMediaKind = 'image' | 'video' | 'gif' | 'ptv' | 'audio' | 'voice' | 'document' | 'sticker'

export interface WaMediaInfo {
  kind: WaMediaKind
  caption?: string
  fileName?: string
  mimetype?: string
  durationSec?: number
  isPtt?: boolean
  viewOnce?: boolean
  ephemeral?: boolean
  expiresInSec?: number
  localPath?: string
  opened?: boolean
  unavailableKind?: 'view_once' | 'hosted' | 'bot' | 'other'
  downloadable?: boolean
}

export interface ProfileView {
  name: string | null
  about: string | null
  privacy: Record<string, string> | null
}

/** The currently playing voice note — drives the WhatsApp-style player UI. */
export interface WaPlaybackState {
  jid: string
  id: string
  durationSec: number
  startedAtMs: number
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
  media?: WaMediaInfo | null
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
  /** Group size from the last metadata refresh (drives the info panel). */
  memberCount?: number
  /** Group description, when the server provides one. */
  groupDesc?: string
  /** Bumped on every mutation — memo stability key for React components. */
  rev: number
}

export interface ThreadData extends WaThread {
  senderNames: Record<string, string>
  historyRequested: boolean
  nameSet: boolean
  /** A saved-contact display name resolved — it wins over pushName forever. */
  contactResolved: boolean
}

export type WaPhase = 'boot' | 'pairing' | 'online' | 'reconnecting'
export type WaSession = 'ok' | 'relink'
export type Screen = 'main' | 'settings' | 'chatMenu' | 'help'

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
export interface LooseMsg {
  conversation?: string | null
  extendedTextMessage?: { text?: string | null } | null
  imageMessage?: { caption?: string | null; fileName?: string | null; mimetype?: string | null; viewOnce?: boolean | null } | null
  videoMessage?: { caption?: string | null; gifPlayback?: boolean | null; mimetype?: string | null; seconds?: number | null; viewOnce?: boolean | null } | null
  ptvMessage?: { caption?: string | null; mimetype?: string | null; seconds?: number | null; viewOnce?: boolean | null } | null
  audioMessage?: { ptt?: boolean | null; seconds?: number | null; mimetype?: string | null; viewOnce?: boolean | null } | null
  documentMessage?: { caption?: string | null; fileName?: string | null; mimetype?: string | null } | null
  stickerMessage?: { fileName?: string | null; mimetype?: string | null } | null
  pollCreationMessage?: { name?: string | null } | null
  locationMessage?: { name?: string | null } | null
  liveLocationMessage?: unknown
  contactMessage?: { displayName?: string | null } | null
  ephemeralMessage?: { message?: unknown } | null
  viewOnceMessage?: { message?: unknown } | null
  viewOnceMessageV2?: { message?: unknown } | null
  documentWithCaptionMessage?: { message?: unknown } | null
}

/** Allowed values per privacy category (from the zapo privacy guide). */
export const PRIVACY_CYCLES: Record<string, readonly string[]> = {
  lastSeen: ['all', 'contacts', 'contact_blacklist', 'none'],
  profilePicture: ['all', 'contacts', 'contact_blacklist', 'none'],
  about: ['all', 'contacts', 'contact_blacklist', 'none'],
  groupAdd: ['all', 'contacts', 'contact_blacklist', 'none'],
  online: ['all', 'none'],
  readReceipts: ['all', 'none'],
}
