import { memo } from 'react'
import { Box, Text, useInput } from 'ink'
import { currentTheme } from '../theme.js'
import { useIsTTY } from '../hooks.js'
import { useMouse } from '../mouse.js'
import { Screen } from './Screen.js'
import { gateway } from '../wa/gateway.js'

const KEYS: Array<[string, string]> = [
  ['↑ / ↓', 'select chat'],
  ['Tab', 'filter: all → groups → direct → channels'],
  ['PgUp / PgDn', 'scroll history (PgUp pages older from the server)'],
  ['← / →', 'move the text cursor'],
  ['Ctrl+A / E', 'cursor to start / end'],
  ['Ctrl+W', 'delete word'],
  ['Ctrl+U', 'clear the line'],
  ['Enter', 'send message'],
  ['Esc', 'clear draft'],
  ['/img /vid /aud', 'attach media: /img <file> [| caption]'],
  ['/vn /doc /stk', 'voice note · document · sticker (same shape)'],
  ['Ctrl+O', 'chat options: pin, mute, read, archive, info'],
  ['Ctrl+P', 'profile & privacy'],
  ['Ctrl+S', 'settings'],
  ['Ctrl+K', 'this help'],
  ['Ctrl+C', 'quit'],
]

const MOUSE: Array<[string, string]> = [
  ['Click chat', 'open that conversation'],
  ['Hover', 'highlight chats, messages, buttons, chips'],
  ['Click message', 'copy its text to the clipboard'],
  ['Click row', 'apply a settings / chat-option row'],
  ['Wheel / swipe', 'scroll message history or the chat list'],
  ['Tap (Termux)', 'touch = click, swipe = scroll'],
]

export const HelpScreen = memo(function HelpScreen() {
  const theme = currentTheme()
  const isTTY = useIsTTY()

  useInput(
    (_input, key) => {
      if (key.escape || key.return) gateway.setScreen('main')
    },
    { isActive: isTTY },
  )
  useMouse(() => gateway.setScreen('main')) // tap anywhere closes help

  return (
    <Screen>
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={2} paddingY={1} flexDirection="column" alignSelf="flex-start">
          <Text color={theme.accent} bold>{' WhatsAppTUI — shortcuts'}</Text>
          <Text> </Text>
          {KEYS.map(([k, d]) => (
            <Text key={k}>
              <Text color={theme.text} bold>{` ${k.padEnd(12)}`}</Text>
              <Text color={theme.dim}>{d}</Text>
            </Text>
          ))}
          <Text> </Text>
          <Text color={theme.accent} bold>{' Mouse'}</Text>
          <Text> </Text>
          {MOUSE.map(([k, d]) => (
            <Text key={k}>
              <Text color={theme.text} bold>{` ${k.padEnd(16)}`}</Text>
              <Text color={theme.dim}>{d}</Text>
            </Text>
          ))}
          <Text> </Text>
          <Text color={theme.dimmer}>{' Esc / Enter — back'}</Text>
        </Box>
      </Box>
    </Screen>
  )
})
