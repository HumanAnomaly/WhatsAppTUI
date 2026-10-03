import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { currentTheme } from '../theme.js'
import { useGateway, useIsTTY } from '../hooks.js'
import { useMouse } from '../mouse.js'
import { Screen } from './Screen.js'
import { InputLine } from './InputBox.js'
import { gateway } from '../wa/gateway.js'

type EditField = 'name' | 'about' | 'photo'

const PRIVACY_LABELS: Array<[string, string]> = [
  ['lastSeen', 'Last seen'],
  ['online', 'Online status'],
  ['profilePicture', 'Profile photo'],
  ['about', 'About'],
  ['readReceipts', 'Read receipts'],
  ['groupAdd', 'Who can add me to groups'],
]

/**
 * Edit your WhatsApp identity: push name, About text, profile photo and the
 * privacy categories — wired straight to client.profile / client.privacy.
 */
export const ProfileScreen = memo(function ProfileScreen() {
  const state = useGateway()
  const theme = currentTheme()
  const isTTY = useIsTTY()
  const profile = state.profile
  const [sel, setSel] = useState(0)
  const [editing, setEditing] = useState<EditField | null>(null)

  useEffect(() => {
    void gateway.loadProfile()
  }, [])

  const applyField = useCallback((field: EditField, value: string): void => {
    const v = value.trim()
    if (field === 'name') void gateway.setProfileName(v)
    if (field === 'about') void gateway.setProfileAbout(v)
    if (field === 'photo') {
      if (v) void gateway.setProfilePicturePath(v)
    }
    setEditing(null)
  }, [])

  // rows: 0 name, 1 about, 2 photo, 3.. privacy categories
  const rowCount = 3 + PRIVACY_LABELS.length
  const privacyValue = (setting: string): string =>
    state.profile?.privacy?.[setting] ?? '…'

  const applyRow = (i: number): void => {
    if (i <= 2) {
      setEditing((['name', 'about', 'photo'] as const)[i]!)
      return
    }
    const setting = PRIVACY_LABELS[i - 3]?.[0]
    if (setting) void gateway.cyclePrivacy(setting)
  }

  useInput(
    (input, key) => {
      if (editing) return // the input line owns the keyboard while editing
      if (key.escape) {
        gateway.setScreen('main')
        return
      }
      if (key.upArrow) {
        setSel((s) => Math.max(0, s - 1))
        return
      }
      if (key.downArrow) {
        setSel((s) => Math.min(rowCount - 1, s + 1))
        return
      }
      if (key.return || input === ' ') applyRow(sel)
    },
    { isActive: isTTY && editing === null },
  )

  const onMouse = (e: { kind: string; x: number; y: number }): void => {
    if (editing) return
    if (e.kind !== 'click') return
    const row = e.y - 1
    if (row === 0) {
      gateway.setScreen('main')
      return
    }
    // rows start at screen row 5: padding, border, padding, title, spacer
    const i = row - 5
    if (i < 0 || i >= rowCount) return
    setSel(i)
    applyRow(i)
  }
  useMouse(onMouse)

  const valueFor = (field: EditField): string => {
    if (field === 'name') return profile?.name ?? 'not loaded'
    if (field === 'about') return profile?.about ?? 'not loaded'
    return 'set from an image file…'
  }

  return (
    <Screen>
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={2} paddingY={1} flexDirection="column" alignSelf="flex-start" minWidth={64}>
          <Text color={theme.accent} bold>{' Profile & privacy'}</Text>
          <Text> </Text>
          <Text>
            <Text color={sel === 0 ? theme.accent : theme.text} bold={sel === 0}>{` ${sel === 0 ? '›' : ' '} Display name`}</Text>
            <Text color={theme.dim}>{` <${valueFor('name')}>`}</Text>
          </Text>
          <Text>
            <Text color={sel === 1 ? theme.accent : theme.text} bold={sel === 1}>{` ${sel === 1 ? '›' : ' '} About`}</Text>
            <Text color={theme.dim}>{` <${valueFor('about')}>`}</Text>
          </Text>
          <Text>
            <Text color={sel === 2 ? theme.accent : theme.text} bold={sel === 2}>{` ${sel === 2 ? '›' : ' '} Profile photo`}</Text>
            <Text color={theme.dim}>{'  <image file path>'}</Text>
          </Text>
          <Text> </Text>
          <Text color={theme.accent} bold>{' Privacy'}</Text>
          <Text> </Text>
          {PRIVACY_LABELS.map(([setting, label], i) => (
            <Text key={setting}>
              <Text color={sel === 3 + i ? theme.accent : theme.text} bold={sel === 3 + i}>{` ${sel === 3 + i ? '›' : ' '}${label}`}</Text>
              <Text color={theme.dim}>{`  <${privacyValue(setting)}>`}</Text>
            </Text>
          ))}
          <Text> </Text>
          {editing ? (
            <>
              <Text color={theme.warn}>{` editing ${editing} — Enter saves · Backspace on empty cancels`}</Text>
              <InputLine key={editing} width={62} enabled onSubmit={(text) => applyField(editing, text)} onTypingChange={() => undefined} onEmptyBackspace={() => setEditing(null)} />
            </>
          ) : (
            <Text color={theme.dimmer}>{' ↑↓ / click choose · Enter edit or cycle · Esc back'}</Text>
          )}
          <Text color={theme.dimmer}>{' '}Changes apply to your WhatsApp account and sync everywhere.</Text>
        </Box>
        {state.note ? <Text color={theme.warn}> ◈ {state.note}</Text> : null}
        {state.error ? <Text color={theme.danger}> ✖ {state.error}</Text> : null}
      </Box>
    </Screen>
  )
})
