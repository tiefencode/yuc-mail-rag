import type Database from 'better-sqlite3'
import { resolve } from 'node:path'
import { UsageError } from './errors.ts'
import { rawPath } from './raw-files.ts'
import { day } from './search.ts'

interface ShownMessage {
  sha: string
  date: string | null
  fromAddress: string | null
  subject: string | null
  category: string
  quotedLines: number
  own: string
  quoted: string
  signature: string
}

/** Finds the one indexed message whose SHA-256 starts with the reference. */
export function resolveReference(db: Database.Database, reference: string): string {
  const prefix = reference.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(prefix))
    throw new UsageError(`no indexed message with reference ${JSON.stringify(reference)}`)
  const shas = db.prepare('SELECT sha FROM messages WHERE sha >= ? AND sha < ? LIMIT 2').pluck().all(prefix, `${prefix}g`) as string[]
  if (shas.length === 0)
    throw new UsageError(`no indexed message with reference ${prefix}`)
  if (shas.length > 1)
    throw new UsageError(`reference ${prefix} is ambiguous: give more characters`)
  return shas[0]!
}

export function showThread(db: Database.Database, dataDir: string, reference: string, full: boolean): string {
  const sha = resolveReference(db, reference)
  const thread = db.prepare('SELECT thread FROM messages WHERE sha = ?').pluck().get(sha) as string
  const messages = db.prepare(`
    SELECT sha, date, from_address AS fromAddress, subject, category, quoted_lines AS quotedLines, own, quoted, signature
    FROM messages WHERE thread = ? ORDER BY date IS NULL, date, sha
  `).all(thread) as ShownMessage[]
  const attachments = db.prepare('SELECT name FROM attachments WHERE sha = ? ORDER BY rowid').pluck()

  const blocks = messages.map((message) => {
    const names = attachments.all(message.sha) as string[]
    const lines = [
      `${message.sha.slice(0, 8)}  ${day(message.date)}  ${message.fromAddress ?? '(unknown)'}  ${message.category}${marker(message.sha === sha)}`,
      `Subject: ${message.subject ?? '(no subject)'}`,
      ...(names.length > 0
        ? [`Attachments: ${names.join(', ')}`]
        : []),
      `raw: ${resolve(rawPath(dataDir, message.sha))}`,
      '',
      message.own || '(no own text)',
    ]
    if (full) {
      if (message.signature)
        lines.push('', '--- signature ---', message.signature)
      if (message.quoted)
        lines.push('', '--- quoted ---', message.quoted)
    }
    else if (message.quotedLines > 0) {
      lines.push('', `[${plural(message.quotedLines, 'quoted line')}]`)
    }
    return lines.join('\n')
  })
  return [`thread: ${plural(messages.length, 'message')}`, ...blocks].join(`\n\n${'-'.repeat(60)}\n`)
}

function plural(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${count} ${noun}s`
}

/** Marks the message the reference named. */
function marker(selected: boolean): string {
  return selected ? '  <--' : ''
}
