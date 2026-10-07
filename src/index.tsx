import { render } from 'ink'
import { App } from './app.js'
import { AUTH_DEMO_SLUGS, gateway, type AuthDemoSlug } from './wa/gateway.js'
import { enableMouse, disableMouseSeq } from './mouse.js'

const TTY = process.stdout.isTTY === true

if (TTY) {
  // Alternate screen buffer + mouse reporting.
  process.stdout.write('\x1b[?1049h') // alternate screen buffer
  enableMouse()
}

process.on('exit', () => {
  if (!TTY) return
  process.stdout.write(disableMouseSeq)
  process.stdout.write('\x1b[?1049l') // leave the alternate screen
})

// Kill/term must close the WA socket cleanly — otherwise the server keeps
// the stale session and the next boot fights it (stream conflict).
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void gateway.shutdown().then(
      () => process.exit(sig === 'SIGINT' ? 130 : 0),
      () => process.exit(1),
    )
  })
}

const DEMO_HELP = `WhatsAppTUI — demo auth/loading playground

Usage:
  npm start                        connect with your WhatsApp account
  npm run demo                       full chat demo            (--demo=main)
  npm run demo -- --demo=<slug>      seed ONE screen by slug:

    loading        splash / boot progress (connecting…)
    qr             pairing QR (scan with your phone)
    code           pairing “press P” state (no QR yet)
    code-ready     pairing code ready (8-char code)
    reconnecting   reconnect banner over sample chats
    boot-error     failed-to-start screen
    main           full demo (default)

  Env WHATSAPPTUI_DEMO=<slug> works too. In any demo auth screen press
  1..7 to jump between slugs without restarting.`

function parseDemoSlug(argv: string[], env: NodeJS.ProcessEnv): AuthDemoSlug | null {
  const isDemo = (v: string | undefined): boolean => v === '1' || v === 'true' || v === 'yes'
  let raw: string | undefined
  let bareDemo = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--demo' && argv[i + 1] && !argv[i + 1]!.startsWith('-')) {
      raw = argv[i + 1]
      break
    }
    if (a === '--demo') {
      bareDemo = true
      continue
    }
    if (a.startsWith('--demo=')) {
      raw = a.slice('--demo='.length)
      break
    }
  }
  if (raw === undefined) {
    const envRaw = env.WHATSAPPTUI_DEMO
    if (envRaw === undefined) return bareDemo ? 'main' : null
    raw = envRaw
  }
  if (raw === '' || isDemo(raw) || raw === 'main') return 'main'
  const slug = raw.toLowerCase() as AuthDemoSlug
  if ((AUTH_DEMO_SLUGS as string[]).includes(slug)) return slug
  process.stderr.write(`Unknown demo slug "${raw}" — falling back to "main".\n`)
  process.stderr.write(`Known slugs: ${AUTH_DEMO_SLUGS.join(' · ')}\n`)
  return 'main'
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(DEMO_HELP + '\n')
  process.exit(0)
}

const demoSlug = parseDemoSlug(process.argv.slice(2), process.env)
if (demoSlug !== null) {
  if (demoSlug === 'main') gateway.seedDemo()
  else gateway.seedAuthDemo(demoSlug)
} else {
  void gateway.start()
}

render(<App />, { exitOnCtrlC: true })
