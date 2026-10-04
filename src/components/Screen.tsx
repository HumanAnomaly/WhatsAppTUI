import type { ReactNode } from 'react'
import { Box } from 'ink'
import { useSettings, useTerminalSize } from '../hooks.js'
import { canvasBg } from '../theme.js'

export function Screen({ children }: { children: ReactNode }) {
  const { cols, rows } = useTerminalSize()
  useSettings() // re-render when preferences change
  return (
    <Box flexDirection="column" width={cols} height={rows} backgroundColor={canvasBg()}>
      {children}
    </Box>
  )
}
