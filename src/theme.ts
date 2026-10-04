import { getSettings, type PanelBg, type ThemeName } from './config.js'

export interface Theme {
  bg: string
  accent: string
  accentDeep: string
  bubbleOut: string
  bubbleOutHover: string
  bubbleIn: string
  bubbleInHover: string
  text: string
  dim: string
  dimmer: string
  border: string
  danger: string
  warn: string
  info: string
}

export const THEMES: Record<ThemeName, Theme> = {
  green: {
    bg: '#000000',
    accent: '#25D366',
    accentDeep: '#075E54',
    bubbleOut: '#005C4B',
    bubbleOutHover: '#01806A',
    bubbleIn: '#202C33',
    bubbleInHover: '#2A3942',
    text: '#E9EDEF',
    dim: '#8696A0',
    dimmer: '#66787F',
    border: '#2A3942',
    danger: '#F15C6D',
    warn: '#E9C46A',
    info: '#53BDEB',
  },
  ocean: {
    bg: '#000000',
    accent: '#4CC9F0',
    accentDeep: '#1B4965',
    bubbleOut: '#1B4965',
    bubbleOutHover: '#256D8F',
    bubbleIn: '#1E2A32',
    bubbleInHover: '#2A3942',
    text: '#EAF2F8',
    dim: '#8FA9BC',
    dimmer: '#5D7688',
    border: '#28394A',
    danger: '#F15C6D',
    warn: '#E9C46A',
    info: '#9BB8FF',
  },
  mono: {
    bg: '#000000',
    accent: '#E6E6E6',
    accentDeep: '#4A4A4A',
    bubbleOut: '#3A3A3A',
    bubbleOutHover: '#525252',
    bubbleIn: '#242424',
    bubbleInHover: '#333333',
    text: '#EDEDED',
    dim: '#9A9A9A',
    dimmer: '#616161',
    border: '#3A3A3A',
    danger: '#FF6B6B',
    warn: '#D8C97A',
    info: '#B8B8B8',
  },
  crimson: {
    bg: '#000000',
    accent: '#FF4D6D',
    accentDeep: '#6E1423',
    bubbleOut: '#5C1A24',
    bubbleOutHover: '#7A2432',
    bubbleIn: '#26161A',
    bubbleInHover: '#332016',
    text: '#F5E9EC',
    dim: '#A88891',
    dimmer: '#6E5A61',
    border: '#3D2129',
    danger: '#FF6B6B',
    warn: '#E9C46A',
    info: '#FF9EBB',
  },
  amber: {
    bg: '#000000',
    accent: '#FFB703',
    accentDeep: '#7A4E00',
    bubbleOut: '#5C3D00',
    bubbleOutHover: '#7A5200',
    bubbleIn: '#26200F',
    bubbleInHover: '#332A14',
    text: '#F5EEDC',
    dim: '#A89A76',
    dimmer: '#6E654C',
    border: '#3D3420',
    danger: '#F15C6D',
    warn: '#E9C46A',
    info: '#FFD166',
  },
  violet: {
    bg: '#000000',
    accent: '#B388FF',
    accentDeep: '#3D2C8D',
    bubbleOut: '#3A2E7A',
    bubbleOutHover: '#4C3D99',
    bubbleIn: '#1E1B2E',
    bubbleInHover: '#2A2540',
    text: '#ECE8F7',
    dim: '#9A92BC',
    dimmer: '#635D80',
    border: '#322C52',
    danger: '#FF6B9D',
    warn: '#E9C46A',
    info: '#9BB8FF',
  },
  // Static base for `rgb` — replaced every second by rgbTheme() while active.
  rgb: {
    bg: '#000000',
    accent: '#FF5DA2',
    accentDeep: '#6E1448',
    bubbleOut: '#1B4965',
    bubbleOutHover: '#256D8F',
    bubbleIn: '#1E2A32',
    bubbleInHover: '#2A3942',
    text: '#EAF2F8',
    dim: '#8FA9BC',
    dimmer: '#5D7688',
    border: '#28394A',
    danger: '#F15C6D',
    warn: '#E9C46A',
    info: '#53BDEB',
  },
}

function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(100, s)) / 100
  const light = Math.max(0, Math.min(100, l)) / 100
  const k = (n: number): number => (n + hue / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

/** Rainbow theme: accent hues drift across the wheel (~36s per cycle). */
function rgbTheme(nowSec: number): Theme {
  const hue = (nowSec * 10) % 360
  return {
    ...THEMES.ocean,
    accent: hslHex(hue, 95, 62),
    accentDeep: hslHex(hue, 80, 30),
    info: hslHex((hue + 60) % 360, 90, 65),
  }
}

export function currentTheme(): Theme {
  const name = getSettings().theme
  if (name === 'rgb') return rgbTheme(Math.floor(Date.now() / 1000))
  return THEMES[name] ?? THEMES.green
}

// useSyncExternalStore requires a CACHED snapshot: a fresh object every call
// looks like an endless change and React loops forever. Quantize the rainbow
// to whole seconds (matching the 1s clock) and reuse the object within a tick.
let snapSec = -1
let snapTheme: Theme | null = null

export function snapshotTheme(): Theme {
  if (getSettings().theme !== 'rgb') {
    snapSec = -1
    snapTheme = null
    return THEMES[getSettings().theme] ?? THEMES.green
  }
  const sec = Math.floor(Date.now() / 1000)
  if (sec !== snapSec || !snapTheme) {
    snapSec = sec
    snapTheme = rgbTheme(sec)
  }
  return snapTheme
}

// A 1s clock notifies theme subscribers, but only while the rgb theme is
// active — every other theme is static, so ticks are free no-ops.

type ThemeListener = () => void

const themeListeners = new Set<ThemeListener>()
let themeTimer: ReturnType<typeof setInterval> | null = null

function ensureThemeClock(): void {
  if (themeTimer !== null) return
  themeTimer = setInterval(() => {
    if (getSettings().theme !== 'rgb') return
    for (const listener of themeListeners) listener()
  }, 1000)
  // Never keep the process alive for the animation clock alone.
  ;(themeTimer as unknown as { unref?: () => void }).unref?.()
}

export function subscribeTheme(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  ensureThemeClock()
  return () => {
    themeListeners.delete(listener)
  }
}

/** Solid tints for the sidebar / chat panels (terminal-friendly hex). */
const PANEL_BG_HEX: Record<Exclude<PanelBg, 'auto' | 'transparent'>, string> = {
  black: '#000000',
  blue: '#0B2447',
  forest: '#0E2A1D',
  plum: '#2A1530',
}

/**
 * Resolve a panel background choice: `auto` inherits the canvas (or nothing
 * when the canvas is off), `transparent` always inherits, otherwise a tint.
 */
export function panelBg(choice: PanelBg, fallback?: string): string | undefined {
  if (choice === 'transparent') return undefined
  if (choice === 'auto') return fallback
  return PANEL_BG_HEX[choice] ?? fallback
}

/** The full-canvas backdrop — `undefined` when the user turned it off. */
export function canvasBg(): string | undefined {
  return getSettings().canvasBg ? currentTheme().bg : undefined
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
