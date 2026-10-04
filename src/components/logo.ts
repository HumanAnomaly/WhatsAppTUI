/**
 * WhatsAppTUI wordmark — custom block-letter art.
 * On very narrow terminals it falls back to the plain name so nothing wraps.
 */
const ART = [
  '██     ██ ▄▄ ▄▄  ▄▄▄ ▄▄▄▄▄▄ ▄▄▄▄ ▄████▄ ▄▄▄▄  ▄▄▄▄    ██████ ██  ██ ██',
  '██ ▄█▄ ██ ██▄██ ██▀██  ██  ███▄▄ ██▄▄██ ██▄█▀ ██▄█▀     ██   ██  ██ ██',
  ' ▀██▀██▀  ██ ██ ██▀██  ██  ▄▄██▀ ██  ██ ██    ██        ██   ▀████▀ ██',
]

const FALLBACK = ['WhatsAppTUI']

/**
 * The project name as ASCII art, packed to the terminal width.
 * Keeps the `string[][]` shape: one "block" per visual line group.
 */
export function logoLines(cols: number): string[][] {
  const width = ART.reduce((n, line) => Math.max(n, line.length), 0)
  if (width <= cols) return [ART]
  return [FALLBACK]
}
