import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/**
 * Dependency-free demo asset generators (BMP + WAV, no sharp/ffmpeg).
 */
export function writeDemoBmp(filePath: string, w = 320, h = 240): void {
  const rowSize = Math.floor((24 * w + 31) / 32) * 4
  const px = Buffer.alloc(rowSize * h)
  const cx = w * 0.68
  const cy = h * 0.34
  const sunR = Math.min(w, h) * 0.16
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dy = (y - cy) * 1.15
      const sun = dx * dx + dy * dy <= sunR * sunR
      let r: number
      let g: number
      let b: number
      if (y > h * 0.78) {
        r = 96
        g = 148
        b = 72
      } else if (sun) {
        r = 255
        g = 214
        b = 120
      } else {
        r = Math.round(48 + t * 150)
        g = Math.round(110 + t * 80)
        b = Math.round(200 - t * 60)
      }
      const off = (h - 1 - y) * rowSize + x * 3
      px[off] = b
      px[off + 1] = g
      px[off + 2] = r
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + px.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(w, 18)
  header.writeInt32LE(h, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(px.length, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  writeFileSync(filePath, Buffer.concat([header, px]))
}

export function writeDemoWav(filePath: string, seconds = 2, freqHz = 440, sampleRate = 22050): void {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const data = Buffer.alloc(n * 2)
  const fade = Math.floor(sampleRate * 0.05)
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade)
    const s = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 0.5 * Math.max(0, env)
    data.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(filePath, Buffer.concat([header, data]))
}

export function ensureDemoAssets(dir: string): { photoPath: string; voicePath: string } {
  mkdirSync(dir, { recursive: true })
  const photoPath = resolvePath(dir, 'demo-photo.bmp')
  const voicePath = resolvePath(dir, 'demo-voice.wav')
  writeDemoBmp(photoPath)
  writeDemoWav(voicePath)
  return { photoPath, voicePath }
}
