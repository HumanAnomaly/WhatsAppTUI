import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useGateway, useIsTTY, useTheme } from './hooks.js'
import { MouseRouter } from './mouse.js'
import { Screen } from './components/Screen.js'
import { Splash } from './components/Splash.js'
import { Pairing } from './components/Pairing.js'
import { Main } from './components/Main.js'
import { SettingsPopup } from './components/Settings.js'
import { ChatMenuPopup } from './components/ChatMenu.js'
import { HelpPopup } from './components/Help.js'
import { ReconnectOverlay } from './components/Reconnecting.js'
import { DemoSlugHint, demoSlugForKey, jumpDemoSlug } from './components/DemoSwitcher.js'
import { gateway } from './wa/gateway.js'

const MIN_SPLASH_MS = 1200

function BootError({ error }: { error: string }) {
  const theme = useTheme()
  const { demo } = useGateway()
  const isTTY = useIsTTY()

  useInput(
    (input) => {
      if (!demo) return
      const slug = demoSlugForKey(input)
      if (slug) jumpDemoSlug(slug)
    },
    { isActive: isTTY && demo },
  )

  return (
    <Screen>
      <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2}>
        <Box borderStyle="round" borderColor={theme.danger} paddingX={3} paddingY={1} flexDirection="column" alignItems="center" alignSelf="center">
          <Text color={theme.danger} bold>✖ failed to start</Text>
          <Text> </Text>
          <Text color={theme.text}>{error}</Text>
          <Text> </Text>
          <Text color={theme.dimmer}>check your internet connection and run again: npm start</Text>
        </Box>
        <DemoSlugHint />
      </Box>
    </Screen>
  )
}

export function App() {
  const state = useGateway()
  const [splashDone, setSplashDone] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), MIN_SPLASH_MS)
    return () => {
      clearTimeout(t)
      void gateway.shutdown()
    }
  }, [])

  const booting = !splashDone || (state.phase === 'boot' && !state.error)

  return (
    <>
      <MouseRouter />
      {booting ? (
        <Splash />
      ) : state.phase === 'boot' && state.error ? (
        <BootError error={state.error} />
      ) : state.phase === 'pairing' ? (
        <Pairing />
      ) : (
        // Main always stays mounted — settings, chat menu, help and the
        // reconnect card float above it as popups, so selection, drafts and
        // scroll position survive opening/closing them.
        <>
          <Main />
          {state.screen === 'settings' ? <SettingsPopup /> : null}
          {state.screen === 'chatMenu' ? <ChatMenuPopup /> : null}
          {state.phase === 'reconnecting' ? <ReconnectOverlay /> : null}
          {state.screen === 'help' ? <HelpPopup /> : null}
        </>
      )}
    </>
  )
}
