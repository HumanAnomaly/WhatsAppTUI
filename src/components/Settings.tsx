import { memo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { currentTheme } from '../theme.js'
import { useGateway, useIsTTY, useSettings } from '../hooks.js'
import { useMouse, type MouseEvt } from '../mouse.js'
import { Screen } from './Screen.js'
import { getSettings, updateSettings, type Settings } from '../config.js'
import { gateway } from '../wa/gateway.js'

interface Row {
  id: string
  label: string
  value(): string
  apply(): void
}

const THEMES: Array<Settings['theme']> = ['green', 'ocean', 'mono']
const SORTS: Array<Settings['chatSort']> = ['recent', 'unread', 'name']
const ATTEMPTS: Array<Settings['reconnectAttempts']> = [3, 5, 10, 20]

function rows(): Row[] {
  const s = getSettings()
  const bool = (v: boolean): string => (v ? 'on' : 'off')
  const next = <T,>(list: T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length]!
  return [
    {
      id: 'profile',
      label: 'Edit profile & privacy',
      value: () => '→',
      apply: () => gateway.setScreen('profile'),
    },
    {
      id: 'theme',
      label: 'Theme',
      value: () => s.theme,
      apply: () => updateSettings({ theme: next(THEMES, s.theme) }),
    },
    {
      id: 'timeFormat',
      label: 'Time format',
      value: () => s.timeFormat,
      apply: () => updateSettings({ timeFormat: s.timeFormat === '24h' ? '12h' : '24h' }),
    },
    {
      id: 'chatSort',
      label: 'Sort chats by',
      value: () => s.chatSort,
      apply: () => updateSettings({ chatSort: next(SORTS, s.chatSort) }),
    },
    {
      id: 'readReceipts',
      label: 'Read receipts (mark opened chats as read)',
      value: () => bool(s.readReceipts),
      apply: () => updateSettings({ readReceipts: !s.readReceipts }),
    },
    {
      id: 'typingIndicator',
      label: 'Typing indicator (send composing hints)',
      value: () => bool(s.typingIndicator),
      apply: () => updateSettings({ typingIndicator: !s.typingIndicator }),
    },
    {
      id: 'bell',
      label: 'Terminal bell on new message',
      value: () => bool(s.bellOnNewMessage),
      apply: () => updateSettings({ bellOnNewMessage: !s.bellOnNewMessage }),
    },
    {
      id: 'autoLoadHistory',
      label: 'Auto-request history for empty chats',
      value: () => bool(s.autoLoadHistory),
      apply: () => updateSettings({ autoLoadHistory: !s.autoLoadHistory }),
    },
    {
      id: 'attempts',
      label: 'Reconnect attempts',
      value: () => String(s.reconnectAttempts),
      apply: () => updateSettings({ reconnectAttempts: next(ATTEMPTS, s.reconnectAttempts) }),
    },
    {
      id: 'unlink',
      label: 'Unlink this device (logout & re-pair — history is kept)',
      value: () => '…',
      apply: () => void gateway.unlink(),
    },
  ]
}

export const SettingsScreen = memo(function SettingsScreen() {
  useSettings() // re-render on every settings change
  const state = useGateway()
  const theme = currentTheme()
  const isTTY = useIsTTY()
  const [sel, setSel] = useState(0)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const items = rows()
  const itemsRef = useRef(items)
  itemsRef.current = items
  const confirmRef = useRef(confirmUnlink)
  confirmRef.current = confirmUnlink

  const applyRow = (i: number): void => {
    const item = itemsRef.current[i]
    if (!item) return
    if (item.id === 'unlink') {
      if (confirmRef.current) {
        setConfirmUnlink(false)
        gateway.setScreen('main')
        void gateway.unlink()
      } else {
        setConfirmUnlink(true)
      }
      return
    }
    setConfirmUnlink(false)
    item.apply()
  }

  const lenRef = useRef(items.length)
  lenRef.current = items.length

  const onMouse = (e: MouseEvt): void => {
    const row = e.y - 1
    if (e.kind === 'wheel-up' || e.kind === 'wheel-down') {
      const dir = e.kind === 'wheel-up' ? 1 : -1
      setSel((s) => Math.max(0, Math.min(lenRef.current - 1, s - dir)))
      return
    }
    if (e.kind !== 'click') return
    // Rows start at screen row 5: padding, border, padding, title, spacer.
    const i = row - 5
    if (i < 0 || i >= lenRef.current) return
    setSel(i)
    applyRow(i)
  }
  useMouse(onMouse)

  useInput(
    (input, key) => {
      if (key.escape) {
        setConfirmUnlink(false)
        gateway.setScreen('main')
        return
      }
      if (key.upArrow) {
        setSel((s) => Math.max(0, s - 1))
        return
      }
      if (key.downArrow) {
        setSel((s) => Math.min(items.length - 1, s + 1))
        return
      }
      if (key.return || input === ' ') {
        applyRow(sel)
      }
    },
    { isActive: isTTY },
  )

  return (
    <Screen>
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={2} paddingY={1} flexDirection="column" alignSelf="flex-start" minWidth={64}>
          <Text color={theme.accent} bold>{' Settings'}</Text>
          <Text> </Text>
          {items.map((item, i) => {
            const selected = i === sel
            const armed = item.id === 'unlink' && confirmUnlink
            return (
              <Text key={item.id}>
                <Text color={selected ? theme.accent : theme.text} bold={selected}>{` ${selected ? '›' : ' '}${item.label}`}</Text>
                <Text color={armed ? theme.danger : theme.dim} bold={armed}>
                  {item.id === 'unlink' ? (armed ? '  press Enter again to confirm' : `  ${item.value()}`) : `  <${item.value()}>`}
                </Text>
              </Text>
            )
          })}
          <Text> </Text>
          <Text color={theme.dimmer}>{' ↑↓ / click choose · Enter / Space change · Esc back'}</Text>
          <Text color={theme.dimmer}>{' '}Settings persist in .config/settings.json</Text>
        </Box>
        {state.note ? <Text color={theme.warn}> ◈ {state.note}</Text> : null}
      </Box>
    </Screen>
  )
})
