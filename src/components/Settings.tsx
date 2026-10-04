import { memo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useGateway, useIsTTY, useSettings, useTerminalSize, useTheme } from '../hooks.js'
import { useMouse, type MouseEvt } from '../mouse.js'
import { InputLine } from './InputBox.js'
import { getSettings, updateSettings, PANEL_BG_CHOICES, type Settings } from '../config.js'
import { gateway } from '../wa/gateway.js'

interface Row {
  id: string
  label: string
  value(): string
  apply(): void
  step?(dir: 1 | -1): void
  edit?: { min: number; max: number }
}

const THEMES: Array<Settings['theme']> = ['green', 'ocean', 'mono', 'crimson', 'amber', 'violet', 'rgb']
const SORTS: Array<Settings['chatSort']> = ['recent', 'unread', 'name']

function rows(): Row[] {
  const s = getSettings()
  const bool = (v: boolean): string => (v ? 'on' : 'off')
  const cycle = <T,>(list: readonly T[], cur: T, dir: 1 | -1): T =>
    list[(list.indexOf(cur) + dir + list.length) % list.length]!
  const toggle = (patch: Partial<Settings>): void => updateSettings(patch)
  return [
    {
      id: 'theme',
      label: 'Theme',
      value: () => s.theme,
      apply: () => updateSettings({ theme: cycle(THEMES, s.theme, 1) }),
      step: (dir) => updateSettings({ theme: cycle(THEMES, getSettings().theme, dir) }),
    },
    {
      id: 'timeFormat',
      label: 'Time format',
      value: () => s.timeFormat,
      apply: () => updateSettings({ timeFormat: s.timeFormat === '24h' ? '12h' : '24h' }),
      step: () => updateSettings({ timeFormat: getSettings().timeFormat === '24h' ? '12h' : '24h' }),
    },
    {
      id: 'chatSort',
      label: 'Sort chats by',
      value: () => s.chatSort,
      apply: () => updateSettings({ chatSort: cycle(SORTS, s.chatSort, 1) }),
      step: (dir) => updateSettings({ chatSort: cycle(SORTS, getSettings().chatSort, dir) }),
    },
    {
      id: 'readReceipts',
      label: 'Read receipts (mark opened chats as read)',
      value: () => bool(s.readReceipts),
      apply: () => toggle({ readReceipts: !s.readReceipts }),
      step: () => toggle({ readReceipts: !getSettings().readReceipts }),
    },
    {
      id: 'typingIndicator',
      label: 'Typing indicator (send composing hints)',
      value: () => bool(s.typingIndicator),
      apply: () => toggle({ typingIndicator: !s.typingIndicator }),
      step: () => toggle({ typingIndicator: !getSettings().typingIndicator }),
    },
    {
      id: 'bell',
      label: 'Terminal bell on new message',
      value: () => bool(s.bellOnNewMessage),
      apply: () => toggle({ bellOnNewMessage: !s.bellOnNewMessage }),
      step: () => toggle({ bellOnNewMessage: !getSettings().bellOnNewMessage }),
    },
    {
      id: 'autoLoadHistory',
      label: 'Auto-request history for empty chats',
      value: () => bool(s.autoLoadHistory),
      apply: () => toggle({ autoLoadHistory: !s.autoLoadHistory }),
      step: () => toggle({ autoLoadHistory: !getSettings().autoLoadHistory }),
    },
    {
      id: 'canvas',
      label: 'Solid background canvas (black)',
      value: () => bool(s.canvasBg),
      apply: () => toggle({ canvasBg: !s.canvasBg }),
      step: () => toggle({ canvasBg: !getSettings().canvasBg }),
    },
    {
      id: 'sidebarBg',
      label: 'Sidebar background',
      value: () => s.sidebarBg,
      apply: () => updateSettings({ sidebarBg: cycle(PANEL_BG_CHOICES, s.sidebarBg, 1) }),
      step: (dir) => updateSettings({ sidebarBg: cycle(PANEL_BG_CHOICES, getSettings().sidebarBg, dir) }),
    },
    {
      id: 'chatBg',
      label: 'Chat background',
      value: () => s.chatBg,
      apply: () => updateSettings({ chatBg: cycle(PANEL_BG_CHOICES, s.chatBg, 1) }),
      step: (dir) => updateSettings({ chatBg: cycle(PANEL_BG_CHOICES, getSettings().chatBg, dir) }),
    },
    {
      id: 'autoDownload',
      label: 'Auto-download incoming photos',
      value: () => bool(s.autoDownload),
      apply: () => toggle({ autoDownload: !s.autoDownload }),
      step: () => toggle({ autoDownload: !getSettings().autoDownload }),
    },
    {
      id: 'attempts',
      label: 'Reconnect attempts',
      value: () => String(s.reconnectAttempts),
      apply: () => undefined, // handled via editing below
      step: (dir) => {
        const cur = getSettings().reconnectAttempts
        updateSettings({ reconnectAttempts: Math.max(1, Math.min(30, cur + dir)) })
      },
      edit: { min: 1, max: 30 },
    },
    {
      id: 'history',
      label: 'History messages per request',
      value: () => String(s.historyPageSize),
      apply: () => undefined, // handled via editing below
      step: (dir) => {
        const cur = getSettings().historyPageSize
        updateSettings({ historyPageSize: Math.max(10, Math.min(100, cur + dir * 5)) })
      },
      edit: { min: 10, max: 100 },
    },
    {
      id: 'unlink',
      label: 'Unlink this device (logout — history is cleared)',
      value: () => '…',
      apply: () => void gateway.unlink(),
    },
  ]
}

export const SettingsPopup = memo(function SettingsPopup() {
  useSettings()
  const state = useGateway()
  const theme = useTheme()
  const isTTY = useIsTTY()
  const { cols, rows: termRows } = useTerminalSize()
  const [sel, setSel] = useState(0)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const items = rows()
  const itemsRef = useRef(items)
  itemsRef.current = items
  const confirmRef = useRef(confirmUnlink)
  confirmRef.current = confirmUnlink
  const editingRef = useRef(editing)
  editingRef.current = editing

  // Top-anchored card geometry (exact, no rounding): backdrop pad + card
  // border + padding + title + spacer above the rows.
  const cardH = items.length + 8 + (editing ? 2 : 0)
  const footH = state.note ? 1 : 0
  const cardTop = 2
  const cardEnd = cardTop + cardH + footH // 0-based exclusive end

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
    if (item.edit) {
      setEditing(item.id)
      return
    }
    item.apply()
  }

  /** Commit a typed number, clamped to the row's [min, max]; garbage keeps the old value. */
  const applyNumber = (id: string, text: string): void => {
    const row = itemsRef.current.find((r) => r.id === id)
    const edit = row?.edit
    setEditing(null)
    if (!edit) return
    const match = /^\d{1,3}$/.exec(text.trim())
    if (!match) return
    const n = Math.max(edit.min, Math.min(edit.max, Number.parseInt(match[0], 10)))
    if (id === 'attempts') updateSettings({ reconnectAttempts: n })
    else if (id === 'history') updateSettings({ historyPageSize: n })
  }

  const lenRef = useRef(items.length)
  lenRef.current = items.length
  const labelW = Math.max(...items.map((item) => item.label.length))

  const onMouse = (e: MouseEvt): void => {
    const row = e.y - 1
    if (e.kind === 'wheel-up' || e.kind === 'wheel-down') {
      const dir = e.kind === 'wheel-up' ? 1 : -1
      setSel((s) => Math.max(0, Math.min(lenRef.current - 1, s - dir)))
      return
    }
    if (e.kind !== 'click') return
    if (editingRef.current) return // the type-in box owns the pointer
    const i = row - cardTop - 4
    if (i < 0 || i >= lenRef.current || row < cardTop || row >= cardEnd) {
      setConfirmUnlink(false)
      gateway.setScreen('main') // backdrop dismiss
      return
    }
    setSel(i)
    applyRow(i)
  }
  useMouse(onMouse)

  useInput(
    (input, key) => {
      if (editingRef.current) return // the type-in box owns the keyboard
      if (key.escape) {
        setConfirmUnlink(false)
        gateway.setScreen('main')
        return
      }
      if (key.leftArrow || key.rightArrow) {
        const dir = key.leftArrow ? -1 : 1
        const item = itemsRef.current[sel]
        if (item && item.id !== 'unlink') {
          setConfirmUnlink(false)
          item.step?.(dir as 1 | -1)
        }
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
    <Box position="absolute" width={cols} height={termRows} flexDirection="column" alignItems="center" paddingTop={2}>
      <Box borderStyle="round" borderColor={theme.border} backgroundColor={theme.bg} paddingX={2} paddingY={1} flexDirection="column">
        <Text color={theme.accent} bold>{' Settings'}</Text>
        <Text> </Text>
        {items.map((item, i) => {
          const selected = i === sel
          const armed = item.id === 'unlink' && confirmUnlink
          return (
            <Text key={item.id}>
              <Text color={selected ? theme.accent : theme.text} bold={selected}>{` ${selected ? '›' : ' '} ${item.label.padEnd(labelW)}`}</Text>
              <Text color={armed ? theme.danger : theme.dim} bold={armed}>
                {item.id === 'unlink' ? (armed ? '  press Enter again to confirm' : `  ${item.value()}`) : `  <${item.value()}>`}
              </Text>
            </Text>
          )
        })}
        <Text> </Text>
        {editing ? (
          <>
            <Text color={theme.warn}>{` type ${itemsRef.current.find((r) => r.id === editing)?.edit?.min}–${itemsRef.current.find((r) => r.id === editing)?.edit?.max} · Enter saves · Esc clears, empty Esc cancels`}</Text>
            <InputLine
              key={editing}
              width={40}
              enabled
              onSubmit={(text) => applyNumber(editing, text)}
              onTypingChange={() => undefined}
              onEscape={() => setEditing(null)}
            />
          </>
        ) : (
          <>
            <Text color={theme.dimmer}>{' ↑↓ choose · ←→ change value · Enter edit/type · Esc back'}</Text>
            <Text color={theme.dimmer}>{' '}Settings persist in .config/settings.json</Text>
          </>
        )}
      </Box>
      {state.note ? <Text color={theme.warn}> ◈ {state.note}</Text> : null}
    </Box>
  )
})
