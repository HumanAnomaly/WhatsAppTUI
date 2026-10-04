import { memo } from 'react'
import { Box, Text, useInput } from 'ink'
import { currentTheme } from '../theme.js'
import { useIsTTY, useTerminalSize } from '../hooks.js'
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
  ['/img … /stk', 'attach media: /img <file> [| caption]'],
  ['Ctrl+O', 'chat options: pin, mute, read, archive, info'],
  ['Ctrl+P', 'profile & privacy'],
  ['Ctrl+S', 'settings'],
  ['Ctrl+K', 'this help · Ctrl+C quit'],
]

const MOUSE: Array<[string, string]> = [
  ['Click chat', 'open that conversation'],
  ['Click message', 'copy its text'],
  ['Click Archived', 'enter / leave the archived folder'],
  ['Wheel / swipe', 'scroll the chat list or history'],
  ['Hover', 'highlight chats, messages, buttons'],
]

/**
 * Modal shortcut sheet floating above the main screen — Main stays mounted,
 * so the chat list and scroll position are untouched behind it.
 */
export const HelpPopup = memo(function HelpPopup() {
  const theme = currentTheme()
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
