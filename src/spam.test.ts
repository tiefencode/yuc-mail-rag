import type { EmlOptions } from './testing.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSpamCheck } from './cli.ts'
import { openIndex, updateIndex } from './search-index.ts'
import { isFreeMailDomain } from './spam.ts'
import { eml, FakeMailSource, syncCache } from './testing.ts'

let dataDir: string
let fake: FakeMailSource
let counter: number

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-spam-'))
  fake = new FakeMailSource()
  fake.addFolder('INBOX')
  fake.addFolder('INBOX.Spam')
  counter = 0
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function add(folder: string, message: EmlOptions): number {
  return fake.addMessage(folder, eml({ messageId: `m${counter++}@x`, ...message }))
}

async function suspects(): Promise<{ count: number, rows: { subject: string, signals: string }[] }> {
  await syncCache(dataDir, fake)
  const { spamSuspects } = await updateIndex(dataDir)
  const db = openIndex(dataDir)
  const rows = db.prepare('SELECT subject, signals FROM spam_suspects ORDER BY subject').all() as { subject: string, signals: string }[]
  db.close()
  return { count: spamSuspects, rows }
}

async function check(): Promise<{ code: number, output: string }> {
  await syncCache(dataDir, fake)
  const output: string[] = []
  const code = await runSpamCheck(dataDir, text => output.push(text))
  return {
    code,
    output: output.join('\n'),
  }
}

describe('Requirement: Suspect signals', () => {
  it('gives a reply signal for a reply to an indexed notification', async () => {
    add('INBOX', { messageId: 'order@bandcamp.com', from: 'noreply@bandcamp.com', subject: 'New order' })
    add('INBOX.Spam', { from: 'buyer@other.org', subject: 'Frage zur Bestellung', inReplyTo: 'order@bandcamp.com' })
    expect((await suspects()).rows).toEqual([
      { subject: 'Frage zur Bestellung', signals: 'reply' },
    ])
  })

  it('Scenario: Reply to a known thread', async () => {
    add('INBOX', { messageId: 'a@band.com', from: 'max@band.com', subject: 'Trackliste' })
    add('INBOX.Spam', { from: 'new@other.org', subject: 'Antwort', inReplyTo: 'a@band.com' })
    expect((await suspects()).rows).toEqual([
      { subject: 'Antwort', signals: 'reply' },
    ])
  })

  it('catches a reply that references an own sent message known from a reply', async () => {
    add('INBOX', {
      messageId: 'b@band.com',
      from: 'max@band.com',
      subject: 'Re: Trackliste',
      references: ['sent@label.de'],
    })
    add('INBOX.Spam', {
      from: 'new@other.org',
      subject: 'x',
      references: ['sent@label.de'],
    })
    expect((await suspects()).rows).toEqual([
      { subject: 'x', signals: 'reply' },
    ])
  })

  it('Scenario: Known sender', async () => {
    add('INBOX', { from: 'max@band.com', subject: 'Trackliste' })
    add('INBOX.Spam', { from: 'Max@Band.com', subject: 'Neues Album' })
    expect((await suspects()).rows).toEqual([
      { subject: 'Neues Album', signals: 'sender, domain' },
    ])
  })

  it('Scenario: Known organization domain', async () => {
    add('INBOX', { from: 'sebastian@audioglobe.it', subject: 'Statement' })
    add('INBOX.Spam', { from: 'accounting@audioglobe.it', subject: 'Rechnung' })
    expect((await suspects()).rows).toEqual([
      { subject: 'Rechnung', signals: 'domain' },
    ])
  })

  it('Scenario: Free-mail domain alone', async () => {
    add('INBOX', { from: 'band@gmail.com', subject: 'Demo' })
    add('INBOX.Spam', { from: 'promoter@gmail.com', subject: 'Promo' })
    expect((await suspects()).rows).toEqual([])
  })

  it('Scenario: Known sender of notifications only', async () => {
    add('INBOX', { from: 'noreply@bandcamp.com', subject: 'Order' })
    add('INBOX.Spam', { from: 'noreply@bandcamp.com', subject: 'Sale' })
    expect((await suspects()).rows).toEqual([])
  })

  it('gives a subject signal for a known correspondence subject', async () => {
    add('INBOX', { from: 'max@band.com', subject: 'Trackliste Album' })
    add('INBOX.Spam', { from: 'other@web.de', subject: 'AW: Trackliste Album' })
    expect((await suspects()).rows).toEqual([
      { subject: 'AW: Trackliste Album', signals: 'subject' },
    ])
  })

  it('Scenario: Unknown spam', async () => {
    add('INBOX', { from: 'max@band.com', subject: 'Trackliste' })
    add('INBOX.Spam', { from: 'seo@spam.example', subject: 'Rank #1 on Google' })
    expect((await suspects()).rows).toEqual([])
  })

  it('does not index spam message bodies', async () => {
    add('INBOX.Spam', { from: 'seo@spam.example', subject: 'x', body: 'geheimwort' })
    await suspects()
    const db = openIndex(dataDir)
    expect(db.prepare('SELECT COUNT(*) FROM fts WHERE fts MATCH \'geheimwort\'').pluck().get()).toBe(0)
    db.close()
  })
})

describe('Requirement: Free-mail domains give no domain signal', () => {
  it('Scenario: Free-mail provider', async () => {
    add('INBOX', { from: 'band@web.de', subject: 'Demo' })
    add('INBOX.Spam', { from: 'new@web.de', subject: 'Hallo' })
    expect((await suspects()).rows).toEqual([])
  })

  it('lists providers and provider families', () => {
    for (const domain of [
      'gmail.com',
      'googlemail.com',
      'gmx.net',
      't-online.de',
      'hotmail.it',
      'hotmail.be',
      'yahoo.co.uk',
      'yandex.ru',
      'proton.me',
    ])
      expect(isFreeMailDomain(domain), domain).toBe(true)
    expect(isFreeMailDomain('audioglobe.it')).toBe(false)
    expect(isFreeMailDomain('nothotmail.com')).toBe(false)
  })
})

describe('Requirement: Suspect count', () => {
  it('Scenario: Count after an update', async () => {
    add('INBOX', { from: 'max@band.com', subject: 'Trackliste' })
    add('INBOX.Spam', { from: 'max@band.com', subject: 'Eins' })
    add('INBOX.Spam', { from: 'max@band.com', subject: 'Zwei' })
    add('INBOX.Spam', { from: 'seo@spam.example', subject: 'Drei' })
    expect((await suspects()).count).toBe(2)
  })

  it('Scenario: Rescued message', async () => {
    add('INBOX', { from: 'max@band.com', subject: 'Trackliste' })
    const uid = add('INBOX.Spam', { from: 'max@band.com', subject: 'Gerettet' })
    expect((await suspects()).count).toBe(1)

    fake.moveMessage('INBOX.Spam', uid, 'INBOX')
    const after = await suspects()
    expect(after.count).toBe(0)
    const db = openIndex(dataDir)
    expect(db.prepare('SELECT COUNT(*) FROM messages WHERE subject = \'Gerettet\'').pluck().get()).toBe(1)
    db.close()
  })
})

describe('Requirement: Spam check command', () => {
  it('Scenario: List suspects', async () => {
    add('INBOX', { messageId: 'a@band.com', from: 'max@band.com', subject: 'Trackliste' })
    add('INBOX.Spam', { from: 'max@band.com', subject: 'Älter', date: 'Mon, 03 Mar 2025 10:00:00 +0000' })
    add('INBOX.Spam', {
      from: 'x@other.org',
      subject: 'Neuer',
      date: 'Thu, 20 Mar 2025 10:00:00 +0000',
      inReplyTo: 'a@band.com',
    })
    const { code, output } = await check()

    expect(code).toBe(0)
    const lines = output.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^[0-9a-f]{8} {2}2025-03-20 {2}x@other\.org {2}INBOX\.Spam {2}reply {2}Neuer$/)
    expect(lines[1]).toMatch(/^[0-9a-f]{8} {2}2025-03-03 {2}max@band\.com {2}INBOX\.Spam {2}sender, domain {2}Älter$/)
  })

  it('Scenario: No suspects', async () => {
    add('INBOX.Spam', { from: 'seo@spam.example', subject: 'x' })
    const { code, output } = await check()
    expect(code).toBe(0)
    expect(output).toBe('no spam suspects')
  })

  it('changes nothing on the server', async () => {
    add('INBOX', { from: 'max@band.com', subject: 'Trackliste' })
    add('INBOX.Spam', { from: 'max@band.com', subject: 'Eins' })
    fake.calls = []
    await check()
    expect(fake.calls.filter(call => !/^(?:listFolders|openFolder|listUids|fetchSources|close)/.test(call))).toEqual([])
  })
})
