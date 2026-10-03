/**
 * ANSI-Shadow block glyphs for the project name "WHATSAPPTUI".
 * Each glyph keeps its natural side bearings; glyphs join with no extra gap.
 */
const GLYPHS: Record<string, string[]> = {
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  U: ['██╗  ██╗', '██║  ██║', '██║  ██║', '██║  ██║', '╚██████╔╝', ' ╚═════╝ '],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
}

const WORD = 'WHATSAPPTUI'

function compose(letters: string[]): string[] {
  const rows = ['', '', '', '', '', '']
  for (const ch of letters) {
    const glyph = GLYPHS[ch]
    if (!glyph) continue
    for (let i = 0; i < 6; i++) rows[i]! += glyph[i]!
  }
  return rows
}

/**
 * The full project name as ASCII art, packed to the terminal width:
 * one line when it fits, "WHATSAPP" / "TUI" stacked when that fits,
 * otherwise greedily wrapped — always the whole name.
 */
export function logoLines(cols: number): string[][] {
  const width = (ch: string): number => GLYPHS[ch]!.length > 0 ? GLYPHS[ch]![0]!.length : 0
  const full = compose(WORD.split(''))
  if (full[0]!.length <= cols) return [full]
  const whatsapp = compose('WHATSAPP'.split(''))
  const tui = compose('TUI'.split(''))
  if (whatsapp[0]!.length <= cols) return [whatsapp, tui]
  const lines: string[][] = []
  let current: string[] = []
  let currentWidth = 0
  for (const ch of WORD) {
    const w = width(ch)
    if (current.length > 0 && currentWidth + w > cols) {
      lines.push(current)
      current = []
      currentWidth = 0
    }
    current.push(ch)
    currentWidth += w
  }
  if (current.length > 0) lines.push(current)
  return lines.map(compose)
}
