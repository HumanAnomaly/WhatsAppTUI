import { memo, useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import QRCode from 'qrcode'
import { currentTheme } from '../theme.js'
import { useGateway, useIsTTY, useSpinner } from '../hooks.js'
import { formatPairingCode } from '../format.js'
import { Screen } from './Screen.js'
import { gateway } from '../wa/gateway.js'

const QUIET_ZONE = 3

function buildLines(value: string): string[][] {
  let qr: ReturnType<typeof QRCode.create> | null = null
  try {
    qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
  } catch {
    return []
  }
  const size = qr.modules.size
  const total = size + QUIET_ZONE * 2
  const darkAt = (row: number, col: number): boolean =>
    row >= 0 && row < size && col >= 0 && col < size && qr!.modules.get(row, col) === 1

  const lines: string[][] = []
  for (let line = 0; line < Math.ceil(total / 2); line++) {
    const rowT = line * 2 - QUIET_ZONE
    const rowB = line * 2 + 1 - QUIET_ZONE
    const cells: string[] = []
    for (let col = -QUIET_ZONE; col < size + QUIET_ZONE; col++) {
      const t = darkAt(rowT, col)
      const b = darkAt(rowB, col)
      cells.push(t && b ? '█' : t ? '▀' : b ? '▄' : ' ')
    }
    const segs: string[] = []
    for (const cell of cells) {
      const last = segs[segs.length - 1]
      if (last !== undefined && last[0] === cell) {
        segs[segs.length - 1] = last + cell
      } else {
        segs.push(cell)
      }
    }
    lines.push(segs)
  }
  return lines
}

const QrCode = memo(function QrCode({ value }: { value: string }) {
  const lines = useMemo(() => buildLines(value), [value])
  const [shown, setShown] = useState(0)
  const theme = currentTheme()

  useEffect(() => {
    setShown(0)
  }, [value])

  useEffect(() => {
    if (shown >= lines.length) return
    const t = setTimeout(() => setShown((n) => n + 1), 14)
    return () => clearTimeout(t)
  }, [shown, lines.length])

  if (lines.length === 0) {
    return <Text color="red">Could not render the QR code</Text>
  }

  return (
    <Box flexDirection="column" alignItems="flex-start">
      {lines.slice(0, shown).map((segs, i) => (
        <Text key={`${value}-${i}`}>
          {segs.map((seg, j) => (
            <Text key={j} backgroundColor="white" color="black">{seg}</Text>
          ))}
        </Text>
      ))}
      {shown >= lines.length ? (
        <Box marginTop={0}>
          <Text color={theme.accent}>{'▼ point your phone camera here ▼'}</Text>
        </Box>
      ) : null}
    </Box>
  )
})

export const Pairing = memo(function Pairing() {
  const state = useGateway()
  const spinner = useSpinner()
  const isTTY = useIsTTY()
  const theme = currentTheme()
  const [mode, setMode] = useState<'qr' | 'code-ask'>('qr')
  const [phone, setPhone] = useState('')
  const qr = state.qr
  const ttlLeft = qr ? Math.max(0, Math.ceil((qr.expiresAt - Date.now()) / 1000)) : 0
  const expired = qr !== null && ttlLeft === 0

  useInput(
    (input, key) => {
      if (state?.pairingCode) {
        if (key.escape) setMode('qr')
        return
      }
      if (mode === 'qr') {
        if (input === 'p' || input === 'P') setMode('code-ask')
        return
      }
      if (key.escape) {
        setPhone('')
        setMode('qr')
        return
      }
      if (key.return) {
        const digits = phone.replace(/\D/g, '')
        if (digits.length >= 8) void gateway.requestPairingCode(digits)
        return
      }
      if (key.backspace || key.delete) {
        setPhone((p) => p.slice(0, -1))
        return
      }
      if (input && /\d/.test(input)) {
        setPhone((p) => (p.length < 15 ? p + input : p))
      }
    },
    { isActive: isTTY },
  )
  return (
    <Screen>
      <Box flexDirection="column" paddingX={2} paddingTop={1} gap={1}>
        <Box borderStyle="round" borderColor={theme.accentDeep} paddingX={2} paddingY={1} flexDirection="column" alignItems="center" alignSelf="flex-start">
          {state.pairingCode ? (
            <>
              <Text color={theme.accent} bold>Pairing code ready</Text>
              <Text> </Text>
              <Text color={theme.warn} bold>{formatPairingCode(state.pairingCode)}</Text>
              <Text> </Text>
              <Text color={theme.dim}>On your phone: WhatsApp → Linked devices</Text>
              <Text color={theme.dim}>→ Link with phone number instead</Text>
              <Text> </Text>
              <Text color={theme.dimmer}>Esc — back to the QR code</Text>
            </>
          ) : mode === 'code-ask' ? (
            <>
              <Text color={theme.accent} bold>Pair with a code</Text>
              <Text> </Text>
              <Text color={theme.dim}>Phone number (country code first, digits only):</Text>
              <Text color={theme.text} bold>{`› ${phone}█`}</Text>
              <Text> </Text>
              <Text color={theme.dimmer}>Enter — request the code · Esc — cancel</Text>
            </>
          ) : (
            <>
              <Text color={theme.accent} bold>Scan to link this device</Text>
              <Text> </Text>
              {qr ? (
                <QrCode value={qr.value} />
              ) : (
                <Text color={theme.dim}>
                  <Text color={theme.accent}>{spinner}</Text> waiting for a QR from the server…
                </Text>
              )}
              <Text> </Text>
              {qr ? (
                expired ? (
                  <Text color={theme.warn}>{spinner} rotating the QR…</Text>
                ) : (
                  <Text color={theme.dim}>
                    valid for {ttlLeft}s · auto-rotates{qr.attempt > 1 ? ` · attempt ${qr.attempt}` : ''}
                  </Text>
                )
              ) : null}
              <Text color={theme.dim}>On your phone: WhatsApp → Linked devices → Link a device</Text>
              <Text color={theme.dimmer}>P — use an 8-character code instead (no scan)</Text>
            </>
          )}
        </Box>

        {state.note ? <Text color={theme.warn}>◈ {state.note}</Text> : null}
        {state.error ? <Text color={theme.danger}>✖ {state.error}</Text> : null}
        <Text color={theme.dimmer}>{spinner} session is stored in .auth/state.sqlite — you only scan once</Text>
      </Box>
    </Screen>
  )
})
