import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStdin, useStdout } from 'ink'
import type { WriteStream } from 'node:tty'
import { gateway } from './wa/gateway.js'
import type { WaPlaybackState } from './wa/gateway.js'
import { getSettings, subscribeSettings } from './config.js'
import { SPINNER_FRAMES } from './theme.js'

/** Full gateway state — use in top-level screens only; gate heavy children with memo + rev. */
export function useGateway() {
  return useSyncExternalStore(gateway.subscribe, gateway.getSnapshot)
}

/** Cached, identity-stable thread list — safe for memo comparisons. */
export function useThreads() {
  return useSyncExternalStore(gateway.subscribe, gateway.getThreadsSnapshot)
}

/** The playing voice note, if any — only the player rows need to re-render. */
export function usePlayback(): WaPlaybackState | null {
  return useSyncExternalStore(gateway.subscribePlayback, gateway.getPlaybackSnapshot)
}

export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings)
}

/** Terminal size with sane fallbacks (Ink 8 types stdout as a plain stream). */
export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout()
  const tty = stdout as unknown as WriteStream
  return { cols: tty.columns ?? 80, rows: tty.rows ?? 24 }
}

export function useIsTTY(): boolean {
  const { stdin } = useStdin()
  return (stdin as unknown as WriteStream).isTTY === true
}

export function useTicker(intervalMs: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return tick
}

export function useSpinner(intervalMs = 90): string {
  const tick = useTicker(intervalMs)
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? '⠋'
}
