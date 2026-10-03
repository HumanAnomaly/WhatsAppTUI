import { render } from 'ink'
import { App } from './app.js'
import { gateway } from './wa/gateway.js'
import { enableMouse, disableMouseSeq } from './mouse.js'

const TTY = process.stdout.isTTY === true

if (TTY) {
  // GUI mode: dedicated screen buffer + mouse reporting. The solid black
  // canvas itself is painted by Ink (Screen wrapper, Box backgroundColor).
  process.stdout.write('\x1b[?1049h') // alternate screen buffer
  enableMouse()
}

process.on('exit', () => {
  if (!TTY) return
  process.stdout.write(disableMouseSeq)
  process.stdout.write('\x1b[?1049l') // leave the alternate screen
})

if (process.env.WHATSAPPTUI_DEMO || process.argv.includes('--demo')) {
  gateway.seedDemo()
} else {
  void gateway.start()
}

render(<App />, { exitOnCtrlC: true })
