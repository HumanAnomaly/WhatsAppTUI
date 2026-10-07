import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter } from 'node:path'

/** Sync PATH lookup — so we never claim "opened/playing" when no app exists. */
export function commandExists(cmd: string): boolean {
  if (cmd.includes('/')) {
    try {
      accessSync(cmd, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    try {
      accessSync(`${dir}/${cmd}`, constants.X_OK)
      return true
    } catch {
      // try next dir
    }
  }
  return false
}

/** Spawn without ever crashing on ENOENT — spawn errors arrive asynchronously. */
export function spawnIgnorant(cmd: string, args: string[], onFail?: () => void): { kill(): void } | null {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => onFail?.()) // ENOENT etc. — must not become an unhandled event
    child.unref()
    return { kill: () => child.kill() }
  } catch {
    onFail?.()
    return null
  }
}

export function openExternalFile(filePath: string): boolean {
  const fail = (): void => undefined
  if (process.platform === 'win32') {
    spawnIgnorant('cmd', ['/c', 'start', '', filePath], fail)
    return true
  }
  if (process.platform === 'darwin') {
    spawnIgnorant('open', [filePath], fail)
    return true
  }
  // Headless Linux (SSH/container) has nowhere to open the file — say so
  // instead of firing xdg-open into the void.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false
  if (!commandExists('xdg-open')) return false
  spawnIgnorant('xdg-open', [filePath], fail)
  return true
}

/** True when a real audio player binary exists (else playback would be silent). */
export function hasAudioPlayer(filePath: string): boolean {
  if (process.platform === 'win32' && /\.wav$/i.test(filePath)) return true
  const cmds = ['mpv', 'ffplay']
  if (process.platform === 'darwin') cmds.push('afplay')
  if (process.platform === 'linux') cmds.push('paplay', 'aplay')
  return cmds.some(commandExists)
}

/**
 * Start audio playback. Returns a kill handle when an in-process player was
 * spawned (so pause can stop it); null when the OS handler took over. Player
 * failures (mpv not installed, …) are async, so the chain advances from the
 * 'error' handler — a missing binary can never crash the app.
 */
export function playAudioFile(filePath: string): { kill(): void } | null {
  const candidates: Array<{ cmd: string; args: string[] }> = []
  if (process.platform === 'win32' && /\.wav$/i.test(filePath)) {
    const ps = filePath.replace(/'/g, "''")
    candidates.push({ cmd: 'powershell', args: ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${ps}').PlaySync()`] })
  }
  candidates.push(
    { cmd: 'mpv', args: ['--no-video', filePath] },
    { cmd: 'ffplay', args: ['-nodisp', '-autoexit', filePath] },
  )
  if (process.platform === 'darwin') candidates.push({ cmd: 'afplay', args: [filePath] })
  if (process.platform === 'linux') {
    candidates.push(
      { cmd: 'paplay', args: [filePath] },
      { cmd: 'aplay', args: [filePath] },
    )
  }

  const tryNext = (index: number): { kill(): void } | null => {
    if (index >= candidates.length) {
      openExternalFile(filePath)
      return null
    }
    const { cmd, args } = candidates[index]!
    return spawnIgnorant(cmd, args, () => tryNext(index + 1))
  }
  return tryNext(0)
}
