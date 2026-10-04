import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { GatewayChannelsBase } from './gateway-channels.js'
import { errorMessage } from './decode.js'
import { expandHome } from './paths.js'
import { PRIVACY_CYCLES } from './types.js'

export class GatewayProfileBase extends GatewayChannelsBase {
  async loadProfile(): Promise<void> {
    const client = this.client
    if (this.state.demo) {
      this.set({
        profile: {
          name: 'Demo User',
          about: 'chatting from the terminal',
          privacy: { lastSeen: 'contacts', profilePicture: 'all', about: 'contacts', online: 'all', readReceipts: 'all', groupAdd: 'contacts' },
        },
      })
      return
    }
    if (!client) return
    const creds = client.getCredentials() as unknown as { meJid?: string; pushName?: string } | null
    let about: string | null = null
    try {
      if (creds?.meJid) {
        const res = await client.profile.getStatus(creds.meJid)
        about = typeof res === 'string' ? res : ((res as unknown as { status?: string })?.status ?? null)
      }
    } catch {
    }
    let privacy: Record<string, string> | null = null
    try {
      privacy = { ...(await client.privacy.getPrivacySettings()) as unknown as Record<string, string> }
    } catch {
    }
    this.set({ profile: { name: creds?.pushName ?? null, about, privacy } })
  }

  async setProfileName(name: string): Promise<void> {
    const client = this.client
    const current = this.state.profile ?? { name: null, about: null, privacy: null }
    if (this.state.demo || !client) {
      this.set({ profile: { ...current, name: name || null } })
      return
    }
    try {
      await client.profile.setPushName(name)
      this.set({ profile: { ...current, name: name || null } })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async setProfileAbout(text: string): Promise<void> {
    const client = this.client
    const current = this.state.profile ?? { name: null, about: null, privacy: null }
    if (this.state.demo || !client) {
      this.set({ profile: { ...current, about: text || null } })
      return
    }
    try {
      await client.profile.setStatus(text)
      this.set({ profile: { ...current, about: text || null } })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async setProfilePicturePath(rawPath: string): Promise<void> {
    const client = this.client
    const abs = expandHome(rawPath)
    if (!existsSync(abs)) {
      this.set({ error: `File not found: ${abs}` })
      return
    }
    if (this.state.demo || !client) {
      this.set({ note: `Demo: profile picture would be set from ${abs}` })
      return
    }
    try {
      await client.profile.setProfilePicture(await readFile(abs))
      this.set({ note: 'Profile picture updated' })
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  async cyclePrivacy(setting: string): Promise<void> {
    const values = PRIVACY_CYCLES[setting] ?? ['all', 'contacts', 'contact_blacklist', 'none']
    const current = this.state.profile?.privacy?.[setting] ?? values[0]!
    const next = values[(values.indexOf(current) + 1) % values.length]!
    const privacy = { ...(this.state.profile?.privacy ?? {}), [setting]: next }
    this.set({ profile: { ...(this.state.profile ?? { name: null, about: null }), privacy } })
    if (this.state.demo || !this.client) return
    try {
      await (this.client.privacy.setPrivacySetting as (setting: string, value: string) => Promise<string | null>)(setting, next)
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }
}
