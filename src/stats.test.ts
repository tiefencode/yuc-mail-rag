import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatStats, readStats } from './stats.ts'
import { openStore } from './store.ts'
import { sync } from './sync.ts'
import { eml, FakeMailSource } from './testing.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-stats-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function syncFrom(server: FakeMailSource): Promise<void> {
  const store = openStore(dataDir)
  await sync(server, store, dataDir)
  store.close()
}

describe('Requirement: Storage statistics', () => {
  it('Scenario: Stats per sender', async () => {
    const server = new FakeMailSource()
    server.addFolder('INBOX')
    server.addFolder('Spam')
    const big = eml({
      from: 'shop@example.de',
      body: 'x'.repeat(500),
    })
    server.addMessage('INBOX', big)
    server.addMessage('Spam', big)
    server.addMessage('INBOX', eml({
      from: 'shop@example.de',
      body: 'y'.repeat(500),
    }))
    const tieA = eml({ from: 'a@example.com' })
    const tieB = eml({ from: 'b@example.com' })
    server.addMessage('INBOX', tieB)
    server.addMessage('INBOX', tieA)
    await syncFrom(server)

    const stats = readStats(dataDir)
    expect(stats.count).toBe(4)
    expect(stats.bytes).toBe(stats.senders.reduce((sum, s) => sum + s.bytes, 0))
    expect(stats.senders.map(s => [s.sender, s.count])).toEqual([
      ['shop@example.de', 2],
      ['a@example.com', 1],
      ['b@example.com', 1],
    ])
    expect(stats.senders[1]!.bytes).toBe(tieA.byteLength)
  })

  it('Scenario: Sender address case', async () => {
    const server = new FakeMailSource()
    server.addFolder('INBOX')
    server.addMessage('INBOX', eml({ from: 'Shop@Example.DE', body: '1' }))
    server.addMessage('INBOX', eml({ from: 'shop@example.de', body: '2' }))
    await syncFrom(server)
    expect(readStats(dataDir).senders.map(s => [s.sender, s.count])).toEqual([
      ['shop@example.de', 2],
    ])
  })

  it('Scenario: Message without sender', async () => {
    const server = new FakeMailSource()
    server.addFolder('INBOX')
    server.addMessage('INBOX', eml({ subject: 'no from' }))
    await syncFrom(server)
    expect(readStats(dataDir).senders.map(s => s.sender)).toEqual(['(unknown)'])
  })

  it('Scenario: Empty store', () => {
    expect(readStats(join(dataDir, 'missing'))).toEqual({
      count: 0,
      bytes: 0,
      senders: [],
      disk: { total: 0, raw: 0, database: 0 },
    })
    openStore(dataDir).close()
    const stats = readStats(dataDir)
    expect(stats).toMatchObject({ count: 0, bytes: 0, senders: [] })
    expect(stats.disk.raw).toBe(0)
    expect(formatStats(stats)).toContain('messages: 0 · 0 B')
  })

  it('Scenario: Disk usage', async () => {
    const server = new FakeMailSource()
    server.addFolder('INBOX')
    server.addMessage('INBOX', eml({
      from: 'a@example.com',
      body: 'x'.repeat(9000),
    }))
    server.addMessage('INBOX', eml({ from: 'b@example.com', body: 'y' }))
    await syncFrom(server)
    writeFileSync(join(dataDir, 'other.txt'), 'z'.repeat(5000))

    const { bytes, disk } = readStats(dataDir)
    expect(disk.raw).toBeGreaterThanOrEqual(bytes)
    expect(disk.raw % 512).toBe(0)
    expect(disk.database).toBeGreaterThan(0)
    expect(disk.total).toBeGreaterThanOrEqual(disk.raw + disk.database + 5000)
    expect(formatStats(readStats(dataDir))).toMatch(/^disk: .+ \(raw .+ · database .+\)$/m)
  })
})
