import type Database from 'better-sqlite3'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { UsageError } from './errors.ts'
import { DEFAULT_LIMIT, parseSearchOptions, search } from './search.ts'
import { resolveReference } from './show.ts'

export interface TestEntry {
  id: number
  question: string
  query: string
  /** SHA-256 of the expected messages. */
  expected: string[]
}

export interface TestSet {
  nextId: number
  entries: TestEntry[]
}

export interface Metrics {
  entries: number
  hit1: number
  hit5: number
  hit10: number
  mrr: number
}

/** The test set lives in the data directory, which git never tracks. */
export function testsetPath(dataDir: string): string {
  return join(dataDir, 'testset.json')
}

export function readTestSet(dataDir: string): TestSet {
  if (!existsSync(testsetPath(dataDir)))
    return { nextId: 1, entries: [] }
  return JSON.parse(readFileSync(testsetPath(dataDir), 'utf8')) as TestSet
}

function writeTestSet(dataDir: string, set: TestSet): void {
  const temp = `${testsetPath(dataDir)}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(set, null, 2)}\n`)
  renameSync(temp, testsetPath(dataDir))
}

function threadOf(db: Database.Database, sha: string): string | undefined {
  return db.prepare('SELECT thread FROM messages WHERE sha = ?').pluck().get(sha) as string | undefined
}

export function addEntry(db: Database.Database, dataDir: string, query: string | undefined, pick: string | undefined, question: string | undefined): number {
  if (!query?.trim() || !pick?.trim())
    throw new UsageError('testset add needs --query <words> and --pick <reference>')
  const sha = resolveReference(db, pick)
  const thread = threadOf(db, sha)
  const results = search(db, query, parseSearchOptions({}))
  if (!results.some(result => result.thread === thread))
    throw new UsageError(`reference ${pick} is not among the results for this query`)

  const set = readTestSet(dataDir)
  const id = set.nextId
  set.entries.push({
    id,
    question: question?.trim() || query.trim(),
    query: query.trim(),
    expected: [sha],
  })
  set.nextId = id + 1
  writeTestSet(dataDir, set)
  return id
}

function entryById(set: TestSet, id: string | undefined): TestEntry {
  const entry = set.entries.find(e => String(e.id) === id)
  if (!entry)
    throw new UsageError(`no test entry with id ${id ?? '(none)'}`)
  return entry
}

export function expectMessage(db: Database.Database, dataDir: string, id: string | undefined, reference: string | undefined): void {
  const set = readTestSet(dataDir)
  const entry = entryById(set, id)
  const sha = resolveReference(db, reference ?? '')
  if (!entry.expected.includes(sha))
    entry.expected.push(sha)
  writeTestSet(dataDir, set)
}

export function removeEntry(dataDir: string, id: string | undefined): void {
  const set = readTestSet(dataDir)
  const entry = entryById(set, id)
  set.entries = set.entries.filter(e => e !== entry)
  writeTestSet(dataDir, set)
}

export function formatEntries(dataDir: string): string {
  const { entries } = readTestSet(dataDir)
  if (entries.length === 0)
    return 'no test entries'
  return entries.map((entry) => {
    const indent = ' '.repeat(String(entry.id).length + 2)
    return [
      `${entry.id}  ${entry.question}`,
      `${indent}query: ${entry.query}`,
      `${indent}expected: ${entry.expected.map(sha => sha.slice(0, 8)).join(', ')}`,
    ].join('\n')
  }).join('\n')
}

/** Hit rates and mean reciprocal rank; `null` is an entry without a hit among the results. */
export function metrics(ranks: (number | null)[]): Metrics {
  const share = (limit: number): number => ranks.length === 0
    ? 0
    : ranks.filter(rank => rank !== null && rank <= limit).length / ranks.length
  return {
    entries: ranks.length,
    hit1: share(1),
    hit5: share(5),
    hit10: share(10),
    mrr: ranks.length === 0
      ? 0
      : ranks.reduce<number>((sum, rank) => sum + (rank === null
        ? 0
        : 1 / rank), 0) / ranks.length,
  }
}

/** One line per metric, rounded to two decimals. */
export function formatMetrics(result: Metrics): string[] {
  return [
    `entries: ${result.entries}`,
    `hit@1: ${result.hit1.toFixed(2)}`,
    `hit@5: ${result.hit5.toFixed(2)}`,
    `hit@10: ${result.hit10.toFixed(2)}`,
    `MRR: ${result.mrr.toFixed(2)}`,
  ]
}

type Rank = number | '-' | 'gone'

/** Rank of each entry: the position of the first result thread that holds an expected message. */
export function rankEntries(db: Database.Database, set: TestSet): { id: number, rank: Rank }[] {
  return set.entries.map((entry) => {
    const threads = new Set(entry.expected.map(sha => threadOf(db, sha)).filter(thread => thread !== undefined))
    if (threads.size === 0)
      return { id: entry.id, rank: 'gone' }
    let results: { thread: string }[]
    try {
      results = search(db, entry.query, { limit: DEFAULT_LIMIT })
    }
    catch (error) {
      if (error instanceof UsageError)
        return { id: entry.id, rank: '-' }
      throw error
    }
    const position = results.findIndex(result => threads.has(result.thread))
    return {
      id: entry.id,
      rank: position === -1
        ? '-'
        : position + 1,
    }
  })
}

/** Metrics and ranks per entry id; no question, query or mail content. */
export function formatEval(db: Database.Database, dataDir: string): string {
  const ranked = rankEntries(db, readTestSet(dataDir))
  const ranks = ranked.map(({ rank }) => typeof rank === 'number'
    ? rank
    : null)
  return [
    ...formatMetrics(metrics(ranks)),
    `gone: ${ranked.filter(({ rank }) => rank === 'gone').length}`,
    ...(ranked.length > 0
      ? ['']
      : []),
    ...ranked.map(({ id, rank }) => `${id}  ${rank}`),
  ].join('\n')
}
