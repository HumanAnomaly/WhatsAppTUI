import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { currentTheme } from '../theme.js'
import { displayJid, formatClock } from '../format.js'
import { useGateway, useIsTTY, useTerminalSize, useThreads, useTicker } from '../hooks.js'
import { useHover, useMouse, type MouseEvt } from '../mouse.js'
import { Screen } from './Screen.js'
import { copyToClipboard } from '../clipboard.js'
import { gateway } from '../wa/gateway.js'
import { ChatList, ChipsRow, CHIP_ZONES, type ChatFilter } from './ChatList.js'
import { ChatHeader, MessageList } from './ChatView.js'
import { InputLine } from './InputBox.js'

const FILTER_ORDER: ChatFilter[] = ['all', 'groups', 'direct', 'channels']
/** Below this many columns the app switches to the single-panel phone layout. */
const MOBILE_BREAKPOINT = 76

type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker'
const MEDIA_COMMANDS: Record<string, MediaKind> = {
  img: 'image',
  vid: 'video',
  aud: 'audio',
  vn: 'voice',
  doc: 'document',
  stk: 'sticker',
}

const StatusBar = memo(function StatusBar({ mobile, hoverMenu = false }: { mobile: boolean; hoverMenu?: boolean }) {
  const state = useGateway()
  const theme = currentTheme()
  useTicker(15_000)
  const status = state.demo ? (
    <Text color={theme.warn}>◈ demo</Text>
  ) : state.phase === 'reconnecting' ? (
    <Text color={theme.warn}>
      ↻ reconnecting{state.reconnection ? ` ${state.reconnection.attempt}/${state.reconnection.max}` : ''}…
    </Text>
  ) : (
    <Text color={theme.accent}>● online</Text>
  )
  if (mobile) {
    return (
      <Text backgroundColor={theme.bg} wrap="truncate-end">
        <Text backgroundColor={hoverMenu ? theme.accent : undefined} color={hoverMenu ? 'black' : theme.accent} bold>{' ☰ '}</Text>
        <Text color={theme.accent} bold>WhatsAppTUI</Text>
        <Text color={theme.dimmer}> │ </Text>
        {status}
        <Text color={theme.dimmer}> · {formatClock(new Date())}</Text>
      </Text>
    )
  }
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text backgroundColor={theme.bg}>
        <Text color={theme.accent} bold>WhatsAppTUI</Text>
        <Text color={theme.dimmer}> │ </Text>
        {status}
        {state.historyProgress !== null ? (
          <Text color={theme.dimmer}> · syncing history {Math.round(state.historyProgress)}%</Text>
        ) : null}
      </Text>
      <Text backgroundColor={theme.bg}>
        {state.me ? <Text color={theme.dim}>{displayJid(state.me)}</Text> : null}
        <Text color={theme.dimmer}>{state.me ? ' · ' : ''}{formatClock(new Date())}</Text>
      </Text>
    </Box>
  )
})

export const Main = memo(function Main() {
  const state = useGateway()
  const threads = useThreads()
  const { cols, rows } = useTerminalSize()
  const isTTY = useIsTTY()
  const theme = currentTheme()
  const mobile = cols < MOBILE_BREAKPOINT
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const [filter, setFilter] = useState<ChatFilter>('all')
  // Selection is keyed by JID, not index: when a sent message bumps a thread
  // to the top of the sort order, the selection follows the same conversation.
  const [selJid, setSelJid] = useState<string | null>(() => state.activeJid)
  const [scroll, setScroll] = useState(0)
  const [listStart, setListStart] = useState(0)

  const filtered = useMemo(
    () =>
      threads.filter(
        (t) =>
          filter === 'all' ||
          (filter === 'groups' && t.jid.endsWith('@g.us')) ||
          (filter === 'direct' && !t.jid.endsWith('@g.us') && !t.jid.endsWith('@newsletter')) ||
          (filter === 'channels' && t.jid.endsWith('@newsletter')),
      ),
    [threads, filter],
  )
  const foundIdx = filtered.findIndex((t) => t.jid === selJid)
  const selIdx = foundIdx >= 0 ? foundIdx : 0
  const active = filtered[selIdx] ?? null
  const activeJid = active?.jid ?? null
  const activeJidRef = useRef(activeJid)
  activeJidRef.current = activeJid
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered
  const selIdxRef = useRef(selIdx)
  selIdxRef.current = selIdx

  const bodyHeight = Math.max(6, rows - 1)
  const msgRows = Math.max(2, mobile ? bodyHeight - 6 : bodyHeight - 8)
  const listRows = Math.max(4, bodyHeight - 2)
  const listWidth = mobile ? cols : Math.min(38, Math.max(24, Math.floor(cols * 0.34)))
  const msgAreaWidth = mobile ? cols : Math.max(30, cols - listWidth)
  const listMaxItems = Math.max(1, Math.floor((listRows - 1) / 2))

  // ---- cursor hover state ----
  const hover = useHover()
  const hoverRow = hover ? hover.y - 1 : -1
  const hoverX = hover ? hover.x : -1
  const hoverMenu = mobile && hoverRow === 0 && hoverX <= 3
  const hoverBack = mobile && mobileView === 'chat' && hoverRow === 1 && hoverX <= 4
  const hoverKebab = (mobile ? mobileView === 'chat' && hoverRow === 1 : hoverRow === 2) && hoverX >= cols - 3
  const hoverChip =
    mobile && mobileView === 'list' && hoverRow === 1
      ? CHIP_ZONES.findIndex((c) => hoverX >= c.x0 && hoverX <= c.x1)
      : -1
  const hoverHint = hoverRow === rows - 1
  let hoverIdx = -1
  if (hoverRow >= (mobile && mobileView === 'list' ? 2 : 3) && (mobile || hoverX - 1 < listWidth)) {
    const idx = listStart + Math.floor((hoverRow - (mobile && mobileView === 'list' ? 2 : 3)) / 2)
    if (idx >= 0 && idx < filtered.length) hoverIdx = idx
  }

  // ---- toast (shown in the hint row, no layout shift) ----
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])
  const onCopy = useCallback(
    (text: string) => {
      showToast(copyToClipboard(text) ? '✓ copied to clipboard' : 'copy not supported in this terminal')
    },
    [showToast],
  )
  const msgTop = mobile ? 4 : 5

  // Keep the chat-list window on the selection.
  useEffect(() => {
    setListStart((s) => {
      if (selIdx < s) return selIdx
      if (selIdx >= s + listMaxItems) return selIdx - listMaxItems + 1
      return s
    })
  }, [selIdx, listMaxItems])

  useEffect(() => {
    if (activeJid) void gateway.activateChat(activeJid)
  }, [activeJid])

  const onTypingChange = useCallback((typing: boolean) => {
    const jid = activeJidRef.current
    if (jid) void gateway.setTyping(jid, typing)
  }, [])

  const onSubmit = useCallback((text: string) => {
    const jid = activeJidRef.current
    if (!jid) return
    // Attachment commands: /img /vid /aud /vn /doc /stk <path> [| caption]
    const media = /^\/(img|vid|aud|vn|doc|stk)\s+(.+)$/i.exec(text)
    if (media) {
      const kind = MEDIA_COMMANDS[media[1]!.toLowerCase()]!
      const [pathPart, captionPart] = media[2]!.split('|')
      const path = (pathPart ?? '').trim()
      if (path) void gateway.sendMedia(jid, kind, path, captionPart?.trim() || undefined)
      return
    }
    void gateway.send(jid, text)
    setScroll(0)
  }, [])

  const goBack = useCallback(() => setMobileView('list'), [])

  // Latest geometry for the mouse handler (stable callback, live values).
  const geo = useRef({
    mobile,
    mobileView,
    rows,
    cols,
    listWidth,
    listMaxItems,
    len: filtered.length,
    start: listStart,
  })
  geo.current = { mobile, mobileView, rows, cols, listWidth, listMaxItems, len: filtered.length, start: listStart }

  const onMouse = useCallback((e: MouseEvt) => {
    const row = e.y - 1
    const g = geo.current

    // Touch-drag (Termux) / mouse drag scrolls whichever panel is under the finger.
    if (e.kind === 'drag') {
      const dy = e.dy ?? 0
      if (dy === 0) return
      if (!g.mobile && e.x - 1 < g.listWidth) {
        const maxStart = Math.max(0, g.len - g.listMaxItems)
        setListStart((s) => Math.max(0, Math.min(maxStart, s + Math.trunc(dy / 2))))
      } else {
        setScroll((s) => Math.max(0, s - dy))
      }
      return
    }
    if (e.kind === 'wheel-up' || e.kind === 'wheel-down') {
      const dir = e.kind === 'wheel-up' ? 1 : -1
      if (!g.mobile && e.x - 1 < g.listWidth) {
        const maxStart = Math.max(0, g.len - g.listMaxItems)
        setListStart((s) => Math.max(0, Math.min(maxStart, s - dir * 2)))
      } else {
        setScroll((s) => Math.max(0, s + dir * 3))
      }
      return
    }
    if (e.kind !== 'click') return

    // Help is always one click away — the last screen row.
    if (row === g.rows - 1) {
      gateway.setScreen('help')
      return
    }

    if (g.mobile) {
      if (row === 0 && e.x <= 3) {
        setMobileView('list') // ☰ hamburger
        return
      }
      if (g.mobileView === 'list') {
        if (row === 1) {
          const chip = CHIP_ZONES.find((c) => e.x >= c.x0 && e.x <= c.x1)
          if (chip) {
            setFilter(chip.id)
            setSelJid(filteredRef.current[0]?.jid ?? null)
            setScroll(0)
          }
          return
        }
        if (row >= 2) {
          const idx = g.start + Math.floor((row - 2) / 2)
          const jid = filteredRef.current[idx]?.jid
          if (jid) {
            setSelJid(jid) // tap a chat = open it, like the phone app
            setMobileView('chat')
          }
        }
        return
      }
      // chat view
      if (row === 1) {
        if (e.x <= 4) {
          setMobileView('list') // ‹ back
          return
        }
        if (e.x >= g.cols - 3) {
          gateway.setScreen('chatMenu') // ⋮ kebab
        }
      }
      return
    }

    // Desktop
    if (row === 2 && e.x >= g.cols - 3) {
      gateway.setScreen('chatMenu') // ⋮ kebab in the chat header
      return
    }
    if (e.x - 1 < g.listWidth && row >= 3) {
      const idx = g.start + Math.floor((row - 3) / 2)
      const jid = filteredRef.current[idx]?.jid
      if (jid) {
        setSelJid(jid)
        setScroll(0)
      }
    }
  }, [])
  useMouse(onMouse)

  useInput(
    (input, key) => {
      if (key.tab) {
        setFilter((f) => FILTER_ORDER[(FILTER_ORDER.indexOf(f) + 1) % FILTER_ORDER.length]!)
        setSelJid(filteredRef.current[0]?.jid ?? null)
        setScroll(0)
        return
      }
      if (key.upArrow) {
        setSelJid(filteredRef.current[selIdxRef.current - 1]?.jid ?? filteredRef.current[0]?.jid ?? null)
        setScroll(0)
        return
      }
      if (key.downArrow) {
        setSelJid(filteredRef.current[selIdxRef.current + 1]?.jid ?? filteredRef.current[filteredRef.current.length - 1]?.jid ?? null)
        setScroll(0)
        return
      }
      if (key.pageUp || key.pageDown) {
        if (mobile && mobileView === 'list') {
          const dir = key.pageUp ? -listMaxItems : listMaxItems
          const maxStart = Math.max(0, filtered.length - listMaxItems)
          setListStart((s) => Math.max(0, Math.min(maxStart, s + dir)))
          return
        }
        if (key.pageUp) {
          setScroll((o) => {
            const maxScroll = Math.max(0, (activeJidRef.current ? (threads.find((t) => t.jid === activeJidRef.current)?.messages.length ?? 0) : 0) - 1)
            const next = Math.min(maxScroll, o + msgRows)
            const thread = threads.find((t) => t.jid === activeJidRef.current)
            if (thread && next >= maxScroll && !thread.loadingOlder && !thread.exhausted) {
              void gateway.requestOlderMessages(thread.jid)
            }
            return next
          })
        } else {
          setScroll((o) => Math.max(0, o - msgRows))
        }
        return
      }
      if (key.return && mobile && mobileView === 'list') {
        if (active) setMobileView('chat')
        return
      }
      if (key.ctrl && input === 's') {
        gateway.setScreen('settings')
        return
      }
      if (key.ctrl && input === 'p') {
        gateway.setScreen('profile')
        return
      }
      if (key.ctrl && input === 'k') {
        gateway.setScreen('help')
        return
      }
      if (key.ctrl && input === 'o' && activeJid) {
        gateway.setScreen('chatMenu')
      }
    },
    { isActive: isTTY },
  )

  return (
    <Screen>
      <StatusBar mobile={mobile} hoverMenu={hoverMenu} />
      {mobile && mobileView === 'list' ? (
        <ChatList threads={filtered} selIdx={selIdx} width={cols} height={bodyHeight} filter={filter} start={listStart} chips hoverIdx={hoverIdx} hoverChip={hoverChip} />
      ) : mobile ? (
        <Box flexDirection="column" height={bodyHeight}>
          <ChatHeader thread={active} rev={active?.rev ?? 0} width={cols} mobile hoverBack={hoverBack} hoverKebab={hoverKebab} />
          <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, cols))}</Text>
          <MessageList thread={active} rev={active?.rev ?? 0} width={cols} height={msgRows} scrollOffset={scroll} top={msgTop} onCopy={onCopy} />
          <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, cols))}</Text>
          <InputLine key={activeJid ?? 'no-chat'} width={cols} enabled onSubmit={onSubmit} onTypingChange={onTypingChange} onEmptyBackspace={goBack} />
          <Text color={toast ? theme.warn : hoverHint ? theme.accent : theme.dimmer} wrap="truncate-end">
            {toast ? ` ${toast}` : ' Ctrl+K help · click a message to copy'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="row" height={bodyHeight}>
          <Box flexDirection="column" width={listWidth} borderStyle="round" borderColor={theme.border}>
            <ChatList threads={filtered} selIdx={selIdx} width={listWidth} height={listRows} filter={filter} start={listStart} hoverIdx={hoverIdx} />
          </Box>
          <Box flexDirection="column" width={msgAreaWidth} borderStyle="round" borderColor={theme.border}>
            <ChatHeader thread={active} rev={active?.rev ?? 0} width={msgAreaWidth} hoverKebab={hoverKebab} />
            <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, msgAreaWidth - 2))}</Text>
            <MessageList thread={active} rev={active?.rev ?? 0} width={msgAreaWidth} height={msgRows} scrollOffset={scroll} top={msgTop} onCopy={onCopy} />
            <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, msgAreaWidth - 2))}</Text>
            {/* key: remount per chat so drafts never leak across conversations */}
            <InputLine key={activeJid ?? 'no-chat'} width={msgAreaWidth} enabled onSubmit={onSubmit} onTypingChange={onTypingChange} />
            <Text color={toast ? theme.warn : hoverHint ? theme.accent : theme.dimmer} wrap="truncate-end">
              {toast ? ` ${toast}` : ' Ctrl+K help · click a message to copy it'}
            </Text>
          </Box>
        </Box>
      )}
    </Screen>
  )
})
