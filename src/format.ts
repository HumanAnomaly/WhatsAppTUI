import { getSettings } from './config.js'

function twoDigit(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatClock(d: Date): string {
  const h24 = d.getHours()
  if (getSettings().timeFormat === '12h') {
    const ampm = h24 >= 12 ? 'PM' : 'AM'
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    return `${h12}:${twoDigit(d.getMinutes())} ${ampm}`
  }
  return `${twoDigit(h24)}:${twoDigit(d.getMinutes())}`
}

export function formatMsgTime(tsMs: number, now = new Date()): string {
  const d = new Date(tsMs)
  if (d.toDateString() === now.toDateString()) return formatClock(d)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
  return `${twoDigit(d.getDate())}/${twoDigit(d.getMonth() + 1)}`
}

export function formatFullTime(tsMs: number): string {
  const d = new Date(tsMs)
  return `${twoDigit(d.getDate())}/${twoDigit(d.getMonth() + 1)} ${formatClock(d)}`
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

/** Truncate to a maximum terminal-cell width, appending an ellipsis. */
export function truncateVisual(text: string, max: number): string {
  if (max <= 0) return ''
  if (visualWidth(text) <= max) return text
  let out = ''
  let width = 0
  for (const ch of text) {
    const cw = visualWidth(ch)
    if (width + cw > max - 1) break
    out += ch
    width += cw
  }
  return out + '…'
}

/** Right-pad with spaces until the terminal-cell width reaches `width`. */
export function padVisual(text: string, width: number): string {
  const pad = width - visualWidth(text)
  return pad > 0 ? text + ' '.repeat(pad) : text
}

export function displayJid(jid: string): string {
  const user = jid.split('@')[0] ?? jid
  if (jid.endsWith('@g.us')) return 'group chat'
  if (jid.endsWith('@lid')) return user
  return `+${user.replace(/\D/g, '')}`
}

export function formatPairingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

/** Rough terminal-cell width of a string (wide chars — emoji/CJK — count 2). */
export function visualWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf)
    width += wide ? 2 : 1
  }
  return width
}
