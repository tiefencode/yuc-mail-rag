import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { indexPath, isSpamFolder, openIndex, RULES_VERSION, updateIndex } from './search-index.ts'
import { eml, FakeMailSource, syncCache } from './testing.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-index-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function indexed(): { subject: string, folders: string, thread: string }[] {
  const db = openIndex(dataDir)
  try {
    return db.prepare('SELECT subject, folders, thread FROM messages ORDER BY subject').all() as { subject: string, folders: string, thread: string }[]
  }
  finally {
    db.close()
  }
}

function subjects(): string[] {
  return indexed().map(row => row.subject)
}

function cacheHashes(): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const entry of readdirSync(dataDir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dataDir, entry)
    // SQLite creates empty -wal/-shm companions when it opens a WAL database, even read-only; they hold no data.
    if (entry.startsWith('index.db') || /-(?:wal|shm)$/.test(entry) || !statSync(path).isFile())
      continue
    hashes[entry] = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  return hashes
}

function server(): FakeMailSource {
  const fake = new FakeMailSource()
  fake.addFolder('INBOX')
  fake.addFolder('INBOX.Spam')
  return fake
}

describe('spam folders', () => {
  it('recognizes Spam and Junk as the last hierarchy segment, case ignored', () => {
    expect(isSpamFolder('INBOX.Spam')).toBe(true)
    expect(isSpamFolder('INBOX.Import.Junk')).toBe(true)
    expect(isSpamFolder('Spam')).toBe(true)
    expect(isSpamFolder('INBOX/junk')).toBe(true)
    expect(isSpamFolder('INBOX')).toBe(false)
    expect(isSpamFolder('INBOX.Spammers')).toBe(false)
    expect(isSpamFolder('Spam.Archive')).toBe(false)
  })
})

describe('Requirement: Index derived from the cache only', () => {
  it('Scenario: Cache unchanged', async () => {
    const fake = server()
    fake.addMessage('INBOX', eml({ subject: 'Trackliste', messageId: 'a@x' }))
    fake.addMessage('INBOX.Spam', eml({ subject: 'Promo', messageId: 'b@x' }))
    await syncCache(dataDir, fake)
    const before = cacheHashes()

    await updateIndex(dataDir)
    await updateIndex(dataDir)

    expect(cacheHashes()).toEqual(before)
  })

  it('Scenario: Index deleted', async () => {
    const fake = server()
    fake.addMessage('INBOX', eml({ subject: 'Trackliste', messageId: 'a@x' }))
    fake.addMessage('INBOX', eml({
      subject: 'Re: Trackliste',
      messageId: 'b@x',
      references: ['a@x'],
    }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)
    const first = indexed()

    rmSync(indexPath(dataDir))
    await updateIndex(dataDir)

    expect(indexed()).toEqual(first)
  })

  it('indexes nothing when the data directory does not exist yet', async () => {
    expect(await updateIndex(join(dataDir, 'missing'))).toEqual({ indexed: 0, spamSuspects: 0 })
  })

  it('indexes nothing when the cache is missing', async () => {
    const result = await updateIndex(dataDir)
    expect(result).toEqual({ indexed: 0, spamSuspects: 0 })
    expect(subjects()).toEqual([])
  })
})

describe('Requirement: Index follows the cache', () => {
  it('Scenario: Message deleted by sync', async () => {
    const fake = server()
    const uid = fake.addMessage('INBOX', eml({ subject: 'Weg', messageId: 'a@x' }))
    fake.addMessage('INBOX', eml({ subject: 'Bleibt', messageId: 'b@x' }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    fake.removeMessage('INBOX', uid)
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    expect(subjects()).toEqual(['Bleibt'])
  })

  it('Scenario: Message moved into a spam folder', async () => {
    const fake = server()
    const uid = fake.addMessage('INBOX', eml({ subject: 'Verschoben', messageId: 'a@x' }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    fake.moveMessage('INBOX', uid, 'INBOX.Spam')
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    expect(subjects()).toEqual([])
  })

  it('Scenario: Message rescued from spam', async () => {
    const fake = server()
    const uid = fake.addMessage('INBOX.Spam', eml({ subject: 'Gerettet', messageId: 'a@x' }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)
    expect(subjects()).toEqual([])

    fake.moveMessage('INBOX.Spam', uid, 'INBOX')
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    expect(indexed()).toEqual([
      expect.objectContaining({ subject: 'Gerettet', folders: 'INBOX' }),
    ])
  })

  it('indexes a message with one location in spam and one outside, with both folders', async () => {
    const fake = server()
    fake.addFolder('INBOX.Import.INBOX')
    const raw = eml({ subject: 'Doppelt', messageId: 'a@x' })
    fake.addMessage('INBOX.Spam', raw)
    fake.addMessage('INBOX.Import.INBOX', raw)
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    expect(indexed()).toEqual([
      expect.objectContaining({ subject: 'Doppelt', folders: 'INBOX.Import.INBOX\nINBOX.Spam' }),
    ])
  })

  it('survives two updates running at the same time', async () => {
    const fake = server()
    fake.addMessage('INBOX', eml({ subject: 'Gleichzeitig', messageId: 'a@x' }))
    await syncCache(dataDir, fake)

    await Promise.all([
      updateIndex(dataDir),
      updateIndex(dataDir),
    ])

    expect(subjects()).toEqual(['Gleichzeitig'])
  })

  it('recomputes threads when a new message links two threads', async () => {
    const fake = server()
    fake.addMessage('INBOX', eml({ subject: 'A', messageId: 'a@x' }))
    fake.addMessage('INBOX', eml({ subject: 'B', messageId: 'b@x' }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)
    expect(new Set(indexed().map(row => row.thread)).size).toBe(2)

    fake.addMessage('INBOX', eml({
      subject: 'C',
      messageId: 'c@x',
      references: ['a@x', 'b@x'],
    }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    expect(new Set(indexed().map(row => row.thread)).size).toBe(1)
  })
})

describe('Requirement: Index rebuilt when rules change', () => {
  it('Scenario: Rules changed', async () => {
    const fake = server()
    fake.addMessage('INBOX', eml({ subject: 'Trackliste', messageId: 'a@x' }))
    await syncCache(dataDir, fake)
    await updateIndex(dataDir)

    const db = openIndex(dataDir, { readonly: false })
    db.prepare('UPDATE messages SET category = \'stale\'').run()
    db.prepare('UPDATE meta SET value = ? WHERE key = \'rules_version\'').run(String(RULES_VERSION - 1))
    db.close()

    await updateIndex(dataDir)

    const check = openIndex(dataDir)
    expect(check.prepare('SELECT category FROM messages').pluck().all()).toEqual(['correspondence'])
    expect(check.prepare('SELECT value FROM meta WHERE key = \'rules_version\'').pluck().get()).toBe(String(RULES_VERSION))
    check.close()
  })
})

describe('Requirement: Body text extraction', () => {
  it('Scenario: Unparseable message', async () => {
    const fake = server()
    fake.addMessage('INBOX', eml({ subject: 'Kaputt', from: 'max@band.com', messageId: 'a@x' }))
    fake.addMessage('INBOX', eml({ subject: 'Heil', messageId: 'b@x' }))
    await syncCache(dataDir, fake)

    let calls = 0
    await updateIndex(dataDir, {
      parse: async (raw) => {
        calls++
        if (new TextDecoder().decode(raw).includes('Kaputt'))
          throw new Error('broken MIME')
        const { parseMessage } = await import('./parse.ts')
        return parseMessage(raw)
      },
    })

    expect(calls).toBe(2)
    expect(subjects()).toEqual(['Heil', 'Kaputt'])
    const db = openIndex(dataDir)
    const header = db.prepare('SELECT header FROM fts WHERE fts MATCH ?').pluck().all('kaputt')
    expect(header).toEqual([
      expect.stringContaining('max@band.com'),
    ])
    db.close()
  })
})
