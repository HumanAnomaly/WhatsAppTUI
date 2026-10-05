import { memo, useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { COLLAPSE_AT, chatKindIcon, collapseText, displayJid, formatFullTime, visualWidth } from '../format.js'
import { useHover, useMouse, type MouseEvt } from '../mouse.js'
import { usePlayback, useTheme, useTicker } from '../hooks.js'
import { gateway, formatMediaDuration, type WaMsg, type WaThread } from '../wa/gateway.js'
import { renderImageCells, type ImageCells } from '../media.js'

const SENDER_COLORS = ['#7FDBCA', '#E9C46A', '#9BB8FF', '#FFB4A2', '#B5E48C', '#D8A7FF', '#8ECAE6']

function senderColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return SENDER_COLORS[h % SENDER_COLORS.length]!
}

function ticks(msg: WaMsg): string {
  if (!msg.fromMe) return ''
  if (msg.status === 'pending') return ' ◌'
  if (msg.status === 'failed') return ' ✖'
  if (msg.status === 'read') return ' ✓✓'
  return ' ✓'
}

interface MsgBlock {
  key: string
  senderKey: string
  name?: string
  msgs: WaMsg[]
}

const BLOCK_GAP_MS = 5 * 60_000

function isSystemMsg(x: MsgBlock | WaMsg): x is WaMsg {
  return (x as WaMsg).system === true
}

function buildBlocks(msgs: WaMsg[]): Array<MsgBlock | WaMsg> {
  const out: Array<MsgBlock | WaMsg> = []
  let current: MsgBlock | null = null
  for (const m of msgs) {
    if (m.system) {
      current = null
      out.push(m)
      continue
    }
    const senderKey = m.fromMe ? '@me' : m.senderJid ?? '@peer'
    if (
      current === null ||
      current.senderKey !== senderKey ||
      m.ts - current.msgs[current.msgs.length - 1]!.ts > BLOCK_GAP_MS
    ) {
      current = { key: `${m.id}`, senderKey, name: m.senderName, msgs: [m] }
      out.push(current)
    } else {
      current.msgs.push(m)
      current.key += `+${m.id}`
    }
  }
  return out
}

interface BubbleProps {
  msg: WaMsg
  text: string
  status: WaMsg['status']
  hovered: boolean
  width: number
}

const imgColsFor = (maxWidth: number): number => Math.max(12, Math.min(44, maxWidth - 6))

// Inline preview treatment: a small framed thumbnail (never full-bleed), so
// bright photos can't swallow the surrounding chat. Both the bubble and the
// row counter below must use this — never call imageCellsFor directly.
const PREVIEW_MAX_COLS = 30
const PREVIEW_MAX_ROWS = 8
const PREVIEW_PAD = 1

const cellsCache = new Map<string, ImageCells | null>()
function imageCellsFor(path: string, maxCols: number, maxRows = 24): ImageCells | null {
  const key = `${path}|${maxCols}|${maxRows}`
  if (!cellsCache.has(key)) {
    try {
      cellsCache.set(key, renderImageCells(path, maxCols, maxRows))
    } catch {
      cellsCache.set(key, null)
    }
  }
  return cellsCache.get(key) ?? null
}

function previewCells(localPath: string, maxWidth: number): ImageCells | null {
  return imageCellsFor(localPath, Math.min(imgColsFor(maxWidth), PREVIEW_MAX_COLS), PREVIEW_MAX_ROWS)
}

const ImageCellsView = memo(function ImageCellsView({ cells }: { cells: ImageCells }) {
  return (
    <Box flexDirection="column">
      {cells.lines.map((runs, i) => (
        <Text key={i}>
          {runs.map((r, j) => (
            <Text key={j} color={r.fg} backgroundColor={r.bg}>
              {'▀'.repeat(r.n)}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
})

/** Row count a media message occupies — must match Bubble's layout exactly. */
function mediaMsgRows(m: WaMsg, maxWidth: number, rowsFor: (text: string) => number): number {
  const media = m.media!
  if (media.kind === 'voice' || media.kind === 'audio') {
    return rowsFor(voiceRowText(m, maxWidth, true, media.durationSec ?? 0)) + 1
  }
  if (media.kind !== 'image' || !media.localPath) return rowsFor(m.text) + 1
  const cells = previewCells(media.localPath, maxWidth)
  if (!cells) return rowsFor(m.text) + 1
  const capRows = media.caption ? rowsFor(media.caption) : 0
  return cells.rows + capRows + 1 + PREVIEW_PAD * 2
}

/**
 * Voice-note row, WhatsApp-style: mic, play/pause, progress bar, duration.
 * Laid out with the (longest) playing form so the row never reflows.
 */
function voiceRowText(msg: WaMsg, maxWidth: number, playing: boolean, elapsed: number): string {
  const dur = msg.media?.durationSec ?? 0
  const barWidth = Math.max(6, Math.min(20, maxWidth - 19))
  let bar = ''
  if (dur > 0) {
    const frac = playing && dur > 0 ? Math.min(1, elapsed / dur) : 0
    const head = Math.round(frac * barWidth)
    if (head <= 0) bar = '─'.repeat(barWidth)
    else if (head >= barWidth) bar = '━'.repeat(barWidth)
    else bar = '━'.repeat(head) + '╸' + '─'.repeat(barWidth - head - 1)
  }
  const icon = playing ? '⏸' : '▶'
  const time =
    dur > 0
      ? playing
        ? `${formatMediaDuration(Math.floor(elapsed))} / ${formatMediaDuration(dur)}`
        : formatMediaDuration(dur)
      : '—'
  return `🎤 ${icon}${bar ? ` ${bar}` : ''} ${time}`
}

const VoiceRow = memo(function VoiceRow({ msg, hovered, width }: { msg: WaMsg; hovered: boolean; width: number }) {
  const theme = useTheme()
  const pb = usePlayback()
  const active = pb !== null && pb.id === msg.id
  // Tick only while this row is the playing one.
  const tick = useTicker(active ? 400 : 60_000)
  void tick
  const maxWidth = Math.max(18, Math.min(72, Math.floor(width * 0.72)))
  const bg = hovered ? (msg.fromMe ? theme.bubbleOutHover : theme.bubbleInHover) : msg.fromMe ? theme.bubbleOut : theme.bubbleIn
  const dur = msg.media?.durationSec ?? 0
  const elapsed = active && pb ? Math.floor((Date.now() - pb.startedAtMs) / 1000) : 0
  const text = voiceRowText(msg, maxWidth, active, Math.min(elapsed, dur))
  return (
    <Text backgroundColor={bg} color={theme.text} wrap="truncate-end">
      {` ${text} `}
    </Text>
  )
})

const Bubble = memo(function Bubble({ msg, text, status, hovered, width }: BubbleProps) {
  const theme = useTheme()
  void status // memo contract: re-render when delivery status changes
  const maxWidth = Math.max(18, Math.min(72, Math.floor(width * 0.72)))
  const inBg = hovered ? theme.bubbleInHover : theme.bubbleIn
  const outBg = hovered ? theme.bubbleOutHover : theme.bubbleOut
  const mediaMeta = msg.media
    ? [
        msg.media.localPath ? '💾 saved' : msg.media.downloadable ? 'o open · d save' : null,
        msg.media.kind === 'voice' || msg.media.kind === 'audio' ? 'p play' : null,
        msg.media.viewOnce ? (msg.media.opened ? '👁️ opened' : '👁️ once') : null,
        msg.media.unavailableKind ? 'unavailable' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const metaText = `${formatFullTime(msg.ts)}${ticks(msg)}${mediaMeta ? ` · ${mediaMeta}` : ''}`
  const metaLine = (bg: string) => (
    <Text backgroundColor={bg} color={msg.fromMe ? (msg.status === 'read' ? theme.info : theme.dim) : theme.dimmer} bold={msg.fromMe && msg.status === 'read'}>
      {` ${metaText} `}
    </Text>
  )

  if (msg.media?.kind === 'voice' || msg.media?.kind === 'audio') {
    return (
      <Box paddingX={1} flexDirection="row" justifyContent={msg.fromMe ? 'flex-end' : 'flex-start'}>
        <Box flexDirection="column" alignItems={msg.fromMe ? 'flex-end' : 'flex-start'}>
          <VoiceRow msg={msg} hovered={hovered} width={width} />
          {metaLine(msg.fromMe ? outBg : inBg)}
        </Box>
      </Box>
    )
  }

  const imgCells =
    msg.media?.kind === 'image' && msg.media.localPath
      ? previewCells(msg.media.localPath, maxWidth)
      : null
  if (imgCells) {
    const bg = msg.fromMe ? outBg : inBg
    return (
      <Box paddingX={1} flexDirection="row" justifyContent={msg.fromMe ? 'flex-end' : 'flex-start'}>
        <Box flexDirection="column" alignItems={msg.fromMe ? 'flex-end' : 'flex-start'}>
          <Box backgroundColor={bg} paddingX={PREVIEW_PAD} paddingY={PREVIEW_PAD}>
            <ImageCellsView cells={imgCells} />
          </Box>
          {msg.media!.caption ? (
            <Text backgroundColor={bg} color={theme.text} wrap="wrap">{` ${msg.media!.caption} `}</Text>
          ) : null}
          {metaLine(bg)}
        </Box>
      </Box>
    )
  }
  if (msg.fromMe) {
    return (
      <Box justifyContent="flex-end" paddingX={1}>
        <Box flexDirection="column" width={maxWidth} alignItems="flex-end">
          <Text backgroundColor={outBg} color={theme.text} wrap="wrap">{` ${text} `}</Text>
          {metaLine(outBg)}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1} alignItems="flex-start">
      <Box flexDirection="column" width={maxWidth} alignItems="flex-start">
        <Text backgroundColor={inBg} color={theme.text} wrap="wrap">{` ${text} `}</Text>
        {metaLine(inBg)}
      </Box>
    </Box>
  )
})

interface MessageListProps {
  thread: WaThread | null
  rev: number
  width: number
  height: number
  scrollOffset: number
  top: number
  onCopy?: (text: string) => void
  onMediaOpen?: (id: string) => void
  onMediaPlay?: (id: string) => void
}

interface LineSpan {
  start: number
  end: number
  id: string
  text: string
}

export const MessageList = memo(function MessageList({ thread, rev, width, height, scrollOffset, top, onCopy, onMediaOpen, onMediaPlay }: MessageListProps) {
  void rev
  const theme = useTheme()
  const hover = useHover()
  const hoverRow = hover ? hover.y - 1 - top : -1
  const maxWidth = Math.max(18, Math.min(72, Math.floor(width * 0.72)))
  const rowsFor = (text: string): number =>
    Math.max(1, Math.ceil(visualWidth(` ${text} `) / Math.max(10, maxWidth - 2)))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  useEffect(() => {
    setExpanded(new Set())
  }, [thread?.jid])

  const isCollapsible = (m: WaMsg): boolean => !m.media && !m.system && rowsFor(m.text) > COLLAPSE_AT
  const displayText = (m: WaMsg): string =>
    !m.media && !m.system && !expanded.has(m.id) ? collapseText(m.text, rowsFor) : m.text

  const blocks: Array<MsgBlock | WaMsg> = []
  const lineMap: LineSpan[] = []
  if (thread && thread.messages.length > 0) {
    const end = Math.max(1, thread.messages.length - scrollOffset)
    const begin = Math.max(0, end - Math.max(1, height))
    blocks.push(...buildBlocks(thread.messages.slice(begin, end)))
    let row = 1 // row 0 is the "older messages" note
    let prevKey: string | null = null
    for (const b of blocks) {
      if (isSystemMsg(b)) {
        row += 1
        prevKey = null
        continue
      }
      if (prevKey !== null) row += 1 // blank line between blocks
      const first = b.msgs[0]!
      if (thread.jid.endsWith('@g.us') && first.senderName) row += 1
      for (const m of b.msgs) {
        const shown = displayText(m)
        const tl = m.media ? mediaMsgRows(m, maxWidth, rowsFor) : rowsFor(shown)
        lineMap.push({ start: row, end: row + tl - 1, id: m.id, text: m.text })
        row += tl + 1
      }
      prevKey = b.key
    }
  }
  const hoveredId = hoverRow >= 0 ? lineMap.find((l) => hoverRow >= l.start && hoverRow <= l.end)?.id : undefined

  useEffect(() => {
    if (!thread) return
    gateway.setHoveredMedia(thread.jid, hoveredId ?? null)
    return () => gateway.setHoveredMedia(thread.jid, null)
  }, [thread, hoveredId])

  const items: Array<{ key: string; node: React.ReactNode }> = []
  if (!thread || thread.messages.length === 0) {
    items.push({
      key: 'empty',
      node: (
        <Box justifyContent="center" paddingY={1}>
          <Text color={theme.dimmer}>
            {thread ? 'no synced messages in this chat yet — scroll up (PgUp) to request older history' : 'pick a chat on the left with ↑ ↓'}
          </Text>
        </Box>
      ),
    })
  } else {
    const isGroup = thread.jid.endsWith('@g.us')
    let prevKey: string | null = null
    for (const b of blocks) {
      if (isSystemMsg(b)) {
        items.push({
          key: b.id,
          node: (
            <Box justifyContent="center" paddingX={1}>
              <Text color={theme.dimmer} italic>{b.text}</Text>
            </Box>
          ),
        })
        prevKey = null
        continue
      }
      if (prevKey !== null) {
        items.push({ key: `gap-${b.key}`, node: <Text>{' '}</Text> })
      }
      const first = b.msgs[0]!
      if (isGroup && first.senderName) {
        items.push({ key: `n-${first.id}`, node: <Text color={senderColor(first.senderName)}>{first.senderName}</Text> })
      }
      for (const m of b.msgs) {
        items.push({
          key: m.id,
          node: <Bubble msg={m} text={displayText(m)} status={m.status} hovered={hoveredId === m.id} width={width} />,
        })
      }
      prevKey = b.key
    }
  }

  const olderNote =
    thread && scrollOffset > 0
      ? thread.loadingOlder
        ? '↑ loading older messages…'
        : `↑ ${scrollOffset} hidden — PgUp for more`
      : thread?.loadingOlder
        ? 'loading older messages…'
        : ''

  const stateRef = useRef({ lineMap, top, onCopy, onMediaOpen, onMediaPlay, thread, expanded, setExpanded, isCollapsible })
  stateRef.current = { lineMap, top, onCopy, onMediaOpen, onMediaPlay, thread, expanded, setExpanded, isCollapsible }
  const onMouse = (e: MouseEvt): void => {
    if (e.kind !== 'click') return
    if (gateway.getSnapshot().screen !== 'main') return
    const row = e.y - 1 - stateRef.current.top
    const hit = stateRef.current.lineMap.find((l) => row >= l.start && row <= l.end)
    if (!hit) return
    const msg = stateRef.current.thread?.messages.find((m) => m.id === hit.id)
    if (msg?.media && !msg.media.unavailableKind && (msg.media.downloadable || msg.media.localPath)) {
      if (msg.media.kind === 'voice' || msg.media.kind === 'audio') stateRef.current.onMediaPlay?.(hit.id)
      else stateRef.current.onMediaOpen?.(hit.id)
      return
    }
    if (msg && stateRef.current.isCollapsible(msg)) {
      const open = stateRef.current.expanded
      if (!open.has(msg.id)) {
        stateRef.current.setExpanded(new Set(open).add(msg.id))
        return
      }
      stateRef.current.setExpanded(new Set([...open].filter((id) => id !== msg.id)))
    }
    stateRef.current.onCopy?.(hit.text)
  }
  useMouse(onMouse)

  return (
    <Box flexDirection="column" height={height} overflowY="hidden">
      <Text color={theme.dimmer}>{olderNote}</Text>
      {items.map((it) => (
        <Box key={it.key} flexDirection="column">{it.node}</Box>
      ))}
    </Box>
  )
})

export const ChatHeader = memo(function ChatHeader({ thread, rev, width, mobile = false, hoverBack = false, hoverKebab = false }: { thread: WaThread | null; rev: number; width: number; mobile?: boolean; hoverBack?: boolean; hoverKebab?: boolean }) {
  void rev
  const theme = useTheme()
  const isGroup = thread?.jid.endsWith('@g.us') ?? false
  const icon = thread ? `${chatKindIcon(thread.jid)} ` : ''
  const title = icon + (thread ? thread.name : mobile ? 'select a chat' : 'WhatsAppTUI') + (thread?.typing ? ' typing…' : '')
  const pad = Math.max(8, width - 6)
  return (
    <Box flexDirection="column" width={width - 2}>
      <Text wrap="truncate-end">
        {mobile ? (
          <Text backgroundColor={hoverBack ? theme.accent : undefined} color={hoverBack ? 'black' : theme.accent} bold>{' ‹ '}</Text>
        ) : (
          <Text>{' '}</Text>
        )}
        <Text color={theme.text} bold>{title.padEnd(pad)}</Text>
        <Text color={hoverKebab ? theme.accent : theme.dimmer} bold={hoverKebab}>{'⋮ '}</Text>
      </Text>
      <Text color={theme.dimmer} wrap="truncate-end">
        {thread ? ` ${isGroup ? 'group chat' : displayJid(thread.jid)}` : ' select a chat'}
      </Text>
    </Box>
  )
})
