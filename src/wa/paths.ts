import { dirname, extname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import type { MediaKind } from './types.js'

export const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..')
export const DATA_DIR = resolvePath(ROOT, '.auth')
export const DATA_FILE = resolvePath(DATA_DIR, 'state.sqlite')
export const MEDIA_DIR = resolvePath(ROOT, '.media')
export const BUNDLED_DEMO_PHOTO = resolvePath(ROOT, 'assets', 'demo', 'golden-hour.png')
export const BUNDLED_DEMO_VOICE = resolvePath(ROOT, 'assets', 'demo', 'voice-note.wav')

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.oga': 'audio/ogg; codecs=opus',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
}

export function guessMimetype(filePath: string, kind: MediaKind): string {
  const mime = MIME_BY_EXT[extname(filePath).toLowerCase()]
  if (mime) return mime
  if (kind === 'image') return 'image/jpeg'
  if (kind === 'video' || kind === 'ptv') return 'video/mp4'
  if (kind === 'gif') return 'image/gif'
  if (kind === 'sticker') return 'image/webp'
  if (kind === 'voice') return 'audio/ogg; codecs=opus'
  if (kind === 'audio') return 'audio/mpeg'
  return 'application/octet-stream'
}

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolvePath(homedir(), p.slice(2))
  return resolvePath(p)
}

export function sanitizeBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'media'
}

export function extForMimetype(mime?: string): string {
  if (!mime) return ''
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
  }
  if (m === 'audio/ogg; codecs=opus' || m === 'audio/ogg') return '.ogg'
  return map[m] ?? ''
}

export function sanitizeJidForPath(jid: string): string {
  return jid.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60)
}
