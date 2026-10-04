import { Writable } from 'node:stream'
import React from 'react'
import { render } from 'ink'
import { Text } from 'ink'

class FakeStdout extends Writable {
  isTTY = true
  columns = 100
  rows = 30
  writes = 0
  lastFrame = ''
  override _write(chunk: Buffer | string, _enc: unknown, cb: () => void): void {
    this.writes++
    this.lastFrame = String(chunk)
    cb()
  }
}

const stdout = new FakeStdout()

function Hello() {
  return <Text color="green">hello world frame</Text>
}

const instance = render(<Hello />, { stdout: stdout as never, patchConsole: false, exitOnCtrlC: false })
setTimeout(() => {
  console.log('writes:', stdout.writes, 'lastLen:', stdout.lastFrame.length)
  console.log('content:', JSON.stringify(stdout.lastFrame.slice(0, 120)))
  instance.unmount()
  process.exit(0)
}, 500)
