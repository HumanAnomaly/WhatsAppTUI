import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { decode as decodeJpeg } from 'jpeg-js'

interface DecodedImage {
  width: number
  height: number
  rgb: Uint8Array
}

const decodeCache = new Map<string, DecodedImage | null>()

/** Decode an 8-bit non-interlaced PNG (RGB / RGBA / grayscale / palette). */
export function decodePngRgb(buf: Buffer): DecodedImage {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  const idat: Buffer[] = []
  let palette: Buffer | null = null
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
      interlace = data[12]!
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported PNG (bit depth / interlace)')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 || colorType === 3 ? 1 : 0
  if (!channels || width <= 0 || height <= 0) throw new Error('unsupported PNG color type')
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = channels
  const stride = width * bpp
  const out = Buffer.allocUnsafe(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]!
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0
      const b = prev ? prev[x]! : 0
      const c = prev !== null && x >= bpp ? prev[x - bpp]! : 0
      let v = line[x]!
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      row[x] = v & 0xff
    }
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const o = i * channels
    if (colorType === 3) {
      const idx = out[o]! * 3
      rgb[i * 3] = palette?.[idx] ?? 0
      rgb[i * 3 + 1] = palette?.[idx + 1] ?? 0
      rgb[i * 3 + 2] = palette?.[idx + 2] ?? 0
    } else if (colorType === 0 || colorType === 4) {
      const g = out[o]!
      rgb[i * 3] = g
      rgb[i * 3 + 1] = g
      rgb[i * 3 + 2] = g
    } else {
      rgb[i * 3] = out[o]!
      rgb[i * 3 + 1] = out[o + 1]!
      rgb[i * 3 + 2] = out[o + 2]!
    }
  }
  return { width, height, rgb }
}

/** Decode a 24-bit uncompressed BMP (bottom-up, BGR rows) — the demo fallback format. */
export function decodeBmpRgb(buf: Buffer): DecodedImage {
  if (buf.toString('ascii', 0, 2) !== 'BM') throw new Error('not a BMP file')
  const dataOffset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  let height = buf.readInt32LE(22)
  const bpp = buf.readUInt16LE(28)
  const compression = buf.readUInt32LE(30)
  if (bpp !== 24 || compression !== 0) throw new Error('unsupported BMP (needs 24-bit uncompressed)')
  const rowSize = Math.floor((24 * width + 31) / 32) * 4
  if (height < 0) height = -height // top-down variant
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const src = dataOffset + y * rowSize
    const dst = (height - 1 - y) * width * 3 // BMP rows are bottom-up
    for (let x = 0; x < width; x++) {
      rgb[dst + x * 3] = buf[src + x * 3 + 2]!
      rgb[dst + x * 3 + 1] = buf[src + x * 3 + 1]!
      rgb[dst + x * 3 + 2] = buf[src + x * 3]!
    }
  }
  return { width, height, rgb }
}

function decodeAny(buf: Buffer): DecodedImage {
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    const img = decodeJpeg(buf, { useTArray: true, formatAsRGBA: false })
    const { width, height, data } = img
    const rgb = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = data[i * 3]!
      rgb[i * 3 + 1] = data[i * 3 + 1]!
      rgb[i * 3 + 2] = data[i * 3 + 2]!
    }
    return { width, height, rgb }
  }
  if (buf.toString('ascii', 0, 2) === 'BM') return decodeBmpRgb(buf)
  return decodePngRgb(buf)
}

function decodeCached(path: string): DecodedImage | null {
  if (!decodeCache.has(path)) {
    try {
      decodeCache.set(path, decodeAny(readFileSync(path)))
    } catch {
      decodeCache.set(path, null)
    }
  }
  return decodeCache.get(path) ?? null
}

export function imageInfo(path: string): { width: number; height: number } | null {
  const img = decodeCached(path)
  return img ? { width: img.width, height: img.height } : null
}

export interface ImageCells {
  cols: number
  rows: number
  /** One line per cell row; each line is a run of same-colored '▀' cells. */
  lines: Array<Array<{ n: number; fg: string; bg: string }>>
}

/** Cell size that preserves the source aspect (each cell holds 2 pixels vertically). */
export function imageCellSize(imgW: number, imgH: number, maxCols: number): { cols: number; rows: number } {
  const cols = Math.max(10, Math.min(44, maxCols))
  const rows = Math.max(3, Math.min(24, Math.round((cols * imgH) / imgW / 2)))
  return { cols, rows }
}

function sampleCell(img: DecodedImage, cx: number, cy: number, cols: number, rowsPx: number): [number, number, number] {
  const x0 = Math.floor((cx * img.width) / cols)
  const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / cols))
  const y0 = Math.floor((cy * img.height) / rowsPx)
  const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / rowsPx))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 3
      r += img.rgb[o]!
      g += img.rgb[o + 1]!
      b += img.rgb[o + 2]!
      n++
    }
  }
  return [r / n, g / n, b / n]
}

function hex([r, g, b]: [number, number, number]): string {
  const q = (v: number): string => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0')
  return `#${q(r)}${q(g)}${q(b)}`
}

/** Render an image file into colored half-block cell runs (throws when unavailable). */
export function renderImageCells(path: string, maxCols: number): ImageCells {
  const img = decodeCached(path)
  if (!img) throw new Error('image unavailable')
  const { cols, rows } = imageCellSize(img.width, img.height, maxCols)
  const lines: ImageCells['lines'] = []
  for (let cy = 0; cy < rows; cy++) {
    const runs: ImageCells['lines'][number] = []
    let cur: { n: number; fg: string; bg: string } | null = null
    for (let cx = 0; cx < cols; cx++) {
      const fg = hex(sampleCell(img, cx, cy * 2, cols, rows * 2))
      const bg = hex(sampleCell(img, cx, cy * 2 + 1, cols, rows * 2))
      if (cur && cur.fg === fg && cur.bg === bg) {
        cur.n += 1
      } else {
        cur = { n: 1, fg, bg }
        runs.push(cur)
      }
    }
    lines.push(runs)
  }
  return { cols, rows, lines }
}

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
