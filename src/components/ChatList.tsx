import { memo, Fragment, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../hooks.js'
import { chatKindIcon, formatMsgTime, padVisual, truncateVisual, visualWidth } from '../format.js'
import type { WaThread } from '../wa/gateway.js'

export type ChatFilter = 'all' | 'groups' | 'direct' | 'channels'

const CHIP_DEFS: Array<[ChatFilter, string]> = [['all', 'All'], ['groups', '👥 Groups'], ['direct', '👤 Direct'], ['channels', '📢 Channels']]

/** 1-based column ranges of the filter chips — must match ChipsRow exactly. */
export const CHIP_ZONES = (() => {
  let x = 2 // after the leading space
  return CHIP_DEFS.map(([id, label]) => {
    const x0 = x
    const x1 = x + label.length + 1 // ' label '
    x = x1 + 3 // two separator spaces
    return { id, x0, x1 }
  })
})()

export function ChipsRow({ filter, hoverChip = -1 }: { filter: ChatFilter; hoverChip?: number }) {
  const theme = useTheme()
  return (
    <Text>
      {' '}
      {CHIP_DEFS.map(([id, label], i) => (
        <Fragment key={id}>
          {i > 0 ? <Text>{'  '}</Text> : null}
          <Text
            backgroundColor={filter === id ? theme.accent : hoverChip === i ? theme.bubbleInHover : theme.bubbleIn}
            color={filter === id ? 'black' : hoverChip === i ? theme.text : theme.dim}
            bold={filter === id || hoverChip === i}
          >
            {` ${label} `}
          </Text>
        </Fragment>
      ))}
    </Text>
  )
}

export function threadPreview(t: WaThread): string {
  if (t.typing) return 'typing…'
  const last = t.messages[t.messages.length - 1]
  if (!last) return 'no messages yet'
  let prefix = ''
  if (last.fromMe) prefix = 'You: '
  else if (t.jid.endsWith('@g.us') && last.senderName) prefix = `${last.senderName}: `
  return prefix + last.text.replace(/\n/g, ' ')
}

interface ChatListProps {
  threads: WaThread[]
  selIdx: number
  width: number
  height: number
  filter: ChatFilter
  start: number
  chips?: boolean
  hoverIdx?: number
  hoverChip?: number
  hoverArchived?: boolean
  archivedCount: number
  archivedView: boolean
  header?: ReactNode
}

export const ChatList = memo(function ChatList({ threads, selIdx, width, height, filter, start, chips = false, hoverIdx = -1, hoverChip = -1, hoverArchived = false, archivedCount, archivedView, header }: ChatListProps) {
  const archivedRowShown = archivedCount > 0 || archivedView
  const maxItems = Math.max(1, Math.floor(Math.max(1, height - 1 - (archivedRowShown ? 1 : 0)) / 2))
  const theme = useTheme()
  const visible = threads.slice(start, start + maxItems)
  const innerWidth = width - 2

  return (
    <Box flexDirection="column" height={height}>
      {header ?? (chips ? (
        <ChipsRow filter={filter} hoverChip={hoverChip} />
      ) : (
        <Text color={theme.dim} bold>{` CHATS · ${filter}${archivedView ? ' · archived' : ''}`}</Text>
      ))}
      {archivedRowShown ? (
        <Text
          backgroundColor={hoverArchived ? theme.bubbleIn : undefined}
          color={theme.accent}
          bold={hoverArchived}
          wrap="truncate-end"
        >
          {` ${archivedView ? '‹' : '⌄'} ${archivedView ? 'All chats' : `Archived · ${archivedCount}`}`}
        </Text>
      ) : null}
      {visible.length === 0 ? (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text color={theme.dimmer}>{archivedView ? 'no archived chats.' : 'no conversations yet.'}</Text>
          {archivedView ? null : <Text color={theme.dimmer}>Incoming messages will show up here.</Text>}
        </Box>
      ) : null}
      {visible.map((t, i) => {
        const idx = start + i
        const selected = idx === selIdx
        const hovered = idx === hoverIdx && !selected
        const bg = selected || hovered ? theme.bubbleIn : undefined
        const timeStr = t.messages.length > 0 ? formatMsgTime(t.messages[t.messages.length - 1]!.ts) : ''
        const badge = t.unread > 0 ? ` ${Math.min(t.unread, 99)} ` : ''
        const flags = (t.pinned ? '⚑ ' : '') + (t.muted ? '⊘ ' : '')
        const icon = chatKindIcon(t.jid)
        const nameArea = Math.max(6, innerWidth - timeStr.length - badge.length)
        const prefix = ` ${selected || hovered ? '›' : ' '}${flags}${icon} `
        const nameStr = padVisual(prefix + truncateVisual(t.name, Math.max(3, nameArea - visualWidth(prefix))), nameArea)
        const previewStr = padVisual(`   ${truncateVisual(threadPreview(t), Math.max(4, innerWidth - 3 - badge.length))}`, Math.max(4, innerWidth - badge.length))
        return (
          <Box key={t.jid} flexDirection="column">
            <Text>
              <Text backgroundColor={bg} color={selected ? theme.accent : hovered ? theme.text : theme.text} bold={selected}>{nameStr}</Text>
              <Text backgroundColor={bg} color={theme.dimmer}>{timeStr}</Text>
              {badge ? <Text backgroundColor={theme.accent} color="black" bold>{badge}</Text> : null}
            </Text>
            <Text>
              <Text backgroundColor={bg} color={t.typing ? theme.info : theme.dimmer}>{previewStr}</Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
})
