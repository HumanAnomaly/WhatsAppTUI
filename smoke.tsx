/* Temporary functional smoke test — run: pnpm exec tsx smoke.tsx */
import { Writable, PassThrough } from 'node:stream'
import React from 'react'
import { render } from 'ink'
import { App } from './src/app.js'
import { gateway } from './src/wa/gateway.js'

class FakeStdout extends Writable {
  isTTY = true
  columns = 100
  rows = 30
  chunks: string[] = []

  override _write(chunk: Buffer | string, _enc: unknown, cb: () => void): void {
    this.chunks.push(String(chunk))
    cb()
  }

  /** Ink wraps each frame in sync-update markers; the big chunk is the frame. */
  currentFrame(): string {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this.chunks[i]!.length > 40) return this.chunks[i]!
    }
    return ''
  }

  checkpoint(): void {
    this.chunks = []
  }
}

const stdin = new PassThrough() as unknown as NodeJS.ReadStream & { isTTY: boolean; setRawMode: (m: boolean) => void }
stdin.isTTY = true
stdin.setRawMode = (): void => undefined

const stdout = new FakeStdout()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION:', err)
})
process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION:', err)
})

let failures = 0
function expectFrame(label: string, needle: string | null, present: boolean): void {
  const frame = stdout.lastFrame
  const ok = needle === null ? true : present === frame.includes(needle)
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label} — ${present ? 'expected' : 'did not expect'} "${needle}"`)
    console.log(frame.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').split('\n').slice(0, 30).join('\n'))
  }
}
async function keys(seq: string, settleMs = 260): Promise<void> {
  for (const ch of seq) {
    stdin.write(ch)
    await sleep(50)
  }
  await sleep(settleMs)
}

async function main(): Promise<void> {
  gateway.seedDemo()
  const instance = render(<App />, { stdout: stdout as never, stdin: stdin as never, exitOnCtrlC: false, patchConsole: false })

  console.log('boot + main list:')
  await sleep(2000)
  console.log(`[diag] writes=${stdout.writes ?? 'n/a'} len=${stdout.lastFrame.length}`)
  instance.waitUntilExit?.().catch((err) => console.log('exit error:', err))
  expectFrame('shows desktop list title', 'CHATS · all', true)
  expectFrame('shows chat Dina', 'Dina', true)
  expectFrame('shows chat Raka', 'Raka', true)
  expectFrame('shows Archived row with count', 'Archived · 1', true)

  console.log('search (Ctrl+F):')
  await keys('\x06')
  expectFrame('search bar placeholder visible', 'search chats or messages', true)
  await keys('dina')
  expectFrame('query narrows to Dina', 'Dina', true)
  expectFrame('other chats filtered out', 'Raka', false)
  expectFrame('archived chat filtered out too', '+6281234500003', false)

  console.log('close search (Esc clears, Esc closes):')
  await keys('\x1b')
  expectFrame('first Esc clears text, search still open', 'search chats or messages', true)
  await keys('\x1b')
  expectFrame('search closed, full list back', 'Raka', true)

  console.log('archived folder (Shift+Tab):')
  await keys('\x1b[Z')
  expectFrame('folder row flips to back-entry', '‹ All chats', true)
  expectFrame('archived chat now listed', '+6281234500003', true)
  expectFrame('regular chats hidden', 'Raka', false)
  await keys('\x1b[Z')
  expectFrame('back to all chats', 'Raka', true)
  expectFrame('Archived row shows again', 'Archived · 1', true)

  console.log('help popup (Ctrl+K):')
  await keys('\x0b')
  expectFrame('popup sheet rendered', 'WhatsAppTUI — shortcuts', true)
  expectFrame('popup lists search key', 'Ctrl+F', true)
  await keys('\x1b')
  expectFrame('Esc closes popup', 'WhatsAppTUI — shortcuts', false)

  console.log('search + Enter closes:')
  await keys('\x06')
  await keys('raka')
  await keys('\r')
  expectFrame('Enter closes search', 'search chats or messages', false)
  expectFrame('Raka selected & rendered', 'futsal', true)

  instance.unmount()
  await sleep(100)
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('crashed:', err)
    process.exit(1)
  })
