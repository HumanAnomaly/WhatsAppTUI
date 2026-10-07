import { memo, useEffect } from 'react'
import { Box, Text } from 'ink'
import { chatKindIcon, chatKindLabel, displayJid, formatMsgTime, padVisual, truncateVisual } from '../format.js'
import { useTerminalSize, useTheme } from '../hooks.js'
import { gateway, type WaMediaInfo, type WaMsg, type WaThread } from '../wa/gateway.js'

const MEDIA_ICONS: Record<WaMediaInfo['kind'], string> = {
  image: '📷',
  video: '🎬',
  gif: '🎞️',
  ptv: '⭕',
  audio: '🎧',
  voice: '🎤',
  document: '📄',
  sticker: '✨',
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return `${words[0]![0] ?? '?'}${words[1]![0] ?? ''}`.toUpperCase()
  const letters = [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch))
  if (letters.length === 0) return '?'
  return letters.slice(0, 2).join('').toUpperCase()
}

function mediaLabel(m: WaMsg): string {
  const media = m.media
  if (!media) return m.text
  if (media.caption) return media.caption
  if (media.fileName) return media.fileName
  if (media.kind === 'voice') return 'voice note'
  if (media.kind === 'audio') return 'audio'
  return m.text || media.kind
}

export const InfoPanel = memo(function InfoPanel({ thread, rev, width }: { thread: WaThread; rev: number; width: number }) {
  void rev
  const theme = useTheme()
  const { rows } = useTerminalSize()
  const isGroup = thread.jid.endsWith('@g.us')
  const isChannel = thread.jid.endsWith('@newsletter')

  useEffect(() => {
    if (isGroup) void gateway.refreshGroupInfo(thread.jid)
    else if (!isChannel) void gateway.refreshContactInfo(thread.jid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.jid])

  const inner = Math.max(10, width - 4)
  const media = thread.messages.filter((m) => m.media && !m.media.unavailableKind)
  const maxMedia = Math.max(2, rows - 22)
  const recent = media.slice(-maxMedia).reverse()
  const kindLine = isGroup
    ? `${chatKindIcon(thread.jid)} Group${thread.memberCount ? ` · ${thread.memberCount} members` : ''}`
    : isChannel
      ? `${chatKindIcon(thread.jid)} Channel`
      : `${chatKindIcon(thread.jid)} ${displayJid(thread.jid)}`

  return (
    <Box flexDirection="column" width={width - 2} alignItems="center">
      <Text color={theme.accent} bold wrap="truncate-end">{` ✕ ${chatKindLabel(thread.jid)} info`}</Text>
      <Box marginTop={1} borderStyle="round" borderColor={theme.accentDeep} paddingX={2}>
        <Text backgroundColor={theme.accent} color="black" bold>{` ${initialsOf(thread.name)} `}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text color={theme.text} bold wrap="truncate-end">{truncateVisual(thread.name, inner)}</Text>
        <Text color={isGroup && thread.memberCount ? theme.accent : theme.dim} wrap="truncate-end">{truncateVisual(kindLine, inner)}</Text>
        {!isGroup && !isChannel && thread.infoSummary ? (
          <Text color={theme.dimmer} wrap="truncate-end">{truncateVisual(thread.infoSummary, inner)}</Text>
        ) : null}
      </Box>
      {isGroup && thread.groupDesc ? (
        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text color={theme.dim} wrap="truncate-end">{truncateVisual(thread.groupDesc, inner)}</Text>
        </Box>
      ) : null}
      {isGroup && thread.members && thread.members.length > 0 ? (
        <Box marginTop={1} flexDirection="column" width={inner}>
          <Text color={theme.text} bold wrap="truncate-end">{`Members (${thread.members.length})`}</Text>
          <Text color={theme.dim} wrap="truncate-end">{truncateVisual(thread.members.map((m) => m.name).join(', '), inner)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column" width={inner}>
        <Text color={theme.text} bold wrap="truncate-end">{`Media, links & docs (${media.length})`}</Text>
        {recent.length === 0 ? (
          <Text color={theme.dimmer}>No media yet — attachments will appear here.</Text>
        ) : (
          recent.map((m) => {
            const left = `${MEDIA_ICONS[m.media!.kind] ?? '📎'} ${truncateVisual(mediaLabel(m), Math.max(4, inner - 10))}`
            return (
              <Text key={m.id} wrap="truncate-end">
                <Text color={theme.text}>{padVisual(left, Math.max(4, inner - 7))}</Text>
                <Text color={theme.dimmer}>{formatMsgTime(m.ts)}</Text>
              </Text>
            )
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dimmer}>i / tap title — close</Text>
      </Box>
    </Box>
  )
})
