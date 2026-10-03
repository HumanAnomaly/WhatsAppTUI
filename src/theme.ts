import { getSettings, type ThemeName } from './config.js'

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
}

export function currentTheme(): Theme {
  return THEMES[getSettings().theme]
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
