import { memo } from 'react'
import { Box, Text } from 'ink'
import { useGateway, useSpinner, useTerminalSize, useTheme } from '../hooks.js'
import { DemoSlugHint } from './DemoSwitcher.js'

export const ReconnectOverlay = memo(function ReconnectOverlay() {
  const state = useGateway()
  const spinner = useSpinner()
  const theme = useTheme()
  const { cols, rows } = useTerminalSize()
  const recon = state.reconnection

  return (
    <Box position="absolute" width={cols} height={rows} flexDirection="column" justifyContent="center" alignItems="center">
      <Box borderStyle="round" borderColor={theme.warn} backgroundColor={theme.bg} paddingX={3} paddingY={1} flexDirection="column" alignItems="center">
        <Text color={theme.warn} bold>{spinner} Reconnecting…</Text>
        <Text> </Text>
        {recon ? (
          <>
            <Text color={theme.text}>
              attempt {recon.attempt}/{recon.max} · retrying in {Math.max(1, Math.round(recon.delayMs / 1000))}s
            </Text>
            <Text> </Text>
          </>
        ) : null}
        <Text color={theme.dim}>Your chats are safe — sync resumes automatically</Text>
        {state.note ? <Text color={theme.warn}>◈ {state.note}</Text> : null}
        {state.error ? <Text color={theme.danger}>✖ {state.error}</Text> : null}
        <DemoSlugHint />
      </Box>
    </Box>
  )
})
