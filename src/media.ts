import { readFileSync } from 'node:fs'

const durationCache = new Map<string, number>()

/** Duration of a RIFF/WAVE file in whole seconds (0 when it can't be parsed). */
export function wavDurationSec(path: string): number {
  if (!durationCache.has(path)) {
    let sec = 0
    try {
      const buf = readFileSync(path)
      if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
        let pos = 12
        let byteRate = 0
        while (pos + 8 <= buf.length) {
          const id = buf.toString('ascii', pos, pos + 4)
          const size = buf.readUInt32LE(pos + 4)
          if (id === 'fmt ') byteRate = buf.readUInt32LE(pos + 16)
          else if (id === 'data') {
            if (byteRate > 0) sec = Math.max(1, Math.round(size / byteRate))
            break
          }
          pos += 8 + size + (size % 2)
        }
      }
    } catch {
      sec = 0
    }
    durationCache.set(path, sec)
  }
  return durationCache.get(path) ?? 0
}
