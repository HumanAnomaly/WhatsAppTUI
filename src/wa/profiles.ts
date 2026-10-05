import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { DATA_DIR, DATA_FILE } from './paths.js'

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

/**
 * Owner identity for comparison: user digits only, device suffix (`:5`) and
 * domain stripped. The server flaps between PN/LID/device formats for the
 * SAME number — comparing raw JIDs mistook that for an account switch and
 * wiped the local history. Never again.
 */
export function ownerKey(meJid: string): string {
  const user = meJid.split('@')[0] ?? meJid
  return (user.split(':')[0] ?? user).replace(/\D/g, '')
}

export function sameOwner(a: string, b: string): boolean {
  const key = ownerKey(a)
  return key.length > 0 && key === ownerKey(b)
}

/**
 * Timestamped copy of the store (main + WAL + SHM) before any destructive
 * action. Restoring = stop the app, copy back over `.auth/state.sqlite*`.
 */
export function backupStoreFile(): string | null {
  try {
    if (!existsSync(DATA_FILE)) return null
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = resolvePath(DATA_DIR, `state.backup-${ts}.sqlite`)
    copyFileSync(DATA_FILE, dest)
    for (const suffix of ['-shm', '-wal']) {
      const sidecar = `${DATA_FILE}${suffix}`
      if (existsSync(sidecar)) {
        try {
          copyFileSync(sidecar, `${dest}${suffix}`)
        } catch {
          // main file backup is what matters most
        }
      }
    }
    return dest
  } catch {
    return null
  }
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
