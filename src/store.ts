import type { Location, Metadata, SenderStats, StoredLocation } from './types.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { UNKNOWN_SENDER } from './constants.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  sha256 TEXT PRIMARY KEY,
  message_id TEXT,
  date TEXT,
  from_address TEXT,
  subject TEXT,
  size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_message_id ON messages (message_id);
CREATE TABLE IF NOT EXISTS locations (
  sha256 TEXT NOT NULL REFERENCES messages (sha256),
  folder TEXT NOT NULL,
  uid_validity INTEGER NOT NULL,
  uid INTEGER NOT NULL,
  PRIMARY KEY (folder, uid_validity, uid)
);
CREATE TABLE IF NOT EXISTS folders (
  path TEXT PRIMARY KEY,
  uid_validity INTEGER NOT NULL
);
`

export interface StoredMessage extends Metadata {
  sha256: string
  size: number
}

export interface Store {
  hasMessage: (sha: string) => boolean
  insertMessage: (sha: string, metadata: Metadata, size: number, location: Location) => void
  insertLocation: (sha: string, location: Location) => void
  locationsOf: (folder: string) => StoredLocation[]
  removeLocation: (location: Location) => void
  folders: () => string[]
  setFolder: (path: string, uidValidity: number) => void
  removeFolder: (path: string) => number
  orphanMessages: () => string[]
  deleteMessage: (sha: string) => void
  countMessageIdsWithSeveralSources: () => number
  messages: () => StoredMessage[]
  locations: () => StoredLocation[]
  totals: () => { count: number, bytes: number }
  senders: () => SenderStats[]
  close: () => void
}

export function dbPath(dataDir: string): string {
  return join(dataDir, 'mail.db')
}

export function openStore(dataDir: string): Store {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(dbPath(dataDir))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  const insertLocationStatement = db.prepare(
    'INSERT INTO locations (sha256, folder, uid_validity, uid) VALUES (?, ?, ?, ?)',
  )
  const insertMessageStatement = db.prepare(
    'INSERT INTO messages (sha256, message_id, date, from_address, subject, size) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertMessageWithLocation = db.transaction((sha: string, metadata: Metadata, size: number, location: Location) => {
    insertMessageStatement.run(sha, metadata.messageId, metadata.date, metadata.fromAddress, metadata.subject, size)
    insertLocationStatement.run(sha, location.folder, location.uidValidity, location.uid)
  })
  const removeFolderWithLocations = db.transaction((path: string): number => {
    const { changes } = db.prepare('DELETE FROM locations WHERE folder = ?').run(path)
    db.prepare('DELETE FROM folders WHERE path = ?').run(path)
    return changes
  })

  const selectLocations = 'SELECT sha256, folder, uid_validity AS uidValidity, uid FROM locations'

  return {
    hasMessage: sha => db.prepare('SELECT 1 FROM messages WHERE sha256 = ?').get(sha) !== undefined,
    insertMessage: (sha, metadata, size, location) => insertMessageWithLocation(sha, metadata, size, location),
    insertLocation: (sha, location) => {
      insertLocationStatement.run(sha, location.folder, location.uidValidity, location.uid)
    },
    locationsOf: folder => db.prepare(`${selectLocations} WHERE folder = ?`).all(folder) as StoredLocation[],
    removeLocation: (location) => {
      db.prepare('DELETE FROM locations WHERE folder = ? AND uid_validity = ? AND uid = ?')
        .run(location.folder, location.uidValidity, location.uid)
    },
    folders: () => (db.prepare('SELECT path FROM folders').all() as { path: string }[]).map(row => row.path),
    setFolder: (path, uidValidity) => {
      db.prepare('INSERT INTO folders (path, uid_validity) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET uid_validity = excluded.uid_validity')
        .run(path, uidValidity)
    },
    removeFolder: path => removeFolderWithLocations(path),
    orphanMessages: () => (db.prepare(
      'SELECT sha256 FROM messages WHERE sha256 NOT IN (SELECT sha256 FROM locations)',
    ).all() as { sha256: string }[]).map(row => row.sha256),
    deleteMessage: (sha) => {
      db.prepare('DELETE FROM messages WHERE sha256 = ?').run(sha)
    },
    countMessageIdsWithSeveralSources: () => (db.prepare(
      'SELECT COUNT(*) AS n FROM (SELECT message_id FROM messages WHERE message_id IS NOT NULL GROUP BY message_id HAVING COUNT(*) > 1)',
    ).get() as { n: number }).n,
    messages: () => db.prepare(
      'SELECT sha256, message_id AS messageId, date, from_address AS fromAddress, subject, size FROM messages ORDER BY sha256',
    ).all() as StoredMessage[],
    locations: () => db.prepare(`${selectLocations} ORDER BY folder, uid_validity, uid`).all() as StoredLocation[],
    totals: () => db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM messages').get() as { count: number, bytes: number },
    senders: () => db.prepare(
      `SELECT COALESCE(from_address, ?) AS sender, COUNT(*) AS count, SUM(size) AS bytes
       FROM messages GROUP BY sender ORDER BY bytes DESC, sender ASC`,
    ).all(UNKNOWN_SENDER) as SenderStats[],
    close: () => db.close(),
  }
}
