import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { DATA_DIR } from './paths.js'

/** Per-number history: one shared `default` session, so the last login is recorded here. */
export const OWNER_FILE = resolvePath(DATA_DIR, 'active-profile.json')

export interface ActiveProfile {
  profileId: string
  meJid: string
  updatedAt: number
}

/** Filesystem-safe identity for a login, e.g. `62812xxx@s.whatsapp.net`. */
export function profileIdForJid(jid: string): string {
  return jid.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'unknown'
}

export function readActiveProfile(): ActiveProfile | null {
  try {
    if (!existsSync(OWNER_FILE)) return null
    const raw = JSON.parse(readFileSync(OWNER_FILE, 'utf8')) as Partial<ActiveProfile>
    if (!raw || typeof raw.profileId !== 'string' || typeof raw.meJid !== 'string') return null
    return { profileId: raw.profileId, meJid: raw.meJid, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0 }
  } catch {
    return null
  }
}

export function writeActiveProfile(meJid: string): ActiveProfile {
  const profile: ActiveProfile = { profileId: profileIdForJid(meJid), meJid, updatedAt: Date.now() }
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(OWNER_FILE, JSON.stringify(profile, null, 2) + '\n')
  } catch {
  }
  return profile
}
