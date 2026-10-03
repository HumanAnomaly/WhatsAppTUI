import { memo } from 'react'
import { Box, Text } from 'ink'
import { currentTheme, SPINNER_FRAMES } from '../theme.js'
import { useGateway, useSpinner, useTerminalSize, useTicker } from '../hooks.js'
import { logoLines } from './logo.js'
import { Screen } from './Screen.js'

const BOOT_CELLS = 26

/** Isolated so the color pulse re-renders only these lines, never the tree. */
const Logo = memo(function Logo() {
  const { cols } = useTerminalSize()
  const tick = useTicker(240)
  const theme = currentTheme()
  const palette = [theme.accent, theme.accentDeep, theme.info, theme.accent]
  const shade = (i: number): string => palette[(tick + i) % palette.length] ?? theme.accent
  return (
    <Box flexDirection="column">
      {logoLines(cols).map((rows, line) =>
        rows.map((row, i) => (
          <Text key={`${line}-${i}`} color={shade(line + i)} bold>{row}</Text>
        )),
      )}
    </Box>
  )
})

function Steps() {
  const { bootSteps } = useGateway()
  const theme = currentTheme()
  const filled = Math.min(BOOT_CELLS, Math.round((bootSteps.length / 4) * BOOT_CELLS))
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}> preparing…</Text>
      {bootSteps.map((step, i) => (
        <Text key={`${step}-${i}`} color={i === bootSteps.length - 1 ? theme.text : theme.dimmer}>
          {'  '}✓ {step}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="row">
        <Text>{'  '}</Text>
        <Text color={theme.accent}>{'▰'.repeat(filled)}</Text>
        <Text color={theme.border}>{'▱'.repeat(BOOT_CELLS - filled)}</Text>
      </Box>
    </Box>
  )
}

export const Splash = memo(function Splash() {
  const spinner = useSpinner()
  const theme = currentTheme()
  const { demo } = useGateway()
  return (
    <Screen>
      <Box flexDirection="column" paddingX={2} paddingTop={1} gap={1}>
      <Logo />
      <Text color={theme.dim}>
        {'  '}WhatsAppTUI {' '}· {' '}WhatsApp in your terminal, no browser
      </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color={theme.accent}>{spinner}</Text>
            <Text color={theme.dim}> working…</Text>
          </Text>
          <Steps />
        </Box>
        {demo ? <Text color={theme.warn}>  ◈ demo mode — no WhatsApp connection</Text> : null}
      </Box>
    </Screen>
  )
})
