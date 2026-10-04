import { memo, useEffect, useRef, useState } from 'react'
import { Text, useInput } from 'ink'
import { useIsTTY, useTheme } from '../hooks.js'

interface InputLineProps {
  width: number
  enabled: boolean
  onSubmit: (text: string) => void
  onTypingChange: (typing: boolean) => void
  onEmptyBackspace?: () => void
  onEscape?: () => void
  onChange?: (text: string) => void
  onDraftChange?: (hasText: boolean) => void
  placeholder?: string
}

/** Single-line editor: code-point cursor, clamped viewport, readline keys. */
export const InputLine = memo(function InputLine({ width, enabled, onSubmit, onTypingChange, onEmptyBackspace, onEscape, onChange, onDraftChange, placeholder }: InputLineProps) {
  const theme = useTheme()
  const isTTY = useIsTTY()
  const [chars, setChars] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [start, setStart] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const windowSize = Math.max(8, width - 8)

  useEffect(() => {
    setStart((s) => {
      if (cursor < s) return cursor
      if (cursor > s + windowSize) return cursor - windowSize
      return s
    })
  }, [cursor, windowSize])

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    },
    [],
  )

  const reset = (): void => {
    setChars([])
    setCursor(0)
    setStart(0)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    onTypingChange(false)
    onChange?.('')
  }

  useEffect(() => {
    onDraftChange?.(chars.length > 0)
  })

  useInput(
    (input, key) => {
      if (key.return) {
        const text = chars.join('').trim()
        if (text) onSubmit(text)
        reset()
        return
      }
      if (key.escape) {
        if (chars.length > 0) reset()
        else onEscape?.()
        return
      }
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(chars.length, c + 1))
        return
      }
      // Chat navigation / app shortcuts belong to Main — ignore them here.
      if (key.upArrow || key.downArrow || key.tab || key.pageUp || key.pageDown) return
      if (key.ctrl && input === 'a') {
        setCursor(0)
        return
      }
      if (key.ctrl && input === 'e') {
        setCursor(chars.length)
        return
      }
      if (key.ctrl && input === 'u') {
        reset()
        return
      }
      if (key.ctrl && input === 'w') {
        let i = cursor
        while (i > 0 && chars[i - 1] === ' ') i -= 1
        while (i > 0 && chars[i - 1] !== ' ') i -= 1
        setChars((prev) => [...prev.slice(0, i), ...prev.slice(cursor)])
        setCursor(i)
        onChange?.(chars.slice(0, i).join('') + chars.slice(cursor).join(''))
        return
      }
      if (key.backspace) {
        if (cursor > 0) {
          setChars((prev) => [...prev.slice(0, cursor - 1), ...prev.slice(cursor)])
          setCursor(cursor - 1)
          onChange?.(chars.slice(0, cursor - 1).join('') + chars.slice(cursor).join(''))
        } else if (chars.length === 0) {
          onEmptyBackspace?.()
        }
        return
      }
      if (key.delete) {
        setChars((prev) => [...prev.slice(0, cursor), ...prev.slice(cursor + 1)])
        onChange?.(chars.slice(0, cursor).join('') + chars.slice(cursor + 1).join(''))
        return
      }
      if (input && !key.ctrl && !key.meta && !input.includes('\x1b')) {
        // Escape sequences (mouse reports, unknown keys) never become text.
        const graphemes = Array.from(input.replace(/[\r\n\t]/g, ' '))
        if (graphemes.length === 0) return
        setChars((prev) => [...prev.slice(0, cursor), ...graphemes, ...prev.slice(cursor)])
        setCursor(cursor + graphemes.length)
        onTypingChange(true)
        onChange?.(chars.slice(0, cursor).join('') + graphemes.join('') + chars.slice(cursor).join(''))
        if (idleTimer.current) clearTimeout(idleTimer.current)
        idleTimer.current = setTimeout(() => onTypingChange(false), 3_000)
      }
    },
    { isActive: enabled && isTTY },
  )

  const visible = chars.slice(start, start + windowSize)
  const rel = cursor - start
  const before = visible.slice(0, Math.max(0, Math.min(rel, visible.length))).join('')
  const cursorChar = rel >= 0 && rel < visible.length ? visible[rel]! : ' '
  const after = rel >= 0 && rel + 1 <= visible.length ? visible.slice(rel + 1).join('') : ''

  return (
    <Text>
      <Text color={theme.accent} bold>{' › '}</Text>
      {chars.length === 0 ? (
        <>
          <Text backgroundColor={theme.accent} color="black">{' '}</Text>
          <Text color={theme.dimmer}>{` ${placeholder ?? 'type a message · Enter send · Esc clear'}`}</Text>
        </>
      ) : (
        <>
          <Text color={theme.text}>{before}</Text>
          <Text backgroundColor={theme.accent} color="black">{cursorChar}</Text>
          <Text color={theme.text}>{after}</Text>
        </>
      )}
    </Text>
  )
})
