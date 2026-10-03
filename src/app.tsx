import { useEffect, useState } from 'react'
import { Text } from 'ink'
import { currentTheme } from './theme.js'
import { useGateway } from './hooks.js'
import { MouseRouter } from './mouse.js'
import { Screen } from './components/Screen.js'
import { Splash } from './components/Splash.js'
import { Pairing } from './components/Pairing.js'
import { Main } from './components/Main.js'
import { SettingsScreen } from './components/Settings.js'
import { ChatMenu } from './components/ChatMenu.js'
import { HelpScreen } from './components/Help.js'
import { ProfileScreen } from './components/Profile.js'
import { gateway } from './wa/gateway.js'

const MIN_SPLASH_MS = 1200

function BootError({ error }: { error: string }) {
  const theme = currentTheme()
  return (
    <Screen>
      <Text color={theme.danger} bold> failed to start</Text>
      <Text color={theme.text}> {error}</Text>
      <Text color={theme.dimmer}> check your internet connection and run again: npm start</Text>
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
      ) : state.screen === 'settings' ? (
        <SettingsScreen />
      ) : state.screen === 'chatMenu' ? (
        <ChatMenu />
      ) : state.screen === 'help' ? (
        <HelpScreen />
      ) : state.screen === 'profile' ? (
        <ProfileScreen />
      ) : (
        <Main />
      )}
    </>
  )
}
