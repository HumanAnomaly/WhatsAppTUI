import { memo } from 'react'
import { Box, Text, useInput } from 'ink'
import { useGateway, useIsTTY, useSpinner, useTerminalSize, useTheme } from '../hooks.js'
import { hyperlink } from '../format.js'
import { logoLines } from './logo.js'
import { Screen } from './Screen.js'
import { DemoSlugHint, demoSlugForKey, jumpDemoSlug } from './DemoSwitcher.js'

const BOOT_CELLS = 22
const REPO_URL = 'https://github.com/HumanAnomaly/WhatsAppTUI'

/** Static wordmark in a single accent color — no animation, stays clean. */
const Logo = memo(function Logo() {
  const { cols } = useTerminalSize()
  const theme = useTheme()
  return (
    <Box flexDirection="column" alignItems="center">
      {logoLines(cols).map((rows, line) =>
        rows.map((row, i) => (
          <Text key={`${line}-${i}`} color={theme.accent} bold>{row}</Text>
        )),
      )}
    </Box>
  )
})

function Status() {
  const { bootSteps } = useGateway()
  const spinner = useSpinner()
  const theme = useTheme()
  const current = bootSteps[bootSteps.length - 1] ?? 'Starting…'
  const filled = Math.min(BOOT_CELLS, Math.round((bootSteps.length / 4) * BOOT_CELLS))
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color={theme.accent}>{spinner} </Text>
        <Text color={theme.text}>{current}…</Text>
      </Text>
      <Box marginTop={1} flexDirection="row">
        <Text color={theme.accent}>{'━'.repeat(filled)}</Text>
        <Text color={theme.border}>{'─'.repeat(BOOT_CELLS - filled)}</Text>
      </Box>
    </Box>
  )
}

export const Splash = memo(function Splash() {
  const theme = useTheme()
  const { demo } = useGateway()
  const isTTY = useIsTTY()

  useInput(
    (input) => {
      if (!demo) return
      const slug = demoSlugForKey(input)
      if (slug) jumpDemoSlug(slug)
    },
    { isActive: isTTY && demo },
  )

  return (
    <Screen>
      <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        <Box flexDirection="column" alignItems="center" paddingX={2} gap={1}>
          <Logo />
          <Text color={theme.accent}>{hyperlink(REPO_URL)}</Text>
          <Box marginTop={1}>
            <Status />
          </Box>
          {demo ? <Text color={theme.warn}>◈ demo mode — no WhatsApp connection</Text> : null}
          <DemoSlugHint />
        </Box>
      </Box>
    </Screen>
  )
})
