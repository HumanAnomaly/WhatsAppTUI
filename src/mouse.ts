import { useEffect, useSyncExternalStore } from 'react'
import { useIsTTY } from './hooks.js'

export interface MouseEvt {
  kind: 'click' | 'wheel-up' | 'wheel-down' | 'drag' | 'hover'
  /** 1-based column, exactly as the terminal reports it. */
  x: number
  /** 1-based row, exactly as the terminal reports it. */
  y: number
  /** Row delta since the previous drag event (drag events only). */
  dy?: number
}

type MouseHandler = (e: MouseEvt) => void

const handlers = new Set<MouseHandler>()

/** Register a handler for clicks, wheel, drag and hover events. */
export function useMouse(handler: MouseHandler): void {
  useEffect(() => {
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }, [handler])
}

// ---- hover position store (updated only when the cursor actually moves) ----

let hoverPos: { x: number; y: number } | null = null
const hoverListeners = new Set<() => void>()

/** Last known cursor position, or null before the first hover. */
export function useHover(): { x: number; y: number } | null {
  return useSyncExternalStore(
    (listener) => {
      hoverListeners.add(listener)
      return () => {
        hoverListeners.delete(listener)
      }
    },
    () => hoverPos,
  )
}

function setHover(x: number, y: number): void {
  if (hoverPos && hoverPos.x === x && hoverPos.y === y) return
  hoverPos = { x, y }
  for (const listener of hoverListeners) listener()
}

// ---------------------------------------------------------------- transport

/** Enter SGR mouse mode: clicks + wheel + button-drag + any-motion (hover). */
export function enableMouse(): void {
  if (!process.stdout.isTTY) return
  process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h')
}

export const disableMouseSeq = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l'

export function disableMouse(): void {
  if (!process.stdout.isTTY) return
  process.stdout.write(disableMouseSeq)
}

/**
 * Hidden component: reads SGR mouse sequences straight from stdin. Ink's own
 * key parser eats escape sequences, so mouse handling bypasses it entirely.
 */
export function MouseRouter(): null {
  const isTTY = useIsTTY()

  useEffect(() => {
    if (!isTTY) return
    const stdin = process.stdin
    let lastDragY = 0
    let pressPos: { x: number; y: number } | null = null
    let dragging = false

    const onData = (chunk: Buffer | string): void => {
      const data = String(chunk)
      if (!data.includes('\x1b[<')) return
      for (const m of data.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
        const b = Number(m[1])
        const x = Number(m[2])
        const y = Number(m[3])
        const release = m[4] === 'm'
        if (b === 64 && !release) {
          for (const h of handlers) h({ kind: 'wheel-up', x, y })
          continue
        }
        if (b === 65 && !release) {
          for (const h of handlers) h({ kind: 'wheel-down', x, y })
          continue
        }
        if (b === 32 && !release) {
          // Left button held and moving — touch swipe / mouse drag.
          const dy = y - lastDragY
          lastDragY = y
          if (pressPos) dragging = true
          if (dy !== 0) for (const h of handlers) h({ kind: 'drag', x, y, dy })
          continue
        }
        if (b === 35 && !release) {
          // Any-motion without a pressed button — hover.
          setHover(x, y)
          continue
        }
        if (!release && b === 0) {
          // Press: remember it and fire the click on release, so a touch swipe
          // (press + drag + release) never registers as an accidental tap.
          pressPos = { x, y }
          dragging = false
          lastDragY = y
          setHover(x, y)
          continue
        }
        if (release && b === 0 && pressPos) {
          pressPos = null
          if (!dragging) for (const h of handlers) h({ kind: 'click', x, y })
          continue
        }
      }
    }

    stdin.on('data', onData)
    return () => {
      stdin.off('data', onData)
    }
  }, [isTTY])

  return null
}
