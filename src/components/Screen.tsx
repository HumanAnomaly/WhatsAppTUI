import type { ReactNode } from 'react'
import { Box } from 'ink'
import { useTerminalSize } from '../hooks.js'
import { currentTheme } from '../theme.js'

/**
 * Full-canvas screen container: paints every cell of the viewport with the
 * theme background — the opencode-style solid backdrop. Borders, paddings and
 * empty areas included.
 */
export function Screen({ children }: { children: ReactNode }) {
  const { cols, rows } = useTerminalSize()
  const theme = currentTheme()
  return (
    <Box flexDirection="column" width={cols} height={rows} backgroundColor={theme.bg}>
      {children}
    </Box>
  )
}
