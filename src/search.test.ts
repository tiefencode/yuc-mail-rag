import type { EmlOptions } from './testing.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSearch } from './cli.ts'
import { UsageError } from './errors.ts'
import { openIndex, updateIndex } from './search-index.ts'
import { parseSearchOptions, search } from './search.ts'
import { eml, FakeMailSource, syncCache } from './testing.ts'

let dataDir: string
let counter: number

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-search-'))
  counter = 0
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function cache(...messages: EmlOptions[]): Promise<void> {
  const fake = new FakeMailSource()
  fake.addFolder('INBOX')
  for (const message of messages)
    fake.addMessage('INBOX', eml({ messageId: `m${counter++}@x`, ...message }))
  await syncCache(dataDir, fake)
  await updateIndex(dataDir)
}

function find(query: string, raw: Record<string, string | boolean | undefined> = {}): { subject: string | null, category: string, threadSize: number }[] {
  const db = openIndex(dataDir)
  try {
    return search(db, query, parseSearchOptions(raw))
  }
  finally {
    db.close()
  }
}

function subjects(query: string, raw: Record<string, string | boolean | undefined> = {}): (string | null)[] {
  return find(query, raw).map(result => result.subject)
}

async function cli(query: string[], raw: Record<string, string | boolean | undefined> = {}): Promise<{ code: number, output: string }> {
  const output: string[] = []
  const code = await runSearch(dataDir, query, raw, text => output.push(text))
  return {
    code,
    output: output.join('\n'),
  }
}

describe('Requirement: Quoted text and signatures', () => {
  it('Scenario: Match only in a quote', async () => {
    await cache(
      { subject: 'B', from: 'b@band.com', body: 'Danke, bis bald.\n\nAm 3.3.2025 schrieb Label <l@x>:\n> Die Trackliste kommt morgen.' },
      { subject: 'A', from: 'a@band.com', body: 'Die Trackliste kommt morgen.\n\nDanke, bis bald.' },
    )
    expect(subjects('trackliste')).toEqual(['A', 'B'])
  })
})

describe('Requirement: Attachment names searchable', () => {
  it('Scenario: Search by file name', async () => {
    await cache({
      subject: 'Anbei',
      body: 'siehe Anhang',
      attachments: [
        { name: 'Trackliste_final.pdf', type: 'application/pdf' },
      ],
    })
    expect(subjects('Trackliste')).toEqual(['Anbei'])
  })

  it('Scenario: Attachment content', async () => {
    await cache({
      subject: 'Anbei',
      body: 'siehe Anhang',
      attachments: [
        { name: 'notes.txt', type: 'text/plain', content: 'geheimwort' },
      ],
    })
    expect(subjects('geheimwort')).toEqual([])
  })
})

describe('Requirement: Body text extraction', () => {
  it('Scenario: HTML-only message', async () => {
    await cache({ subject: 'Html', body: null, html: '<p>Die <b>Pressemappe</b> f&uuml;r Caf&eacute;s</p>' })
    expect(subjects('Pressemappe')).toEqual(['Html'])
    expect(subjects('für')).toEqual(['Html'])
    expect(subjects('Cafés')).toEqual(['Html'])
  })
})

describe('Requirement: Ranking', () => {
  it('Scenario: Correspondence before notification', async () => {
    await cache(
      { subject: 'Bestellung', from: 'noreply@bandcamp.com', body: 'Ihre Vinyl Bestellung ist eingegangen.' },
      { subject: 'Frage', from: 'max@band.com', body: 'Unsere Vinyl Bestellung ist eingegangen.' },
    )
    expect(find('vinyl').map(result => [result.subject, result.category])).toEqual([
      ['Frage', 'correspondence'],
      ['Bestellung', 'notification'],
    ])
  })

  it('Scenario: One result per thread', async () => {
    await cache(
      { messageId: 't0@x', subject: 'Layout', body: 'Layout Entwurf eins' },
      {
        references: ['t0@x'],
        subject: 'Re: Layout',
        body: 'Layout Entwurf zwei',
      },
      {
        references: ['t0@x'],
        subject: 'Re: Layout',
        body: 'Layout Entwurf drei',
      },
      {
        references: ['t0@x'],
        subject: 'Re: Layout',
        body: 'Layout Layout Layout final',
      },
      {
        references: ['t0@x'],
        subject: 'Re: Layout',
        body: 'Layout Entwurf vier',
      },
      { subject: 'Anderes', body: 'nichts davon' },
    )
    const results = find('layout')
    expect(results).toHaveLength(1)
    expect(results[0]!.threadSize).toBe(5)
  })
})

describe('Requirement: Search command', () => {
  it('prints reference, date, sender, subject, category, thread size and range, and a snippet', async () => {
    await cache(
      {
        messageId: 'a@x',
        from: 'max@band.com',
        subject: 'Trackliste',
        date: 'Mon, 03 Mar 2025 10:00:00 +0000',
        body: 'Die finale Trackliste kommt morgen.',
      },
      {
        references: ['a@x'],
        from: 'max@band.com',
        subject: 'Re: Trackliste',
        date: 'Thu, 20 Mar 2025 10:00:00 +0000',
        body: 'Noch nicht.',
      },
    )
    const { code, output } = await cli(['trackliste'])
    expect(code).toBe(0)
    expect(output).toMatch(/^ 1 {2}[0-9a-f]{8} {2}2025-03-03 {2}max@band\.com {2}correspondence {2}2 msgs 2025-03-03\.\.2025-03-20$/m)
    expect(output).toContain('Trackliste')
    expect(output).toContain('finale [Trackliste] kommt')
  })

  it('Scenario: No match', async () => {
    await cache({ subject: 'Hallo', body: 'nichts' })
    const { code, output } = await cli(['trackliste'])
    expect(code).toBe(0)
    expect(output).toBe('no matches')
  })

  it('Scenario: Diacritics', async () => {
    await cache({ subject: 'Kontakt', body: 'Grüße von Herrn Müller' })
    expect(subjects('muller')).toEqual(['Kontakt'])
    expect(subjects('MÜLLER')).toEqual(['Kontakt'])
  })

  it('Scenario: Prefix', async () => {
    await cache({ subject: 'Vertrag', body: 'Der Vertriebsvertrag liegt bei.' })
    expect(subjects('vertrieb*')).toEqual(['Vertrag'])
    expect(subjects('vertrieb')).toEqual([])
  })

  it('Scenario: Barcode', async () => {
    await cache({ subject: 'EAN', body: 'Barcode: 4260123456789' })
    expect(subjects('4260123456789')).toEqual(['EAN'])
  })

  it('matches a quoted phrase as phrase', async () => {
    await cache(
      { subject: 'Phrase', body: 'das final mix ist da' },
      { subject: 'Getrennt', body: 'mix ist nicht final' },
    )
    expect(subjects('"final mix"')).toEqual(['Phrase'])
    expect(subjects('final mix').sort()).toEqual(['Getrennt', 'Phrase'])
  })

  it('accepts addresses and punctuation in the query', async () => {
    await cache({ subject: 'Adresse', body: 'schreib an booking@band-name.com (bitte!)' })
    expect(subjects('booking@band-name.com')).toEqual(['Adresse'])
    expect(subjects('(bitte!)')).toEqual(['Adresse'])
  })

  it('finds messages by subject and sender address', async () => {
    await cache({ subject: 'Mastering Termin', from: 'studio@akustik.de', body: 'siehe Betreff' })
    expect(subjects('mastering')).toEqual(['Mastering Termin'])
    expect(subjects('akustik')).toEqual(['Mastering Termin'])
  })

  it('limits the results to 20 unless --limit is given', async () => {
    await cache(...Array.from({ length: 25 }, (_, i) => ({ subject: `Promo ${i}`, from: `p${i}@band.com`, body: 'Promo' })))
    expect(find('promo')).toHaveLength(20)
    expect(find('promo', { limit: '3' })).toHaveLength(3)
  })

  it('rejects an empty query', async () => {
    await cache({ subject: 'x' })
    const { code, output } = await cli([])
    expect(code).toBe(1)
    expect(output).toMatch(/query/)
  })
})

describe('Requirement: Search filters', () => {
  it('Scenario: Domain filter', async () => {
    await cache(
      { subject: 'Audioglobe', from: 'sebastian@audioglobe.it', body: 'vertrag' },
      { subject: 'Statement', from: 'statement@mail.audioglobe.it', body: 'vertrag' },
      { subject: 'Andere', from: 'max@band.com', body: 'vertrag' },
    )
    expect(subjects('vertrag', { from: 'audioglobe.it' }).sort()).toEqual(['Audioglobe', 'Statement'])
    expect(subjects('vertrag', { from: 'Max@Band.com' })).toEqual(['Andere'])
  })

  it('Scenario: Period filter', async () => {
    await cache(
      { subject: 'Alt', date: 'Sun, 31 Dec 2023 23:00:00 +0000', body: 'vertrag' },
      { subject: 'Anfang', date: 'Mon, 01 Jan 2024 00:00:00 +0000', body: 'vertrag' },
      { subject: 'Ende', date: 'Sun, 30 Jun 2024 23:59:00 +0000', body: 'vertrag' },
      { subject: 'Danach', date: 'Mon, 01 Jul 2024 00:00:00 +0000', body: 'vertrag' },
    )
    expect(subjects('vertrag', { since: '2024', until: '2024-06' }).sort()).toEqual(['Anfang', 'Ende'])
    expect(subjects('vertrag', { until: '2023-12-31' })).toEqual(['Alt'])
  })

  it('Scenario: Attachment filter', async () => {
    await cache(
      {
        subject: 'Pdf',
        body: 'layout',
        attachments: [
          { name: 'Layout.PDF', type: 'application/pdf' },
        ],
      },
      {
        subject: 'Bild',
        body: 'layout',
        attachments: [
          { name: 'layout.jpg', type: 'image/jpeg' },
        ],
      },
      { subject: 'Ohne', body: 'layout' },
    )
    expect(subjects('layout', { attachment: 'pdf' })).toEqual(['Pdf'])
    expect(subjects('layout', { attachment: true }).sort()).toEqual(['Bild', 'Pdf'])
  })

  it('filters by category', async () => {
    await cache(
      { subject: 'Shop', from: 'shop@youngandcold.de', body: 'vinyl' },
      { subject: 'Band', from: 'max@band.com', body: 'vinyl' },
    )
    expect(subjects('vinyl', { category: 'notification' })).toEqual(['Shop'])
  })

  it('Scenario: Invalid filter value', () => {
    expect(() => parseSearchOptions({ since: '2024-13' })).toThrow(UsageError)
    expect(() => parseSearchOptions({ since: '2024-13' })).toThrow(/2024-13/)
    expect(() => parseSearchOptions({ until: '2024-02-30' })).toThrow(/2024-02-30/)
    expect(() => parseSearchOptions({ category: 'foo' })).toThrow(/foo/)
    expect(() => parseSearchOptions({ limit: '0' })).toThrow(/0/)
  })

  it('exits non-zero on an invalid filter value', async () => {
    await cache({ subject: 'x' })
    const { code, output } = await cli(['x'], { category: 'foo' })
    expect(code).toBe(1)
    expect(output).toContain('foo')
  })
})
