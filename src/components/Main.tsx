import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { panelBg } from '../theme.js'
import { displayJid, formatClock } from '../format.js'
import { useGateway, useIsTTY, useSettings, useTerminalSize, useTheme, useThreads, useTicker } from '../hooks.js'
import { useHover, useMouse, type MouseEvt } from '../mouse.js'
import { Screen } from './Screen.js'
import { copyToClipboard } from '../clipboard.js'
import { gateway, type WaReplyRef, type WaThread } from '../wa/gateway.js'
import { ChatList, CHIP_ZONES, type ChatFilter } from './ChatList.js'
import { ChatHeader, MessageList } from './ChatView.js'
import { InfoPanel } from './InfoPanel.js'
import { InputLine } from './InputBox.js'

const FILTER_ORDER: ChatFilter[] = ['all', 'groups', 'direct', 'channels']
const MOBILE_BREAKPOINT = 76

type MediaKind = 'image' | 'video' | 'ptv' | 'gif' | 'audio' | 'voice' | 'document' | 'sticker'
const MEDIA_COMMANDS: Record<string, MediaKind> = {
  img: 'image',
  vid: 'video',
  gif: 'gif',
  ptv: 'ptv',
  aud: 'audio',
  vn: 'voice',
  doc: 'document',
  stk: 'sticker',
}

const noop = (): void => undefined

const matchesFilter = (t: WaThread, f: ChatFilter): boolean =>
  f === 'all' ||
  (f === 'groups' && t.jid.endsWith('@g.us')) ||
  (f === 'direct' && !t.jid.endsWith('@g.us') && !t.jid.endsWith('@newsletter')) ||
  (f === 'channels' && t.jid.endsWith('@newsletter'))

const StatusBar = memo(function StatusBar({ mobile, hoverMenu = false }: { mobile: boolean; hoverMenu?: boolean }) {
  const state = useGateway()
  const theme = useTheme()
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
      <Text wrap="truncate-end">
        <Text backgroundColor={hoverMenu ? theme.accent : undefined} color={hoverMenu ? 'black' : theme.accent} bold>{' ☰ '}</Text>
        <Text color={theme.accent} bold>WhatsAppTUI</Text>
        <Text color={theme.dimmer}> │ </Text>
        {status}
        {state.download ? <Text color={theme.warn}> ↓ {state.download.label}</Text> : null}
        {state.syncing ? <Text color={theme.dimmer}> · syncing…</Text> : null}
        {state.historyProgress !== null ? (
          <Text color={theme.dimmer}> · {Math.round(state.historyProgress)}%</Text>
        ) : null}
        <Text color={theme.dimmer}> · {formatClock(new Date())}</Text>
        <Text color={theme.dimmer}>{' ⚙'}</Text>
      </Text>
    )
  }
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Text color={theme.accent} bold>WhatsAppTUI</Text>
        <Text color={theme.dimmer}> │ </Text>
        {status}
        {state.download ? <Text color={theme.warn}> ↓ {state.download.label}</Text> : null}
        {state.syncing ? <Text color={theme.dimmer}> · syncing…</Text> : null}
        {state.historyProgress !== null ? (
          <Text color={theme.dimmer}> · syncing history {Math.round(state.historyProgress)}%</Text>
        ) : null}
      </Text>
      <Text>
        {state.me ? <Text color={theme.dim}>{displayJid(state.me)}</Text> : null}
        <Text color={theme.dimmer}>{state.me ? ' · ' : ''}{formatClock(new Date())}</Text>
        <Text color={theme.dimmer} bold>{' ⚙'}</Text>
      </Text>
    </Box>
  )
})

export const Main = memo(function Main() {
  const state = useGateway()
  const threads = useThreads()
  const { cols, rows } = useTerminalSize()
  const isTTY = useIsTTY()
  const theme = useTheme()
  const mobile = cols < MOBILE_BREAKPOINT
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const [filter, setFilter] = useState<ChatFilter>('all')
  const [archivedView, setArchivedView] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Selection is keyed by JID, not index: when a sent message bumps a thread
  // to the top of the sort order, the selection follows the same conversation.
  const [selJid, setSelJid] = useState<string | null>(() => state.activeJid)
  const [scroll, setScroll] = useState(0)
  const [listStart, setListStart] = useState(0)
  const [showInfo, setShowInfo] = useState(false)
  // Pending reply target — cleared on chat switch and after send.
  const [reply, setReply] = useState<WaReplyRef | null>(null)
  const replyRef = useRef<WaReplyRef | null>(null)
  replyRef.current = reply
  const prefs = useSettings()
  const sidebarBg = panelBg(prefs.sidebarBg)
  const chatBg = panelBg(prefs.chatBg)

  const filtered = useMemo(
    () => threads.filter((t) => t.archived === archivedView && matchesFilter(t, filter)),
    [threads, filter, archivedView],
  )
  const q = query.trim().toLowerCase()
  const searched = useMemo(() => {
    if (!q) return filtered
    return filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.jid.toLowerCase().includes(q) ||
        t.messages.some((m) => m.text.toLowerCase().includes(q)),
    )
  }, [filtered, q])

  const foundIdx = searched.findIndex((t) => t.jid === selJid)
  const selIdx = foundIdx >= 0 ? foundIdx : 0
  const active = searched[selIdx] ?? null
  const activeJid = active?.jid ?? null
  const activeJidRef = useRef(activeJid)
  activeJidRef.current = activeJid
  const searchedRef = useRef(searched)
  searchedRef.current = searched
  const selIdxRef = useRef(selIdx)
  selIdxRef.current = selIdx
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const archivedRef = useRef(archivedView)
  archivedRef.current = archivedView
  const screenRef = useRef(state.screen)
  screenRef.current = state.screen
  const hasDraftRef = useRef(false)
  const archivedCount = useMemo(() => threads.reduce((n, t) => n + (t.archived ? 1 : 0), 0), [threads])
  const archivedRowShown = archivedCount > 0 || archivedView

  const bodyHeight = Math.max(6, rows - 1)
  const msgRows = Math.max(2, mobile ? bodyHeight - 6 : bodyHeight - 8)
  const listRows = Math.max(4, bodyHeight - 2)
  const listWidth = mobile ? cols : Math.min(38, Math.max(24, Math.floor(cols * 0.34)))
  const infoW = 30
  // Inline 3rd column only when everything fits; otherwise the info panel
  // floats above (same on mobile) so narrow terminals never break layout.
  const infoInline = !mobile && active !== null && cols - listWidth - infoW >= 30
  const msgAreaWidth = mobile ? cols : infoInline ? Math.max(30, cols - listWidth - infoW) : Math.max(30, cols - listWidth)
  const chatEnd = listWidth + msgAreaWidth // 0-based exclusive end of the chat panel (desktop)
  const listMaxItems = Math.max(1, Math.floor((listRows - 1 - (archivedRowShown ? 1 : 0)) / 2))

  const hover = useHover()
  const hoverRow = hover ? hover.y - 1 : -1
  const hoverX = hover ? hover.x : -1
  const hoverMenu = mobile && hoverRow === 0 && hoverX <= 3
  const hoverBack = mobile && mobileView === 'chat' && hoverRow === 1 && hoverX <= 4
  const hoverKebab = mobile
    ? mobileView === 'chat' && hoverRow === 1 && hoverX >= cols - 5
    : hoverRow === 2 && hoverX >= chatEnd - 5
  const hoverChip =
    mobile && mobileView === 'list' && !searchOpen && hoverRow === 1
      ? CHIP_ZONES.findIndex((c) => hoverX >= c.x0 && hoverX <= c.x1)
      : -1
  const hoverHint = hoverRow === rows - 1
  const listTop = (mobile ? 2 : 3) + (archivedRowShown ? 1 : 0)
  const inList = !mobile || mobileView === 'list'
  let hoverIdx = -1
  if (inList && hoverRow >= listTop && (mobile || hoverX - 1 < listWidth)) {
    const idx = listStart + Math.floor((hoverRow - listTop) / 2)
    if (idx >= 0 && idx < searched.length) hoverIdx = idx
  }
  const hoverArchived =
    inList && archivedRowShown && hoverRow === listTop - 1 && (mobile || hoverX - 1 < listWidth)

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])
  const onCopy = useCallback(
    (text: string) => {
      if (screenRef.current !== 'main') return // a popup owns the pointer
      showToast(copyToClipboard(text) ? '✓ copied to clipboard' : 'copy not supported in this terminal')
    },
    [showToast],
  )
  const onMediaOpen = useCallback(
    (id: string) => {
      if (screenRef.current !== 'main') return // a popup owns the pointer
      const jid = activeJidRef.current
      if (!jid) return
      const msg = gateway.getMessage(jid, id)
      if (!msg?.media) return
      gateway.setActiveMedia(jid, id)
      if (msg.media.viewOnce && !msg.media.opened) showToast('👁️ view-once: opening saves a copy')
      const done = (p: string): void => {
        showToast(`✓ opened: ${p}`)
      }
      const fail = (e: unknown): void => {
        showToast(`media failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80))
      }
      void gateway.openMedia(jid, id).then(done, fail)
    },
    [showToast],
  )
  const onMediaPlay = useCallback(
    (id: string) => {
      if (screenRef.current !== 'main') return // a popup owns the pointer
      const jid = activeJidRef.current
      if (!jid) return
      gateway.setActiveMedia(jid, id)
      const fail = (e: unknown): void => {
        showToast(`playback failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80))
      }
      void gateway.togglePlayMedia(jid, id).then(
        (r) => showToast(r === 'playing' ? '▶ playing voice note' : '⏸ paused'),
        fail,
      )
    },
    [showToast],
  )
  const msgTop = mobile ? 4 : 5

  useEffect(() => {
    setListStart((s) => {
      if (selIdx < s) return selIdx
      if (selIdx >= s + listMaxItems) return selIdx - listMaxItems + 1
      return s
    })
  }, [selIdx, listMaxItems])

  useEffect(() => {
    const jump = jumpToMatchRef.current
    jumpToMatchRef.current = null
    if (jump !== null && activeJid) {
      // A search submit asked to land on a match, not on the latest message.
      const t = threadsRef.current.find((x) => x.jid === activeJid)
      setScroll(t ? Math.max(0, t.messages.length - 1 - jump) : 0)
    } else {
      setScroll(0) // fresh chat, fresh top — never carry another chat's offset
    }
    hasDraftRef.current = false // fresh chat, fresh (empty) input
    setReply(null)
    replyRef.current = null
    if (activeJid) void gateway.activateChat(activeJid)
  }, [activeJid])

  const onTypingChange = useCallback((typing: boolean) => {
    const jid = activeJidRef.current
    if (jid) void gateway.setTyping(jid, typing)
  }, [])

  const onSubmit = useCallback((text: string) => {
    const jid = activeJidRef.current
    if (!jid) return
    const reply = replyRef.current
    // Attachment commands: /img /vid /gif /ptv /aud /vn /doc /stk <path> [| caption] [--once]
    const media = /^\/(img|vid|gif|ptv|aud|vn|doc|stk)\s+(.+)$/i.exec(text)
    if (media) {
      const kind = MEDIA_COMMANDS[media[1]!.toLowerCase()]!
      let rest = media[2] ?? ''
      const viewOnce = /(^|\s)--once(\s|$)/.test(rest)
      rest = rest.replace(/(^|\s)--once(\s|$)/g, ' ').trim()
      const [pathPart, captionPart] = rest.split('|')
      const path = (pathPart ?? '').trim()
      const captionRaw = captionPart?.trim() || undefined
      const caption = captionRaw?.replace(/(^|\s)--once(\s|$)/g, ' ').trim() || undefined
      if (viewOnce && kind !== 'image' && kind !== 'video' && kind !== 'gif' && kind !== 'audio' && kind !== 'voice' && kind !== 'ptv') {
        showToast('--once only works for image/video/audio/voice')
        return
      }
      if (path) {
        if (viewOnce) showToast('👁️ view-once: receiver opens once — TUI saves a copy')
        void gateway.sendMedia(
          jid,
          kind,
          path,
          caption,
          viewOnce ? { viewOnce: true, ...(reply ? { reply } : {}) } : reply ? { reply } : undefined,
        )
        setReply(null)
      }
      return
    }
    void gateway.send(jid, text, reply ?? undefined)
    setReply(null)
    setScroll(0)
  }, [showToast])

  const goBack = useCallback(() => setMobileView('list'), [])

  const applyFilter = useCallback((f: ChatFilter) => {
    setFilter(f)
    setSelJid(threadsRef.current.find((t) => t.archived === archivedRef.current && matchesFilter(t, f))?.jid ?? null)
    setScroll(0)
    setListStart(0)
  }, [])
  const openFolder = useCallback((archived: boolean) => {
    setArchivedView(archived)
    setSelJid(threadsRef.current.find((t) => t.archived === archived)?.jid ?? null)
    setScroll(0)
    setListStart(0)
  }, [])
  const closeSearch = useCallback(() => {
    setSelJid(activeJidRef.current)
    setSearchOpen(false)
    setQuery('')
  }, [])
  // Submit a search: count matches, jump the open chat to its first match
  // (or open the first matching chat) — the query stays until Esc.
  const jumpToMatchRef = useRef<number | null>(null)
  const submitSearch = useCallback(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      closeSearch()
      return
    }
    let chats = 0
    let hits = 0
    let firstJid: string | null = null
    let firstIdx = -1
    let activeIdx = -1
    for (const t of searchedRef.current) {
      const idx = t.messages.findIndex((m) => m.text.toLowerCase().includes(needle))
      if (idx < 0) continue
      chats += 1
      for (const m of t.messages) if (m.text.toLowerCase().includes(needle)) hits += 1
      if (firstJid === null) {
        firstJid = t.jid
        firstIdx = idx
      }
      if (t.jid === activeJidRef.current) activeIdx = idx
    }
    if (chats === 0) {
      showToast('no matches')
      return
    }
    showToast(`${hits} match${hits === 1 ? '' : 'es'} in ${chats} chat${chats === 1 ? '' : 's'}`)
    if (activeIdx >= 0) {
      const t = threadsRef.current.find((x) => x.jid === activeJidRef.current)
      if (t) setScroll(Math.max(0, t.messages.length - 1 - activeIdx))
    } else if (firstJid !== null) {
      jumpToMatchRef.current = firstIdx
      setSelJid(firstJid)
    }
  }, [query, closeSearch, showToast])
  const onSearchChange = useCallback((text: string) => {
    setQuery(text)
    setListStart(0)
  }, [])
  const onDraftChange = useCallback((hasText: boolean) => {
    hasDraftRef.current = hasText
  }, [])
  const clearReply = useCallback(() => setReply(null), [])
  const replyLabel = reply
    ? `${reply.senderName}: ${reply.text.replace(/\s+/g, ' ').slice(0, 60)}`
    : null

  const geo = useRef({
    mobile,
    mobileView,
    rows,
    cols,
    listWidth,
    chatEnd,
    infoW,
    showInfo,
    infoInline,
    listMaxItems,
    len: searched.length,
    start: listStart,
    screen: state.screen,
    searchOpen,
    archivedView,
    archivedRowShown,
    listTop,
  })
  geo.current = {
    mobile,
    mobileView,
    rows,
    cols,
    listWidth,
    chatEnd,
    infoW,
    showInfo,
    infoInline,
    listMaxItems,
    len: searched.length,
    start: listStart,
    screen: state.screen,
    searchOpen,
    archivedView,
    archivedRowShown,
    listTop,
  }

  const onMouse = useCallback((e: MouseEvt) => {
    const row = e.y - 1
    const g = geo.current

    if (g.screen !== 'main') return

    if (g.showInfo && !g.infoInline) {
      if (e.kind === 'click' && row === 0) setShowInfo(false)
      return
    }

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

    if (row === 0 && e.x >= g.cols - 2) {
      gateway.setScreen('settings')
      return
    }

    if (row === g.rows - 1) {
      gateway.setScreen('help')
      return
    }

    if (g.mobile) {
      if (row === 0 && e.x <= 3) {
        setMobileView('list')
        return
      }
      if (g.mobileView === 'list') {
        if (row === 1) {
          if (!g.searchOpen) {
            const chip = CHIP_ZONES.find((c) => e.x >= c.x0 && e.x <= c.x1)
            if (chip) applyFilter(chip.id)
          }
          return
        }
        if (g.archivedRowShown && row === g.listTop - 1) {
          openFolder(!g.archivedView)
          return
        }
        if (row >= g.listTop) {
          const idx = g.start + Math.floor((row - g.listTop) / 2)
          const jid = searchedRef.current[idx]?.jid
          if (jid) {
            closeSearch()
            setSelJid(jid)
            setMobileView('chat')
          }
        }
        return
      }
      if (row === 1) {
        if (e.x <= 4) {
          setMobileView('list')
          return
        }
        if (e.x >= g.cols - 5) {
          gateway.setScreen('chatMenu')
          return
        }
        if (activeJidRef.current) setShowInfo((v) => !v)
        return
      }
      return
    }

    if (row === 2 && e.x >= g.chatEnd - 5) {
      gateway.setScreen('chatMenu')
      return
    }
    if (row === 2 && e.x - 1 >= g.chatEnd + 2 && e.x - 1 <= g.chatEnd + 6) {
      setShowInfo(false)
      return
    }
    if (row === 2 && e.x - 1 >= g.listWidth && e.x < g.chatEnd - 5) {
      if (activeJidRef.current) setShowInfo((v) => !v)
      return
    }
    if (e.x - 1 < g.listWidth) {
      if (g.archivedRowShown && row === g.listTop - 1) {
        openFolder(!g.archivedView)
        return
      }
      if (row >= g.listTop) {
        const idx = g.start + Math.floor((row - g.listTop) / 2)
        const jid = searchedRef.current[idx]?.jid
        if (jid) {
          setSelJid(jid)
          setScroll(0)
        }
      }
    }
  }, [applyFilter, openFolder, closeSearch])
  useMouse(onMouse)

  useInput(
    (input, key) => {
      if (key.tab && key.shift) {
        openFolder(!archivedView) // toggle the archived folder
        return
      }
      if (key.tab) {
        applyFilter(FILTER_ORDER[(FILTER_ORDER.indexOf(filter) + 1) % FILTER_ORDER.length]!)
        return
      }
      // While a draft is being typed, ↑/↓ must not switch chats — the input
      // is remounted per chat, so that would silently drop the draft.
      if ((key.upArrow || key.downArrow) && hasDraftRef.current && !searchOpen) return
      if (key.upArrow) {
        setSelJid(searchedRef.current[selIdxRef.current - 1]?.jid ?? searchedRef.current[0]?.jid ?? null)
        setScroll(0)
        return
      }
      if (key.downArrow) {
        setSelJid(
          searchedRef.current[selIdxRef.current + 1]?.jid ??
            searchedRef.current[searchedRef.current.length - 1]?.jid ??
            null,
        )
        setScroll(0)
        return
      }
      if (key.pageUp || key.pageDown) {
        if (mobile && mobileView === 'list') {
          const dir = key.pageUp ? -listMaxItems : listMaxItems
          const maxStart = Math.max(0, searched.length - listMaxItems)
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
        if (active) {
          closeSearch()
          setMobileView('chat')
        }
        return
      }
      if (key.ctrl && input === 'f') {
        if (searchOpen) closeSearch()
        else {
          if (mobile && mobileView === 'chat') setMobileView('list')
          setSearchOpen(true)
          setQuery('')
          setListStart(0)
        }
        return
      }
      if (key.ctrl && input === 's') {
        gateway.setScreen('settings')
        return
      }
      if (key.ctrl && input === 'k') {
        gateway.setScreen('help')
        return
      }
      if (key.ctrl && input === 'o' && activeJid) {
        gateway.setScreen('chatMenu')
        return
      }
      // Empty-input shortcuts (never steal typing):
      // i = info panel, r = reply to hovered/clicked (else last) message,
      // o = open in OS viewer, d = download to .media, p = play voice/audio.
      // Media target = hovered media → clicked media → most recent media.
      if (!key.ctrl && !key.meta && !searchOpen && !hasDraftRef.current) {
        const k = input.toLowerCase()
        if (k === 'i') {
          // (Ctrl+I is Tab in terminals, so the plain key owns this.)
          if (!activeJidRef.current) {
            showToast('open a chat first')
            return
          }
          setShowInfo((v) => !v)
          return
        }
        if (k === 'r') {
          const jid = activeJidRef.current
          if (!jid) return
          const target = gateway.resolveReplyTarget(jid)
          if (!target) {
            showToast('no message to reply to yet')
            return
          }
          setReply(target)
          return
        }
        if (k === 'o' || k === 'd' || k === 'p') {
          const jid = activeJidRef.current
          if (!jid) return
          const last = gateway.resolveMediaTarget(jid)
          if (!last) {
            showToast('no media here — hover or click a media message first')
            return
          }
          if (k === 'p' && last.media?.kind !== 'voice' && last.media?.kind !== 'audio') {
            showToast('last media is not audio — o to open, d to save')
            return
          }
          if (last.media?.viewOnce && !last.media.opened) {
            showToast('👁️ view-once: opening saves a copy')
          } else {
            showToast(k === 'o' ? 'opening media…' : k === 'd' ? 'saving media…' : '▶ voice note…')
          }
          const done = (p: string): void => {
            showToast(`✓ ${k === 'd' ? 'saved' : 'opened'}: ${p}`)
          }
          const fail = (e: unknown): void => {
            showToast(`media failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80))
          }
          if (k === 'o') void gateway.openMedia(jid, last.id).then(done, fail)
          else if (k === 'd') void gateway.downloadMedia(jid, last.id).then(done, fail)
          else onMediaPlay(last.id)
          return
        }
      }
    },
    { isActive: isTTY && state.screen === 'main' },
  )

  const searchInput = searchOpen ? (
    <InputLine
      width={mobile ? cols : listWidth}
      enabled={state.screen === 'main'}
      placeholder="search chats or messages"
      onSubmit={submitSearch}
      onEscape={closeSearch}
      onChange={onSearchChange}
      onTypingChange={noop}
    />
  ) : null

  return (
    <Screen>
      <StatusBar mobile={mobile} hoverMenu={hoverMenu} />
      {mobile && mobileView === 'list' ? (
        <Box height={bodyHeight} backgroundColor={sidebarBg}>
          <ChatList
            threads={searched}
            selIdx={selIdx}
            width={cols}
            height={bodyHeight}
            filter={filter}
            start={listStart}
            chips
            hoverIdx={hoverIdx}
            hoverChip={hoverChip}
            archivedCount={archivedCount}
            archivedView={archivedView}
            hoverArchived={hoverArchived}
            header={searchInput}
          />
        </Box>
      ) : mobile ? (
        <Box flexDirection="column" height={bodyHeight} backgroundColor={chatBg}>
          <ChatHeader thread={active} rev={active?.rev ?? 0} width={cols} mobile hoverBack={hoverBack} hoverKebab={hoverKebab} />
          <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, cols))}</Text>
          <MessageList thread={active} rev={active?.rev ?? 0} width={cols} height={msgRows} scrollOffset={scroll} top={msgTop} onCopy={onCopy} onMediaOpen={onMediaOpen} onMediaPlay={onMediaPlay} />
          <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, cols))}</Text>
          <InputLine
            key={activeJid ?? 'no-chat'}
            width={cols}
            enabled={state.screen === 'main' && !searchOpen}
            onSubmit={onSubmit}
            onTypingChange={onTypingChange}
            onEmptyBackspace={goBack}
            onEscape={goBack}
            onDraftChange={onDraftChange}
            replyLabel={replyLabel}
            onReplyClear={clearReply}
          />
          <Text color={toast ? theme.warn : hoverHint ? theme.accent : theme.dimmer} wrap="truncate-end">
            {toast ? ` ${toast}` : ' Ctrl+K help · i info · p play voice · click: copy / open / play'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="row" height={bodyHeight}>
          <Box flexDirection="column" width={listWidth} borderStyle="round" borderColor={theme.border} backgroundColor={sidebarBg}>
            <ChatList
              threads={searched}
              selIdx={selIdx}
              width={listWidth}
              height={listRows}
              filter={filter}
              start={listStart}
              hoverIdx={hoverIdx}
              archivedCount={archivedCount}
              archivedView={archivedView}
              hoverArchived={hoverArchived}
              header={searchInput}
            />
          </Box>
          <Box flexDirection="column" width={msgAreaWidth} borderStyle="round" borderColor={theme.border} backgroundColor={chatBg}>
            <ChatHeader thread={active} rev={active?.rev ?? 0} width={msgAreaWidth} hoverKebab={hoverKebab} />
            <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, msgAreaWidth - 2))}</Text>
            <MessageList thread={active} rev={active?.rev ?? 0} width={msgAreaWidth} height={msgRows} scrollOffset={scroll} top={msgTop} onCopy={onCopy} onMediaOpen={onMediaOpen} onMediaPlay={onMediaPlay} />
            <Text color={theme.border} wrap="truncate-end">{'─'.repeat(Math.max(4, msgAreaWidth - 2))}</Text>
            {/* key: remount per chat so drafts never leak across conversations */}
            <InputLine
              key={activeJid ?? 'no-chat'}
              width={msgAreaWidth}
              enabled={state.screen === 'main' && !searchOpen}
              onSubmit={onSubmit}
              onTypingChange={onTypingChange}
              onDraftChange={onDraftChange}
              replyLabel={replyLabel}
              onReplyClear={clearReply}
            />
            <Text color={toast ? theme.warn : hoverHint ? theme.accent : theme.dimmer} wrap="truncate-end">
              {toast ? ` ${toast}` : ' Ctrl+K help · Ctrl+F search · i info · p play voice · click: copy / open / play'}
            </Text>
          </Box>
          {infoInline && active ? (
            <Box flexDirection="column" width={infoW} borderStyle="round" borderColor={theme.border} backgroundColor={chatBg}>
              <InfoPanel thread={active} rev={active.rev} width={infoW} />
            </Box>
          ) : null}
        </Box>
      )}
      {showInfo && active && !infoInline ? (
        <Box position="absolute" width={cols} height={rows} flexDirection="column" backgroundColor={chatBg ?? theme.bg} paddingX={1}>
          <Text>
            <Text color={theme.accent} bold>{'‹ back'}</Text>
            <Text color={theme.dimmer}>{' · tap the top row or press i — close'}</Text>
          </Text>
          <Box flexDirection="column" alignItems="center">
            <InfoPanel thread={active} rev={active.rev} width={cols - 2} />
          </Box>
        </Box>
      ) : null}
    </Screen>
  )
})
