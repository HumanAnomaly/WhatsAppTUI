import { memo, useRef } from 'react'
import { Box, Text } from 'ink'
import { currentTheme } from '../theme.js'
import { displayJid, formatFullTime, visualWidth } from '../format.js'
import { useHover, useMouse, type MouseEvt } from '../mouse.js'
import type { WaMsg, WaThread } from '../wa/gateway.js'

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

/** A run of consecutive messages from the same sender, rendered as one unit. */
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
  status: WaMsg['status']
  hovered: boolean
  width: number
}

const Bubble = memo(function Bubble({ msg, status, hovered, width }: BubbleProps) {
  const theme = currentTheme()
  void status // memo contract: re-render when delivery status changes
  const maxWidth = Math.max(18, Math.min(72, Math.floor(width * 0.72)))
  const inBg = hovered ? theme.bubbleInHover : theme.bubbleIn
  const outBg = hovered ? theme.bubbleOutHover : theme.bubbleOut
  if (msg.fromMe) {
    return (
      <Box justifyContent="flex-end" paddingX={1}>
        <Box flexDirection="column" width={maxWidth} alignItems="flex-end">
          <Text backgroundColor={outBg} color={theme.text} wrap="wrap">{` ${msg.text} `}</Text>
          <Text backgroundColor={outBg} color={msg.status === 'read' ? theme.info : theme.dim} bold={msg.status === 'read'}>
            {` ${formatFullTime(msg.ts)}${ticks(msg)} `}
          </Text>
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1} alignItems="flex-start">
      <Box flexDirection="column" width={maxWidth} alignItems="flex-start">
        <Text backgroundColor={inBg} color={theme.text} wrap="wrap">{` ${msg.text} `}</Text>
        <Text backgroundColor={inBg} color={theme.dimmer}>{` ${formatFullTime(msg.ts)} `}</Text>
      </Box>
    </Box>
  )
})

interface MessageListProps {
  thread: WaThread | null
  /** Thread revision — the memo key that keeps this pane live. */
  rev: number
  width: number
  height: number
  scrollOffset: number
  /** 0-based screen row where this list begins (hover/click mapping). */
  top: number
  /** Called when a message is clicked — the hovered message is copied. */
  onCopy?: (text: string) => void
}

interface LineSpan {
  start: number
  end: number
  id: string
  text: string
}

export const MessageList = memo(function MessageList({ thread, rev, width, height, scrollOffset, top, onCopy }: MessageListProps) {
  void rev
  const theme = currentTheme()
  const hover = useHover()
  const hoverRow = hover ? hover.y - 1 - top : -1
  const maxWidth = Math.max(18, Math.min(72, Math.floor(width * 0.72)))
  const rowsFor = (text: string): number =>
    Math.max(1, Math.ceil(visualWidth(` ${text} `) / Math.max(10, maxWidth - 2)))

  // Pass 1 — layout: map every message to its line span inside the pane.
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
        const tl = rowsFor(m.text)
        lineMap.push({ start: row, end: row + tl - 1, id: m.id, text: m.text })
        row += tl + 1
      }
      prevKey = b.key
    }
  }
  const hoveredId = hoverRow >= 0 ? lineMap.find((l) => hoverRow >= l.start && hoverRow <= l.end)?.id : undefined

  // Pass 2 — render.
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
          node: <Bubble msg={m} status={m.status} hovered={hoveredId === m.id} width={width} />,
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

  // Click a message = copy it. The line map is the single source of truth for
  // which message the cursor is on, and the hover highlight proves it.
  const stateRef = useRef({ lineMap, top, onCopy })
  stateRef.current = { lineMap, top, onCopy }
  const onMouse = (e: MouseEvt): void => {
    if (e.kind !== 'click') return
    const row = e.y - 1 - stateRef.current.top
    const hit = stateRef.current.lineMap.find((l) => row >= l.start && row <= l.end)
    if (hit) stateRef.current.onCopy?.(hit.text)
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
  const theme = currentTheme()
  const isGroup = thread?.jid.endsWith('@g.us') ?? false
  const title = (thread ? thread.name : mobile ? 'select a chat' : 'WhatsAppTUI') + (thread?.typing ? ' typing…' : '')
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
