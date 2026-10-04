import { memo } from 'react'
import { Text } from 'ink'
import { useGateway, useTheme } from '../hooks.js'
import { AUTH_DEMO_SLUGS, gateway, type AuthDemoSlug } from '../wa/gateway.js'

export const DEMO_SLUG_LABELS: Record<AuthDemoSlug, string> = {
  loading: 'loading',
  qr: 'qr',
  code: 'code',
  'code-ready': 'code ready',
  reconnecting: 'reconnect',
  'boot-error': 'boot error',
  main: 'main',
}

export function demoSlugForKey(input: string): AuthDemoSlug | null {
  const idx = ['1', '2', '3', '4', '5', '6', '7'].indexOf(input)
  if (idx < 0) return null
  return AUTH_DEMO_SLUGS[idx] ?? null
}

export function jumpDemoSlug(slug: AuthDemoSlug): void {
  if (slug === 'main') gateway.seedDemo()
  else gateway.seedAuthDemo(slug)
}

export const DemoSlugHint = memo(function DemoSlugHint() {
  const { demo } = useGateway()
  const theme = useTheme()
  if (!demo) return null
  return (
    <Text color={theme.dimmer}>
      {'  '}demo screens:{' '}
      {AUTH_DEMO_SLUGS.map((slug, i) => `${i + 1}=${DEMO_SLUG_LABELS[slug]}`).join(' · ')}
    </Text>
  )
})
