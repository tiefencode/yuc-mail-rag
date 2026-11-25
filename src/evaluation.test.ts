import type { EmlOptions } from './testing.ts'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runEval, runTestset } from './cli.ts'
import { formatMetrics, metrics, readTestSet, testsetPath } from './evaluation.ts'
import { sha256 } from './raw-files.ts'
import { eml, FakeMailSource, syncCache } from './testing.ts'

let dataDir: string
let fake: FakeMailSource

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-eval-'))
  fake = new FakeMailSource()
  fake.addFolder('INBOX')
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function cache(...messages: EmlOptions[]): Promise<string[]> {
  const shas = messages.map((message) => {
    const raw = eml(message)
    fake.addMessage('INBOX', raw)
    return sha256(raw)
  })
  await syncCache(dataDir, fake)
  return shas
}

async function testset(args: string[], raw: Record<string, string | boolean | undefined> = {}): Promise<{ code: number, output: string }> {
  const output: string[] = []
  const code = await runTestset(dataDir, args, raw, text => output.push(text))
  return {
    code,
    output: output.join('\n'),
  }
}

async function evaluate(): Promise<{ code: number, output: string }> {
  const output: string[] = []
  const code = await runEval(dataDir, text => output.push(text))
  return {
    code,
    output: output.join('\n'),
  }
}

const corpus: EmlOptions[] = [
  {
    messageId: 'a@x',
    from: 'max@band.com',
    subject: 'Trackliste Album',
    body: 'Die finale Trackliste fürs Album.',
  },
  {
    messageId: 'b@x',
    from: 'anna@label.de',
    subject: 'Layout',
    body: 'Layout und Trackliste kommen später.',
  },
  {
    messageId: 'c@x',
    from: 'shop@youngandcold.de',
    subject: 'Bestellung',
    body: 'Neue Bestellung eingegangen.',
  },
]

describe('Requirement: Record test entries', () => {
  it('Scenario: Add an entry', async () => {
    const [a] = await cache(...corpus)
    const { code, output } = await testset(['add'], {
      query: 'trackliste album',
      pick: a!.slice(0, 8),
      question: 'Welche Trackliste hat die Band geschickt?',
    })

    expect(code).toBe(0)
    expect(output).toBe('added entry 1')
    expect(readTestSet(dataDir).entries).toEqual([
      {
        id: 1,
        question: 'Welche Trackliste hat die Band geschickt?',
        query: 'trackliste album',
        expected: [a],
      },
    ])
  })

  it('accepts a pick from any message of a result thread', async () => {
    const [, reply] = await cache(
      { messageId: 'a@x', subject: 'Trackliste', body: 'Trackliste anbei.' },
      {
        messageId: 'r@x',
        references: ['a@x'],
        subject: 'Re: Trackliste',
        body: 'Danke.',
      },
    )
    expect((await testset(['add'], {
      query: 'trackliste',
      pick: reply!.slice(0, 8),
    })).code).toBe(0)
  })

  it('Scenario: Pick not among the results', async () => {
    const [, , c] = await cache(...corpus)
    const { code, output } = await testset(['add'], {
      query: 'trackliste',
      pick: c!.slice(0, 8),
    })
    expect(code).toBe(1)
    expect(output).toMatch(/not among the results/)
    expect(existsSync(testsetPath(dataDir))).toBe(false)
  })

  it('Scenario: Question omitted', async () => {
    const [a] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste album',
      pick: a!.slice(0, 8),
    })
    expect(readTestSet(dataDir).entries[0]!.question).toBe('trackliste album')
  })

  it('adds another expected message with expect', async () => {
    const [a, b] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste',
      pick: a!.slice(0, 8),
    })
    expect((await testset([
      'expect',
      '1',
      b!.slice(0, 8),
    ])).code).toBe(0)
    expect(readTestSet(dataDir).entries[0]!.expected).toEqual([a, b])

    expect((await testset([
      'expect',
      '7',
      b!.slice(0, 8),
    ])).code).toBe(1)
  })

  it('requires --query and --pick', async () => {
    await cache(...corpus)
    expect((await testset(['add'], { query: 'x' })).code).toBe(1)
    expect((await testset(['add'], { pick: 'abcd' })).code).toBe(1)
  })

  it('writes the test set as JSON in the data directory', async () => {
    const [a] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste',
      pick: a!.slice(0, 8),
    })
    expect(JSON.parse(readFileSync(join(dataDir, 'testset.json'), 'utf8'))).toMatchObject({ nextId: 2 })
  })
})

describe('Requirement: Maintain the test set', () => {
  it('lists entries with id, question, query and expected references', async () => {
    const [a] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste',
      pick: a!.slice(0, 8),
      question: 'Wo ist die Liste?',
    })
    const { code, output } = await testset(['list'])
    expect(code).toBe(0)
    expect(output).toBe(`1  Wo ist die Liste?\n   query: trackliste\n   expected: ${a!.slice(0, 8)}`)
  })

  it('Scenario: Remove an entry', async () => {
    const [a, b] = await cache(...corpus)
    for (let i = 0; i < 3; i++) {
      await testset(['add'], {
        query: 'trackliste',
        pick: a!.slice(0, 8),
      })
    }
    expect((await testset(['remove', '3'])).code).toBe(0)
    await testset(['add'], {
      query: 'layout',
      pick: b!.slice(0, 8),
    })
    expect(readTestSet(dataDir).entries.map(entry => entry.id)).toEqual([1, 2, 4])

    expect((await testset(['remove', '3'])).code).toBe(1)
  })
})

describe('Requirement: Evaluation', () => {
  it('Scenario: Metrics', () => {
    expect(metrics([1, 3, 12, null])).toEqual({
      entries: 4,
      hit1: 0.25,
      hit5: 0.5,
      hit10: 0.5,
      mrr: (1 + 1 / 3 + 1 / 12) / 4,
    })
  })

  it('prints metrics rounded to two decimals and one rank per entry', async () => {
    const [a, b] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste',
      pick: a!.slice(0, 8),
    })
    await testset(['add'], {
      query: 'trackliste',
      pick: b!.slice(0, 8),
    })
    const { code, output } = await evaluate()
    expect(code).toBe(0)
    expect(output).toBe([
      'entries: 2',
      'hit@1: 0.50',
      'hit@5: 1.00',
      'hit@10: 1.00',
      'MRR: 0.75',
      'gone: 0',
      '',
      '1  1',
      '2  2',
    ].join('\n'))
  })

  it('ranks an entry - when no expected thread is among the first 20', async () => {
    const [a] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste',
      pick: a!.slice(0, 8),
    })
    const set = JSON.parse(readFileSync(testsetPath(dataDir), 'utf8'))
    set.entries[0].query = 'bestellung'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(testsetPath(dataDir), JSON.stringify(set))
    expect((await evaluate()).output).toContain('\n1  -')
  })

  it('Scenario: Expected message gone', async () => {
    const [a] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste',
      pick: a!.slice(0, 8),
    })
    fake.removeMessage('INBOX', 1)
    await syncCache(dataDir, fake)
    const { output } = await evaluate()
    expect(output).toContain('hit@1: 0.00')
    expect(output).toContain('gone: 1')
    expect(output).toContain('\n1  gone')
  })

  it('prints the scenario metrics rounded to two decimals', () => {
    expect(formatMetrics(metrics([1, 3, 12, null]))).toEqual([
      'entries: 4',
      'hit@1: 0.25',
      'hit@5: 0.50',
      'hit@10: 0.50',
      'MRR: 0.35',
    ])
  })

  it('treats a test set with an empty entry list as empty', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(testsetPath(dataDir), JSON.stringify({ nextId: 4, entries: [] }))
    const { code, output } = await evaluate()
    expect(code).toBe(0)
    expect(output.split('\n')[0]).toBe('entries: 0')
  })

  it('Scenario: Empty test set', async () => {
    const { code, output } = await evaluate()
    expect(code).toBe(0)
    expect(output.split('\n')[0]).toBe('entries: 0')
  })

  it('Scenario: Content-free output', async () => {
    const [a, b] = await cache(...corpus)
    await testset(['add'], {
      query: 'trackliste album',
      pick: a!.slice(0, 8),
      question: 'Welche Trackliste?',
    })
    await testset(['add'], {
      query: 'layout',
      pick: b!.slice(0, 8),
    })
    const { output } = await evaluate()
    for (const line of output.split('\n'))
      expect(line).toMatch(/^(?:(?:entries|hit@\d+|MRR|gone): \d+(?:\.\d+)?|\d+ {2}(?:\d+|-|gone))?$/)
    for (const secret of [
      'trackliste',
      'Trackliste',
      'layout',
      'max@band.com',
      'finale',
      a!.slice(0, 8),
    ])
      expect(output).not.toContain(secret)
  })
})
