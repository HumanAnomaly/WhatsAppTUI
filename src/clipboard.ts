import { spawn } from 'node:child_process'

/** Best-effort system clipboard copy. Returns false when no tool exists. */
export function copyToClipboard(text: string): boolean {
  const platforms: Record<string, Array<{ cmd: string; args?: string[] }>> = {
    win32: [{ cmd: 'clip' }],
    darwin: [{ cmd: 'pbcopy' }],
    linux: [{ cmd: 'wl-copy' }, { cmd: 'xclip', args: ['-selection', 'clipboard'] }],
  }
  const candidates = platforms[process.platform] ?? []
  for (const { cmd, args = [] } of candidates) {
    try {
      const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
      child.on('error', () => undefined)
      child.stdin!.end(text)
      return true
    } catch {
      continue
    }
  }
  return false
}
