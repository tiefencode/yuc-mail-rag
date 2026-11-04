import type { Store } from './store.ts'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rawPath, sha256 } from './raw-files.ts'
import { openStore } from './store.ts'
import { sync } from './sync.ts'
import { eml, FakeMailSource } from './testing.ts'

let dataDir: string
let store: Store
let server: FakeMailSource

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-sync-'))
  store = openStore(dataDir)
  server = new FakeMailSource()
  server.addFolder('INBOX')
  server.addFolder('Spam')
})

afterEach(() => {
  store.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function run(): ReturnType<typeof sync> {
  server.fetchedUids = []
  return sync(server, store, dataDir)
}

function storedShas(): string[] {
  return store.messages().map(message => message.sha256)
}

describe('Requirement: Complete and incremental sync', () => {
  it('Scenario: First run', async () => {
    server.addMessage('INBOX', eml({ subject: 'a' }))
    server.addMessage('Spam', eml({ subject: 'b' }))
    server.addFolder('Papierkorb')
    server.addMessage('Papierkorb', eml({ subject: 'c' }))
    server.addFolder('[Gmail]', { selectable: false })
    const summary = await run()
    expect(summary.errors).toEqual([])
    expect(store.messages()).toHaveLength(3)
    expect(store.locations().map(l => l.folder)).toEqual(['INBOX', 'Papierkorb', 'Spam'])
    expect(server.calls).not.toContain('openFolder [Gmail]')
  })

  it('Scenario: New mail', async () => {
    server.addMessage('INBOX', eml({ subject: 'old' }))
    await run()
    const uid = server.addMessage('INBOX', eml({ subject: 'new' }))
    await run()
    expect(server.fetchedUids).toEqual([uid])
    expect(store.messages()).toHaveLength(2)
  })

  it('Scenario: Nothing new', async () => {
    server.addMessage('INBOX', eml())
    await run()
    const summary = await run()
    expect(server.fetchedUids).toEqual([])
    expect(summary.downloaded).toBe(0)
  })

  it('Scenario: Interrupted run', async () => {
    for (const subject of ['a', 'b', 'c'])
      server.addMessage('INBOX', eml({ subject }))
    server.loseConnectionAfterFetches = 1
    await run()
    // What a kill during writeRaw leaves behind: a temp file and a complete raw file without its row.
    const tmp = join(dataDir, 'raw', '.tmp')
    mkdirSync(tmp, { recursive: true })
    writeFileSync(join(tmp, 'partial.123'), 'trunc')
    const orphan = server.folder('INBOX').messages[1]!.source
    mkdirSync(join(rawPath(dataDir, sha256(orphan)), '..'), { recursive: true })
    writeFileSync(rawPath(dataDir, sha256(orphan)), orphan)

    server.loseConnectionAfterFetches = undefined
    const summary = await run()
    expect(summary.errors).toEqual([])
    expect(existsSync(tmp)
      ? readdirSync(tmp)
      : []).toEqual([])
    expect(store.messages()).toHaveLength(3)
    expect(store.locations()).toHaveLength(3)
    for (const message of server.folder('INBOX').messages)
      expect(readFileSync(rawPath(dataDir, sha256(message.source)))).toEqual(Buffer.from(message.source))
  })

  it('Scenario: Message expunged during run', async () => {
    server.addMessage('INBOX', eml({ subject: 'stays' }))
    const gone = server.addMessage('INBOX', eml({ subject: 'gone' }))
    server.expungeBeforeFetch.add(gone)
    const summary = await run()
    expect(summary.errors).toEqual([])
    expect(store.locations().map(l => l.uid)).not.toContain(gone)
    expect(store.messages()).toHaveLength(1)
  })

  it('Scenario: Non-ASCII folder name', async () => {
    server.addFolder('Gelöschte Elemente')
    server.addMessage('Gelöschte Elemente', eml())
    await run()
    expect(store.locations()[0]!.folder).toBe('Gelöschte Elemente')
  })
})

describe('Requirement: Raw message storage', () => {
  it('Scenario: Byte-exact copy', async () => {
    const source = Buffer.concat([
      Buffer.from('Subject: bytes\n\n'),
      Buffer.from([
        0xE4,
        0xF6,
        0xFC,
        0x00,
        0x0A,
        0x41,
        0x0A,
      ]),
    ])
    server.addMessage('INBOX', source)
    await run()
    expect(readFileSync(rawPath(dataDir, sha256(source)))).toEqual(source)
    expect(store.messages()[0]!.size).toBe(source.byteLength)
  })

  it('Scenario: Malformed headers', async () => {
    server.addMessage('INBOX', Buffer.from('X-Only: header\r\n\r\nbody'))
    await run()
    expect(store.messages()[0]).toMatchObject({
      messageId: null,
      date: null,
      fromAddress: null,
      subject: null,
    })
  })
})

describe('Requirement: Deduplication', () => {
  it('Scenario: Same raw source in two folders', async () => {
    const source = eml({ messageId: 'same@example' })
    server.addMessage('INBOX', source)
    server.addMessage('Spam', source)
    await run()
    expect(store.messages()).toHaveLength(1)
    expect(store.locations()).toHaveLength(2)
  })

  it('Scenario: Same Message-ID, different raw source', async () => {
    server.addMessage('INBOX', eml({ messageId: 'dup@example', body: 'first' }))
    server.addMessage('INBOX', eml({ messageId: 'dup@example', body: 'second' }))
    const summary = await run()
    expect(store.messages()).toHaveLength(2)
    expect(store.locations()).toHaveLength(2)
    expect(summary.messageIdsWithSeveralSources).toBe(1)
  })
})

describe('Requirement: Server mirror', () => {
  it('Scenario: Message removed on the server', async () => {
    const source = eml({ subject: 'deleted' })
    const uid = server.addMessage('INBOX', source)
    await run()
    server.removeMessage('INBOX', uid)
    const summary = await run()
    expect(summary.deletedMessages).toBe(1)
    expect(store.messages()).toHaveLength(0)
    expect(existsSync(rawPath(dataDir, sha256(source)))).toBe(false)
  })

  it('Scenario: Message moved between folders', async () => {
    const uid = server.addMessage('INBOX', eml({ subject: 'moved' }))
    await run()
    server.moveMessage('INBOX', uid, 'Spam')
    const summary = await run()
    expect(summary.deletedMessages).toBe(0)
    expect(store.messages()).toHaveLength(1)
    expect(store.locations().map(l => l.folder)).toEqual(['Spam'])
  })

  it('Scenario: Folder disappeared', async () => {
    server.addFolder('Old')
    server.addMessage('Old', eml({ subject: 'only in old' }))
    const shared = eml({ subject: 'shared' })
    server.addMessage('Old', shared)
    server.addMessage('INBOX', shared)
    await run()
    server.removeFolder('Old')
    const summary = await run()
    expect(summary.deletedMessages).toBe(1)
    expect(storedShas()).toEqual([
      sha256(shared),
    ])
    expect(store.locations().map(l => l.folder)).toEqual(['INBOX'])
  })

  it('Scenario: Folder disappeared (after an interrupted first sync of that folder)', async () => {
    server.addFolder('Old')
    server.addMessage('Old', eml({ subject: 'first' }))
    server.addMessage('Old', eml({ subject: 'second' }))
    server.loseConnectionAfterFetches = 1
    await run()
    expect(store.locationsOf('Old')).toHaveLength(1)

    server.loseConnectionAfterFetches = undefined
    server.removeFolder('Old')
    const summary = await run()
    expect(store.locationsOf('Old')).toEqual([])
    expect(summary.deletedMessages).toBe(1)
    expect(store.messages()).toEqual([])
  })

  it('Scenario: Folder listing fails', async () => {
    const inboxUid = server.addMessage('INBOX', eml({ subject: 'inbox' }))
    const spamUid = server.addMessage('Spam', eml({ subject: 'spam' }))
    await run()
    server.removeMessage('INBOX', inboxUid)
    server.removeMessage('Spam', spamUid)
    server.addMessage('Spam', eml({ subject: 'new spam' }))
    server.failingListings.add('INBOX')
    const summary = await run()
    expect(summary.errors).toEqual([
      expect.stringContaining('INBOX'),
    ])
    expect(store.locationsOf('INBOX')).toHaveLength(1)
    expect(summary.deletedMessages).toBe(0)
    expect(store.messages()).toHaveLength(3)
    expect(store.locationsOf('Spam')).toHaveLength(1)
  })

  it('Scenario: Connection lost during run', async () => {
    const uid = server.addMessage('INBOX', eml({ subject: 'removed later' }))
    await run()
    server.removeMessage('INBOX', uid)
    server.addMessage('Spam', eml({ subject: 'first' }))
    server.addMessage('Spam', eml({ subject: 'second' }))
    server.loseConnectionAfterFetches = 1
    const summary = await run()
    expect(summary.errors).toEqual([
      expect.stringContaining('connection lost'),
    ])
    expect(summary.deletedMessages).toBe(0)
    expect(store.messages()).toHaveLength(2)
  })
})

describe('Requirement: UIDVALIDITY change', () => {
  it('Scenario: Folder renumbered', async () => {
    server.addMessage('INBOX', eml({ subject: 'a' }))
    server.addMessage('INBOX', eml({ subject: 'b' }))
    await run()
    const before = storedShas()
    server.renumber('INBOX')
    const summary = await run()
    expect(summary.deletedMessages).toBe(0)
    expect(storedShas()).toEqual(before)
    expect(store.locationsOf('INBOX').map(l => [l.uidValidity, l.uid]).sort()).toEqual(
      server.folder('INBOX').messages.map(m => [2, m.uid]).sort(),
    )
  })

  it('Scenario: Renumbered folder, then nothing new', async () => {
    server.addMessage('INBOX', eml())
    await run()
    server.renumber('INBOX')
    await run()
    await run()
    expect(server.fetchedUids).toEqual([])
  })
})

describe('Requirement: Rebuildable store', () => {
  it('Scenario: Data directory deleted', async () => {
    server.addMessage('INBOX', eml({ subject: 'a' }))
    server.addMessage('Spam', eml({ subject: 'b' }))
    await run()
    const shas = storedShas()
    const locations = store.locations()
    store.close()
    rmSync(dataDir, { recursive: true, force: true })

    store = openStore(dataDir)
    await run()
    expect(storedShas()).toEqual(shas)
    expect(store.locations()).toEqual(locations)
    for (const folder of server.folders) {
      for (const message of folder.messages)
        expect(readFileSync(rawPath(dataDir, sha256(message.source)))).toEqual(Buffer.from(message.source))
    }
    expect(readdirSync(join(dataDir, 'raw')).filter(name => name !== '.tmp')).toHaveLength(2)
  })
})
