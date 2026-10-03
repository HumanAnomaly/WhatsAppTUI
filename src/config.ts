import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CONFIG_DIR = resolve(ROOT, '.config')
export const CONFIG_FILE = resolve(CONFIG_DIR, 'settings.json')

export type ThemeName = 'green' | 'ocean' | 'mono'
export type TimeFormat = '24h' | '12h'
export type ChatSort = 'recent' | 'unread' | 'name'

export interface Settings {
  theme: ThemeName
  timeFormat: TimeFormat
  chatSort: ChatSort
  /** Mark opened chats as read (send read receipts). */
  readReceipts: boolean
  /** Broadcast the composing indicator while typing. */
  typingIndicator: boolean
  /** Terminal bell on a new message in a background chat. */
  bellOnNewMessage: boolean
  /** Ask the server for older messages when opening an empty chat. */
  autoLoadHistory: boolean
  reconnectAttempts: 3 | 5 | 10 | 20
}

const DEFAULTS: Settings = {
  theme: 'green',
  timeFormat: '24h',
  chatSort: 'recent',
  readReceipts: true,
  typingIndicator: true,
  bellOnNewMessage: false,
  autoLoadHistory: true,
  reconnectAttempts: 10,
}

function load(): Settings {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS }
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<Settings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

let settings: Settings = load()
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return settings
}

export function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch }
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2) + '\n')
  } catch {
    // persistence is best effort — the in-memory value still applies
  }
  for (const listener of listeners) listener()
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
