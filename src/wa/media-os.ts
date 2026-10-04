import { spawn } from 'node:child_process'

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

export function openExternalFile(filePath: string): void {
  const fail = (): void => undefined
  if (process.platform === 'win32') spawnIgnorant('cmd', ['/c', 'start', '', filePath], fail)
  else if (process.platform === 'darwin') spawnIgnorant('open', [filePath], fail)
  else spawnIgnorant('xdg-open', [filePath], fail)
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
