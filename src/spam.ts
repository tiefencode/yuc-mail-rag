import type Database from 'better-sqlite3'
import { day } from './search.ts'
import { normalizeSubject } from './threads.ts'

export type Signal = 'reply' | 'sender' | 'domain' | 'subject'

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  't-online.de',
  'posteo.de',
  'freenet.de',
  'outlook.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
])
const FREE_MAIL_FAMILIES = /^(?:hotmail|yahoo|yandex)\./

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain) || FREE_MAIL_FAMILIES.test(domain)
}

export interface SpamMessage {
  sha: string
  date: string | null
  fromAddress: string | null
  subject: string | null
  folder: string
  ids: string[]
}

export interface Correspondence {
  ids: Set<string>
  senders: Set<string>
  domains: Set<string>
  subjects: Set<string>
}

/**
 * What the index tells about known threads (ids of every indexed message and of the messages it references)
 * and, from correspondence only, about known senders, domains and subjects.
 */
export function readCorrespondence(db: Database.Database): Correspondence {
  const known: Correspondence = {
    ids: new Set([
      ...db.prepare('SELECT message_id FROM messages WHERE message_id IS NOT NULL').pluck().all() as string[],
      ...db.prepare('SELECT id FROM refs').pluck().all() as string[],
    ]),
    senders: new Set(),
    domains: new Set(),
    subjects: new Set(),
  }
  const rows = db.prepare('SELECT from_address AS fromAddress, domain, subject FROM messages WHERE category = \'correspondence\'').all() as {
    fromAddress: string | null
    domain: string | null
    subject: string | null
  }[]
  for (const row of rows) {
    if (row.fromAddress)
      known.senders.add(row.fromAddress)
    if (row.domain && !isFreeMailDomain(row.domain))
      known.domains.add(row.domain)
    const subject = normalizeSubject(row.subject)
    if (subject)
      known.subjects.add(subject)
  }
  return known
}

export function signalsFor(message: SpamMessage, known: Correspondence): Signal[] {
  const signals: Signal[] = []
  const address = message.fromAddress?.toLowerCase() ?? ''
  const domain = address.slice(address.lastIndexOf('@') + 1)
  if (message.ids.some(id => known.ids.has(id)))
    signals.push('reply')
  if (address && known.senders.has(address))
    signals.push('sender')
  if (domain && !isFreeMailDomain(domain) && known.domains.has(domain))
    signals.push('domain')
  const subject = normalizeSubject(message.subject)
  if (subject && known.subjects.has(subject))
    signals.push('subject')
  return signals
}

/** Replaces the stored suspects with those among the given spam messages; returns their number. */
export function storeSuspects(db: Database.Database, spam: SpamMessage[]): number {
  const known = readCorrespondence(db)
  db.prepare('DELETE FROM spam_suspects').run()
  const insert = db.prepare('INSERT INTO spam_suspects (sha, date, from_address, subject, folder, signals) VALUES (?, ?, ?, ?, ?, ?)')
  let count = 0
  for (const message of spam) {
    const signals = signalsFor(message, known)
    if (signals.length === 0)
      continue
    insert.run(message.sha, message.date, message.fromAddress, message.subject, message.folder, signals.join(', '))
    count++
  }
  return count
}

export function formatSuspects(db: Database.Database): string {
  const rows = db.prepare('SELECT sha, date, from_address AS fromAddress, subject, folder, signals FROM spam_suspects ORDER BY date IS NULL, date DESC, sha').all() as {
    sha: string
    date: string | null
    fromAddress: string | null
    subject: string | null
    folder: string
    signals: string
  }[]
  if (rows.length === 0)
    return 'no spam suspects'
  return rows
    .map(row => `${row.sha.slice(0, 8)}  ${day(row.date)}  ${row.fromAddress ?? '(unknown)'}  ${row.folder}  ${row.signals}  ${row.subject ?? '(no subject)'}`)
    .join('\n')
}
