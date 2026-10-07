import { memo } from 'react'
import { Box, Text, useInput } from 'ink'
import { useIsTTY, useTerminalSize, useTheme } from '../hooks.js'
import { useMouse } from '../mouse.js'
import { gateway } from '../wa/gateway.js'

const KEYS: Array<[string, string]> = [
  ['↑ / ↓', 'select chat'],
  ['Tab / Shift+Tab', 'cycle filter · toggle archived'],
  ['PgUp / PgDn', 'scroll history (PgUp pages older from the server)'],
  ['Ctrl+F', 'search chats & messages'],
  ['Enter', 'send message · open chat'],
  ['Esc', 'clear draft · back / close'],
  ['Editing', '← → cursor · Ctrl+A/E ends · Ctrl+W word · Ctrl+U clear'],
  ['/img /vid…', 'attach: /img /vid /gif /ptv /aud /vn /doc /stk <file> [| cap] [--once]'],
  ['o / d / p', 'open · download (retry on fail) · play last media (empty input)'],
  ['r', 'reply to hovered/clicked (else last) message (empty input)'],
  ['i', 'group / contact / channel info panel (empty input)'],
  ['⚙ top right', 'open settings'],
  ['Ctrl+O', 'chat options: pin, mute, read, archive, info'],
  ['Ctrl+S', 'settings'],
  ['Ctrl+K', 'this help · Ctrl+C quit'],
]

const MOUSE: Array<[string, string]> = [
  ['Click chat', 'open that conversation'],
  ['Click chat title', 'open the info panel (tap again to close)'],
  ['Click ⚙', 'open settings'],
  ['Click message', 'copy text · expand long messages'],
  ['Click media', 'open photo/video · play voice · selects o/d/p target'],
  ['Click Archived', 'enter / leave the archived folder'],
  ['Wheel / swipe', 'scroll the chat list or history'],
  ['Hover', 'highlight chats, messages, buttons'],
]

export const HelpPopup = memo(function HelpPopup() {
  const theme = useTheme()
  const isTTY = useIsTTY()
  const { cols, rows } = useTerminalSize()

  useInput(
    (input, key) => {
      if (key.escape || key.return || (key.ctrl && input === 'k')) gateway.setScreen('main')
    },
    { isActive: isTTY },
  )
  // Click anywhere dismisses — hover and scroll must NOT (they are incidental).
  useMouse((e) => {
    if (e.kind === 'click') gateway.setScreen('main')
  })

  return (
    <Box position="absolute" width={cols} height={rows} flexDirection="column" justifyContent="center" alignItems="center">
      <Box borderStyle="round" borderColor={theme.border} backgroundColor={theme.bg} paddingX={2} paddingY={1} flexDirection="column">
        <Text color={theme.accent} bold>{' WhatsAppTUI — shortcuts'}</Text>
        {KEYS.map(([k, d]) => (
          <Text key={k}>
            <Text color={theme.text} bold>{` ${k.padEnd(16)}`}</Text>
            <Text color={theme.dim}>{d}</Text>
          </Text>
        ))}
        <Text color={theme.accent} bold>{' Mouse'}</Text>
        {MOUSE.map(([k, d]) => (
          <Text key={k}>
            <Text color={theme.text} bold>{` ${k.padEnd(16)}`}</Text>
            <Text color={theme.dim}>{d}</Text>
          </Text>
        ))}
        <Text color={theme.dimmer}>{' Esc / Enter · click — close'}</Text>
      </Box>
    </Box>
  )
})
