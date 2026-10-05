import { openSqliteConnection } from '@zapo-js/store-sqlite'

/**
 * Rebuilds missing chat-list rows from orphaned messages.
 * Run with the app CLOSED:  pnpm run recover:threads
 * Names, pins and mutes re-resolve on next launch; nothing on your phone is touched.
 */
const conn = await openSqliteConnection({ path: '.auth/state.sqlite', sessionId: 'recovery' })
try {
  const threads = conn.all<{ n: number }>('SELECT COUNT(*) AS n FROM mailbox_threads WHERE session_id = ?', ['default'])
  const messages = conn.all<{ n: number }>('SELECT COUNT(*) AS n FROM mailbox_messages WHERE session_id = ?', ['default'])
  const orphans = conn.all<{ n: number }>(
    'SELECT COUNT(DISTINCT m.thread_jid) AS n FROM mailbox_messages m LEFT JOIN mailbox_threads t ON t.session_id = m.session_id AND t.jid = m.thread_jid WHERE m.session_id = ? AND t.jid IS NULL',
    ['default'],
  )
  console.log(`threads=${threads[0]?.n ?? 0} messages=${messages[0]?.n ?? 0} orphan chats=${orphans[0]?.n ?? 0}`)
  if ((orphans[0]?.n ?? 0) === 0) {
    console.log('Nothing to recover — every message already has its chat row.')
  } else {
    await conn.runInTransaction(() => {
      conn.run(
        `INSERT INTO mailbox_threads (session_id, jid, name, unread_count, archived, pinned, mute_end_ms, marked_as_unread, ephemeral_expiration)
         SELECT 'default', m.thread_jid, NULL, 0, 0, 0, 0, 0, NULL
         FROM mailbox_messages m LEFT JOIN mailbox_threads t ON t.session_id = m.session_id AND t.jid = m.thread_jid
         WHERE m.session_id = ? AND t.jid IS NULL GROUP BY m.thread_jid`,
        ['default'],
      )
    })
    const after = conn.all<{ n: number }>('SELECT COUNT(*) AS n FROM mailbox_threads WHERE session_id = ?', ['default'])
    console.log(`Restored chat rows: threads=${after[0]?.n ?? 0}. Restart the app — names refill automatically.`)
  }
} catch (e) {
  console.log('FAILED: ' + (e as Error).message)
  console.log('Quit the app first (Ctrl+C), then run again — the database may be locked.')
}
conn.close()
process.exit(0)
