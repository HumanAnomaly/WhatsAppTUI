import { memo, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { currentTheme } from '../theme.js'
import { useGateway, useIsTTY, useThreads } from '../hooks.js'
import { useMouse, type MouseEvt } from '../mouse.js'
import { Screen } from './Screen.js'
import { displayJid } from '../format.js'
import { gateway, type WaThread } from '../wa/gateway.js'

type Action = { id: string; label(thread: WaThread): string; run(thread: WaThread): void }

const ACTIONS: Action[] = [
  {
    id: 'pin',
    label: (t) => (t.pinned ? 'Unpin chat' : 'Pin chat'),
    run: (t) => void gateway.togglePin(t.jid),
  },
  {
    id: 'mute',
    label: (t) => (t.muted ? 'Unmute notifications' : 'Mute notifications'),
    run: (t) => void gateway.toggleMute(t.jid),
  },
  {
    id: 'read',
    label: (t) => (t.unread > 0 ? 'Mark as read' : 'Mark as unread'),
    run: (t) => void gateway.setUnread(t.jid, t.unread === 0),
  },
  {
    id: 'archive',
    label: (t) => (t.archived ? 'Unarchive chat' : 'Archive chat'),
    run: (t) => void gateway.toggleArchive(t.jid),
  },
  {
    id: 'info',
    label: (t) => (t.jid.endsWith('@g.us') ? 'Refresh group info' : 'Refresh contact info'),
    run: (t) =>
      t.jid.endsWith('@g.us')
        ? void gateway.refreshGroupInfo(t.jid)
        : void gateway.refreshContactInfo(t.jid),
  },
]

export const ChatMenu = memo(function ChatMenu() {
  const state = useGateway()
  const threads = useThreads()
  const theme = currentTheme()
  const isTTY = useIsTTY()
  const [sel, setSel] = useState(0)

  const thread = state.activeJid ? threads.find((t) => t.jid === state.activeJid) ?? null : null

  useEffect(() => {
    if (thread) {
      if (thread.jid.endsWith('@g.us')) void gateway.refreshGroupInfo(thread.jid)
      else void gateway.refreshContactInfo(thread.jid)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.jid])

  const items = thread ? [...ACTIONS, { id: 'close', label: (): string => 'Close (Esc)', run: () => gateway.setScreen('main') }] : []
  const itemsRef = useRef(items)
  itemsRef.current = items

  const applyItem = (i: number): void => {
    const item = itemsRef.current[i]
    if (!item || !thread) return
    item.run(thread)
    if (item.id !== 'info') gateway.setScreen('main')
  }

  const onMouse = (e: MouseEvt): void => {
    const row = e.y - 1
    if (e.kind === 'wheel-up' || e.kind === 'wheel-down') {
      const dir = e.kind === 'wheel-up' ? 1 : -1
      setSel((s) => Math.max(0, Math.min(itemsRef.current.length - 1, s - dir)))
      return
    }
    if (e.kind !== 'click') return
    // Rows start at screen row 6: padding, border, padding, title, jid, spacer.
    const i = row - 6
    if (i < 0 || i >= itemsRef.current.length) return
    setSel(i)
    applyItem(i)
  }
  useMouse(onMouse)

  useInput(
    (input, key) => {
      if (key.escape) {
        gateway.setScreen('main')
        return
      }
      if (key.upArrow) setSel((s) => Math.max(0, s - 1))
      else if (key.downArrow) setSel((s) => Math.min(items.length - 1, s + 1))
      else if (key.return) {
        const item = items[sel]
        if (item && thread) {
          item.run(thread)
          if (item.id !== 'info') gateway.setScreen('main')
        }
      }
    },
    { isActive: isTTY },
  )

  if (!thread) {
    gateway.setScreen('main')
    return null
  }

  const title = `Chat options — ${thread.name}`

  return (
    <Screen>
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={2} paddingY={1} flexDirection="column" alignSelf="flex-start" minWidth={52}>
          <Text color={theme.accent} bold wrap="truncate-end">{` ${title}`}</Text>
          <Text color={theme.dimmer} wrap="truncate-end">{` ${displayJid(thread.jid)}`}</Text>
          <Text> </Text>
          {items.map((item, i) => (
            <Text key={item.id} color={i === sel ? theme.accent : theme.text} bold={i === sel}>
              {` ${i === sel ? '›' : ' '} ${item.label(thread)}`}
            </Text>
          ))}
          <Text> </Text>
          {thread.infoSummary ? <Text color={theme.dim} wrap="truncate-end">{` ${thread.infoSummary}`}</Text> : null}
          <Text color={theme.dimmer}>{' ↑↓ / click choose · Enter apply · Esc back'}</Text>
        </Box>
        <Text color={theme.dimmer}>{' '}Changes sync to your other WhatsApp devices via app-state.</Text>
      </Box>
    </Screen>
  )
})
