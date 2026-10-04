import { GatewayDemoBase } from './gateway-demo.js'

// Facade over the gateway class chain; existing './wa/gateway.js' imports keep working.
export class WaGateway extends GatewayDemoBase {}

export const gateway = new WaGateway()

export type {
  GatewayState,
  MediaKind,
  ProfileView,
  Screen,
  ThreadData,
  WaMediaInfo,
  WaMediaKind,
  WaMsg,
  WaPhase,
  WaPlaybackState,
  WaSession,
  WaThread,
} from './types.js'
export {
  collectNewsletterMessages,
  decodeStoredMessage,
  decodeStoredMessageFull,
  describeMessage,
  errorMessage,
  extractNodeText,
  formatMediaDuration,
  inferDemoMedia,
  renderMessageText,
  withCaption,
} from './decode.js'
export type { NewsletterNode } from './decode.js'
export { expandHome } from './paths.js'
export { openExternalFile, playAudioFile } from './media-os.js'
export type { AuthDemoSlug } from './gateway-demo.js'
export { AUTH_DEMO_SLUGS } from './gateway-demo.js'
