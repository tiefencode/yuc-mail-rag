import type { ParsedMessage } from './parse.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { categorize } from './categories.ts'
import { parseMessage } from './parse.ts'
import { rawPath } from './raw-files.ts'
import { segment } from './segment.ts'
import { dbPath } from './store.ts'
import { buildThreads } from './threads.ts'

/**
 * Version of the rules that shape the index: segmentation, categories, threading, tokenizer, schema.
 * Bump it with every change to them; an index built with another version is rebuilt completely.
 */
export const RULES_VERSION = 1

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  sha TEXT NOT NULL UNIQUE,
  thread TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT,
  from_address TEXT,
  domain TEXT,
  subject TEXT,
  message_id TEXT,
  folders TEXT NOT NULL,
  attachment_count INTEGER NOT NULL,
  quoted_lines INTEGER NOT NULL,
  own TEXT NOT NULL,
  quoted TEXT NOT NULL,
  signature TEXT NOT NULL
);
CREATE INDEX messages_thread ON messages (thread);
CREATE TABLE refs (sha TEXT NOT NULL, id TEXT NOT NULL);
CREATE INDEX refs_sha ON refs (sha);
CREATE TABLE attachments (sha TEXT NOT NULL, name TEXT NOT NULL, extension TEXT NOT NULL);
CREATE INDEX attachments_sha ON attachments (sha);
CREATE TABLE spam_suspects (
  sha TEXT PRIMARY KEY,
  date TEXT,
  from_address TEXT,
  subject TEXT,
  folder TEXT NOT NULL,
  signals TEXT NOT NULL
);
CREATE VIRTUAL TABLE fts USING fts5(header, own, attachments, secondary, tokenize = 'unicode61 remove_diacritics 2');
`
const TABLES = [
  'meta',
  'messages',
  'refs',
  'attachments',
  'spam_suspects',
  'fts',
]

export interface UpdateResult {
  indexed: number
  spamSuspects: number
}

export interface UpdateOptions {
  /** Replaces the MIME parser, for tests of unparseable messages. */
  parse?: (raw: Uint8Array) => Promise<ParsedMessage>
}

interface CachedMessage {
  sha: string
  date: string | null
  fromAddress: string | null
  subject: string | null
  folders: string[]
}

export function indexPath(dataDir: string): string {
  return join(dataDir, 'index.db')
}

/** A folder whose last hierarchy segment is `Spam` or `Junk`, case ignored. */
export function isSpamFolder(path: string): boolean {
  const last = path.split(/[./]/).pop()!.toLowerCase()
  return last === 'spam' || last === 'junk'
}

export function openIndex(dataDir: string, options: { readonly?: boolean } = {}): Database.Database {
  return new Database(indexPath(dataDir), { readonly: options.readonly ?? true, fileMustExist: true })
}

/** Brings the index in step with the cache: drops what left it, adds what is new, recomputes threads. */
export async function updateIndex(dataDir: string, options: UpdateOptions = {}): Promise<UpdateResult> {
  const parse = options.parse ?? parseMessage
  const cached = readCache(dataDir)
  const indexable = cached.filter(message => message.folders.some(folder => !isSpamFolder(folder)))

  const db = new Database(indexPath(dataDir))
  try {
    db.pragma('journal_mode = WAL')
    ensureSchema(db)

    const known = new Set(db.prepare('SELECT sha FROM messages').pluck().all() as string[])
    const wanted = new Map(indexable.map(message => [message.sha, message]))
    const fresh: { message: CachedMessage, parsed: ParsedMessage | null }[] = []
    for (const message of indexable) {
      if (known.has(message.sha))
        continue
      fresh.push({ message, parsed: await parseOrNull(parse, dataDir, message.sha) })
    }

    db.transaction(() => {
      for (const sha of known) {
        if (!wanted.has(sha))
          removeMessage(db, sha)
      }
      const setFolders = db.prepare('UPDATE messages SET folders = ? WHERE sha = ?')
      for (const message of indexable) {
        if (known.has(message.sha))
          setFolders.run(foldersText(message.folders), message.sha)
      }
      for (const { message, parsed } of fresh)
        insertMessage(db, message, parsed)
      assignThreads(db)
    })()

    return {
      indexed: wanted.size,
      spamSuspects: 0,
    }
  }
  finally {
    db.close()
  }
}

function readCache(dataDir: string): CachedMessage[] {
  if (!existsSync(dbPath(dataDir)))
    return []
  const mail = new Database(dbPath(dataDir), { readonly: true, fileMustExist: true })
  try {
    const rows = mail.prepare(`
      SELECT m.sha256 AS sha, m.date, m.from_address AS fromAddress, m.subject, l.folder
      FROM messages m JOIN locations l ON l.sha256 = m.sha256
      ORDER BY m.sha256, l.folder
    `).all() as (Omit<CachedMessage, 'folders'> & { folder: string })[]
    const messages = new Map<string, CachedMessage>()
    for (const { folder, ...row } of rows) {
      const message = messages.get(row.sha) ?? { ...row, folders: [] }
      if (!message.folders.includes(folder))
        message.folders.push(folder)
      messages.set(row.sha, message)
    }
    return [
      ...messages.values(),
    ]
  }
  finally {
    mail.close()
  }
}

function ensureSchema(db: Database.Database): void {
  const hasMeta = db.prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = \'meta\'').get() !== undefined
  const version = hasMeta
    ? db.prepare('SELECT value FROM meta WHERE key = \'rules_version\'').pluck().get() as string | undefined
    : undefined
  if (version === String(RULES_VERSION))
    return
  db.transaction(() => {
    for (const table of TABLES)
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    db.exec(SCHEMA)
    db.prepare('INSERT INTO meta (key, value) VALUES (\'rules_version\', ?)').run(String(RULES_VERSION))
  })()
}

async function parseOrNull(parse: (raw: Uint8Array) => Promise<ParsedMessage>, dataDir: string, sha: string): Promise<ParsedMessage | null> {
  try {
    return await parse(readFileSync(rawPath(dataDir, sha)))
  }
  catch {
    // An unparseable or unreadable message is still indexed by its stored subject and sender.
    return null
  }
}

function insertMessage(db: Database.Database, message: CachedMessage, parsed: ParsedMessage | null): void {
  const segments = segment(parsed?.text ?? '')
  const category = categorize({
    fromAddress: message.fromAddress,
    autoSubmitted: parsed?.autoSubmitted ?? null,
    listUnsubscribe: parsed?.listUnsubscribe ?? false,
    precedence: parsed?.precedence ?? null,
    contentType: parsed?.contentType ?? null,
  })
  const attachments = parsed?.attachments ?? []
  const domain = message.fromAddress?.slice(message.fromAddress.lastIndexOf('@') + 1) ?? null
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO messages (sha, thread, category, date, from_address, domain, subject, message_id, folders,
      attachment_count, quoted_lines, own, quoted, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(message.sha, message.sha, category, message.date, message.fromAddress, domain, message.subject, parsed?.messageId ?? null, foldersText(message.folders), attachments.length, segments.quotedLines, segments.own, segments.quoted, segments.signature)

  const insertRef = db.prepare('INSERT INTO refs (sha, id) VALUES (?, ?)')
  for (const id of new Set([
    ...(parsed?.inReplyTo ?? []),
    ...(parsed?.references ?? []),
  ]))
    insertRef.run(message.sha, id)
  const insertAttachment = db.prepare('INSERT INTO attachments (sha, name, extension) VALUES (?, ?, ?)')
  for (const attachment of attachments)
    insertAttachment.run(message.sha, attachment.name, attachment.extension)

  db.prepare('INSERT INTO fts (rowid, header, own, attachments, secondary) VALUES (?, ?, ?, ?, ?)').run(
    lastInsertRowid,
    [message.subject, message.fromAddress].filter(Boolean).join('\n'),
    segments.own,
    attachments.map(attachment => attachment.name).join('\n'),
    [segments.quoted, segments.signature].filter(Boolean).join('\n'),
  )
}

function removeMessage(db: Database.Database, sha: string): void {
  const id = db.prepare('SELECT id FROM messages WHERE sha = ?').pluck().get(sha) as number
  db.prepare('DELETE FROM fts WHERE rowid = ?').run(id)
  db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  db.prepare('DELETE FROM refs WHERE sha = ?').run(sha)
  db.prepare('DELETE FROM attachments WHERE sha = ?').run(sha)
}

function assignThreads(db: Database.Database): void {
  const messages = db.prepare('SELECT sha, message_id AS messageId, category, from_address AS fromAddress, subject FROM messages').all() as {
    sha: string
    messageId: string | null
    category: 'correspondence' | 'notification' | 'bounce'
    fromAddress: string | null
    subject: string | null
  }[]
  const refs = new Map<string, string[]>()
  for (const { sha, id } of db.prepare('SELECT sha, id FROM refs').all() as { sha: string, id: string }[]) {
    refs.set(sha, [
      ...(refs.get(sha) ?? []),
      id,
    ])
  }
  const threads = buildThreads(messages.map(message => ({
    ...message,
    inReplyTo: [],
    references: refs.get(message.sha) ?? [],
  })))
  const setThread = db.prepare('UPDATE messages SET thread = ? WHERE sha = ?')
  for (const [sha, thread] of threads)
    setThread.run(thread, sha)
}

function foldersText(folders: string[]): string {
  return [...folders].sort().join('\n')
}
