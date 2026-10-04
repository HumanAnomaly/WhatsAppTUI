import { getContentType, proto, unwrapMessage } from 'zapo-js'
import type { LooseMsg, WaMediaInfo } from './types.js'

export function formatMediaDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return ''
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Rich decode: placeholder text + structured media info (view-once, ptt, gif, ptv, ephemeral). */
export function describeMessage(
  message: unknown,
  expirationSeconds?: number,
): { text: string; media?: WaMediaInfo | null } {
  if (!message || typeof message !== 'object') return { text: '' }
  const raw = message as Record<string, any>
  let unwrapped: Record<string, any> = raw
  try {
    unwrapped = (unwrapMessage(raw as never) as unknown as Record<string, any>) ?? raw
  } catch {
    unwrapped = raw
  }
  const hasEphemeral = raw['ephemeralMessage'] != null
  const hasViewOnceWrapper = raw['viewOnceMessage'] != null || raw['viewOnceMessageV2'] != null
  const ephemeral = hasEphemeral || (expirationSeconds != null && expirationSeconds > 0)

  const conv = (unwrapped as LooseMsg).conversation
  if (conv) return { text: ephemeral ? `${conv} · ⏳` : conv }
  const ext = (unwrapped as LooseMsg).extendedTextMessage?.text
  if (ext) return { text: ephemeral ? `${ext} · ⏳` : ext }

  const inlineOnce =
    (unwrapped as any)?.imageMessage?.viewOnce === true ||
    (unwrapped as any)?.videoMessage?.viewOnce === true ||
    (unwrapped as any)?.ptvMessage?.viewOnce === true ||
    (unwrapped as any)?.audioMessage?.viewOnce === true
  const viewOnce = hasViewOnceWrapper || inlineOnce
  const oncePrefix = viewOnce ? '👁️ Once ' : ''
  const ephSuffix = ephemeral ? ' · ⏳' : ''

  const img = (unwrapped as LooseMsg).imageMessage as any
  if (img) {
    const caption = img.caption ?? undefined
    const media: WaMediaInfo = {
      kind: 'image',
      caption,
      mimetype: img.mimetype ?? undefined,
      viewOnce: viewOnce || undefined,
      ephemeral: ephemeral || undefined,
      expiresInSec: expirationSeconds ?? undefined,
      downloadable: true,
    }
    return { text: withCaption(`${oncePrefix}[📷 photo]`, caption) + ephSuffix, media }
  }
  const vid = (unwrapped as LooseMsg).videoMessage as any
  if (vid) {
    const isGif = vid.gifPlayback === true
    const dur = formatMediaDuration(vid.seconds)
    const caption = vid.caption ?? undefined
    const media: WaMediaInfo = {
      kind: isGif ? 'gif' : 'video',
      caption,
      mimetype: vid.mimetype ?? undefined,
      durationSec: typeof vid.seconds === 'number' ? vid.seconds : undefined,
      viewOnce: viewOnce || undefined,
      ephemeral: ephemeral || undefined,
      expiresInSec: expirationSeconds ?? undefined,
      downloadable: true,
    }
    const label = isGif ? '[🎞️ gif]' : dur ? `[🎬 video ${dur}]` : '[🎬 video]'
    return { text: withCaption(`${oncePrefix}${label}`, caption) + ephSuffix, media }
  }
  const ptv = (unwrapped as LooseMsg).ptvMessage as any
  if (ptv) {
    const dur = formatMediaDuration(ptv.seconds)
    const media: WaMediaInfo = {
      kind: 'ptv',
      mimetype: ptv.mimetype ?? undefined,
      durationSec: typeof ptv.seconds === 'number' ? ptv.seconds : undefined,
      viewOnce: viewOnce || undefined,
      ephemeral: ephemeral || undefined,
      expiresInSec: expirationSeconds ?? undefined,
      downloadable: true,
    }
    return { text: `${oncePrefix}[⭕ video note${dur ? ` ${dur}` : ''}]${ephSuffix}`, media }
  }
  const aud = (unwrapped as LooseMsg).audioMessage as any
  if (aud) {
    const isPtt = aud.ptt === true
    const dur = formatMediaDuration(aud.seconds)
    const media: WaMediaInfo = {
      kind: isPtt ? 'voice' : 'audio',
      mimetype: aud.mimetype ?? undefined,
      durationSec: typeof aud.seconds === 'number' ? aud.seconds : undefined,
      isPtt: isPtt || undefined,
      viewOnce: viewOnce || undefined,
      ephemeral: ephemeral || undefined,
      expiresInSec: expirationSeconds ?? undefined,
      downloadable: true,
    }
    const label = isPtt ? `[🎤 voice${dur ? ` ${dur}` : ''}]` : dur ? `[🎧 audio ${dur}]` : '[🎧 audio]'
    return { text: `${oncePrefix}${label}${ephSuffix}`, media }
  }
  const doc = (unwrapped as LooseMsg).documentMessage as any
  if (doc) {
    const caption = doc.caption ?? undefined
    const media: WaMediaInfo = {
      kind: 'document',
      caption,
      fileName: doc.fileName ?? undefined,
      mimetype: doc.mimetype ?? undefined,
      ephemeral: ephemeral || undefined,
      expiresInSec: expirationSeconds ?? undefined,
      downloadable: true,
    }
    return { text: withCaption(`[📄 ${doc.fileName ?? 'document'}]`, caption) + ephSuffix, media }
  }
  if ((unwrapped as LooseMsg).stickerMessage) {
    const st = (unwrapped as any).stickerMessage as any
    const media: WaMediaInfo = {
      kind: 'sticker',
      mimetype: st?.mimetype ?? undefined,
      ephemeral: ephemeral || undefined,
      expiresInSec: expirationSeconds ?? undefined,
      downloadable: true,
    }
    return { text: `${oncePrefix}[✨ sticker]${ephSuffix}`, media }
  }
  if ((unwrapped as LooseMsg).pollCreationMessage)
    return { text: `[📊 poll: ${(unwrapped as LooseMsg).pollCreationMessage?.name ?? '?'}]${ephSuffix}` }
  if ((unwrapped as LooseMsg).locationMessage)
    return { text: `[📍 ${(unwrapped as LooseMsg).locationMessage?.name ?? 'location'}]${ephSuffix}` }
  if ((unwrapped as LooseMsg).liveLocationMessage) return { text: `[📍 live location]${ephSuffix}` }
  if ((unwrapped as LooseMsg).contactMessage)
    return { text: `[📇 ${(unwrapped as LooseMsg).contactMessage?.displayName ?? 'contact'}]${ephSuffix}` }
  try {
    const kind = getContentType(unwrapped as Parameters<typeof getContentType>[0])
    if (kind) {
      if (viewOnce || ephemeral) return { text: `${oncePrefix}[${String(kind)}]${ephSuffix}` }
      return { text: `[${String(kind)}]` }
    }
  } catch {
  }
  if (viewOnce) return { text: `${oncePrefix}[view-once message]${ephSuffix}`, media: { kind: 'image', viewOnce: true, ephemeral: ephemeral || undefined, downloadable: false } }
  return { text: '' }
}

export function renderMessageText(message: unknown): string {
  return describeMessage(message).text
}

export function withCaption(prefix: string, caption?: string | null): string {
  return caption ? `${prefix} ${caption}` : prefix
}

export function inferDemoMedia(text: string): WaMediaInfo | null {
  if (text.startsWith('[📷 photo]')) return { kind: 'image', caption: text.slice('[📷 photo]'.length).trim() || undefined, downloadable: false }
  if (text.startsWith('[🎬 video]')) return { kind: 'video', caption: text.slice('[🎬 video]'.length).trim() || undefined, downloadable: false }
  if (text.startsWith('[🎞️ gif]')) return { kind: 'gif', downloadable: false }
  if (text.startsWith('[⭕ video note]')) return { kind: 'ptv', downloadable: false }
  if (text.startsWith('[🎤 voice')) return { kind: 'voice', isPtt: true, durationSec: 23, downloadable: false }
  if (text.startsWith('[🎧 audio')) return { kind: 'audio', downloadable: false }
  if (text.startsWith('[📄 ')) return { kind: 'document', fileName: 'document', downloadable: false }
  if (text.startsWith('[✨ sticker]')) return { kind: 'sticker', downloadable: false }
  if (text.includes('👁️')) return { kind: 'image', viewOnce: true, downloadable: false }
  return null
}

export interface NewsletterNode {
  tag: string
  attrs?: Record<string, unknown>
  content?: unknown
}

export function extractNodeText(node: NewsletterNode): string {
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

export function collectNewsletterMessages(node: NewsletterNode, out: Array<{ id?: string; ts?: number; text: string }> = []): Array<{ id?: string; ts?: number; text: string }> {
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
  return decodeStoredMessageFull(bytes).text
}

export function decodeStoredMessageFull(bytes?: Uint8Array): { text: string; media?: WaMediaInfo | null; raw?: proto.Message | null } {
  if (!bytes || bytes.length === 0) return { text: '' }
  try {
    const raw = proto.Message.decode(bytes) as unknown as proto.Message
    const described = describeMessage(raw)
    return { text: described.text, media: described.media ?? null, raw }
  } catch {
    return { text: '' }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
