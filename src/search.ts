import type Database from 'better-sqlite3'
import type { Category } from './categories.ts'
import { CATEGORIES } from './categories.ts'
import { UsageError } from './errors.ts'

/** BM25 weights of the FTS columns header, own, attachments, secondary (quoted text and signature). */
const COLUMN_WEIGHTS = [1.0, 1.0, 1.0, 0.3]
/** Multiplier on the (negative) BM25 score; a smaller factor ranks lower. */
const CATEGORY_FACTOR: Record<Category, number> = {
  correspondence: 1.0,
  notification: 0.5,
  bounce: 0.5,
}
export const DEFAULT_LIMIT = 20

export interface SearchOptions {
  limit: number
  from?: string
  /** Inclusive lower bound, ISO timestamp. */
  since?: string
  /** Exclusive upper bound, ISO timestamp. */
  until?: string
  category?: Category
  /** `true` for any attachment, a string for one extension. */
  attachment?: true | string
}

export type RawSearchOptions = Record<string, string | boolean | undefined>

export interface SearchResult {
  sha: string
  reference: string
  date: string | null
  fromAddress: string | null
  subject: string | null
  category: Category
  thread: string
  threadSize: number
  threadFirst: string | null
  threadLast: string | null
  snippet: string
  score: number
}

export function parseSearchOptions(raw: RawSearchOptions): SearchOptions {
  const options: SearchOptions = { limit: DEFAULT_LIMIT }
  if (raw.limit !== undefined) {
    const limit = Number(raw.limit)
    if (!Number.isInteger(limit) || limit < 1)
      throw new UsageError(`invalid --limit: ${raw.limit}`)
    options.limit = limit
  }
  if (typeof raw.from === 'string' && raw.from.trim())
    options.from = raw.from.trim().toLowerCase()
  if (typeof raw.since === 'string')
    options.since = periodStart(raw.since, '--since')
  if (typeof raw.until === 'string')
    options.until = periodEnd(raw.until, '--until')
  if (raw.category !== undefined) {
    if (!CATEGORIES.includes(raw.category as Category))
      throw new UsageError(`invalid --category: ${raw.category} (one of ${CATEGORIES.join(', ')})`)
    options.category = raw.category as Category
  }
  if (raw.attachment === true || raw.attachment === '')
    options.attachment = true
  else if (typeof raw.attachment === 'string')
    options.attachment = raw.attachment.replace(/^\./, '').toLowerCase()
  return options
}

interface Period {
  year: number
  month?: number
  day?: number
}

function parsePeriod(value: string, flag: string): Period {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
  const [year, month, day] = [match?.[1], match?.[2], match?.[3]].map(part => part === undefined
    ? undefined
    : Number(part))
  const valid = match !== null
    && (month === undefined || (month >= 1 && month <= 12))
    && (day === undefined || new Date(Date.UTC(year!, month! - 1, day)).getUTCDate() === day)
  if (!valid)
    throw new UsageError(`invalid ${flag}: ${value} (expected YYYY, YYYY-MM or YYYY-MM-DD)`)
  return { year: year!, month, day }
}

function periodStart(value: string, flag: string): string {
  const { year, month, day } = parsePeriod(value, flag)
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)).toISOString()
}

/** The first instant after the whole period, so `--until 2024-06` includes June 30. */
function periodEnd(value: string, flag: string): string {
  const { year, month, day } = parsePeriod(value, flag)
  if (day !== undefined)
    return new Date(Date.UTC(year, month! - 1, day + 1)).toISOString()
  if (month !== undefined)
    return new Date(Date.UTC(year, month, 1)).toISOString()
  return new Date(Date.UTC(year + 1, 0, 1)).toISOString()
}

/**
 * Turns the user's query into an FTS5 query: words and `"quoted phrases"` must all match,
 * a word ending in `*` matches as prefix. Every word is quoted, so punctuation cannot break the syntax.
 */
export function toFtsQuery(query: string): string {
  const parts: string[] = []
  for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (match[1] !== undefined) {
      if (match[1].trim())
        parts.push(quote(match[1]))
      continue
    }
    const word = match[2]!
    const prefix = word.length > 1 && word.endsWith('*')
    const core = prefix
      ? word.slice(0, -1)
      : word
    if (!/[\p{L}\p{N}]/u.test(core))
      continue
    parts.push(prefix
      ? `${quote(core)}*`
      : quote(core))
  }
  if (parts.length === 0)
    throw new UsageError('empty query: give at least one search word')
  return parts.join(' ')
}

function quote(text: string): string {
  return `"${text.replaceAll('"', '""')}"`
}

interface MatchRow {
  sha: string
  date: string | null
  fromAddress: string | null
  subject: string | null
  category: Category
  thread: string
  snippet: string
  score: number
}

export function search(db: Database.Database, query: string, options: SearchOptions): SearchResult[] {
  const where = ['fts MATCH ?']
  const params: unknown[] = [
    toFtsQuery(query),
  ]
  if (options.from !== undefined) {
    if (options.from.includes('@')) {
      where.push('m.from_address = ?')
      params.push(options.from)
    }
    else {
      where.push('(m.domain = ? OR m.domain LIKE \'%.\' || ?)')
      params.push(options.from, options.from)
    }
  }
  if (options.since !== undefined) {
    where.push('m.date >= ?')
    params.push(options.since)
  }
  if (options.until !== undefined) {
    where.push('m.date < ?')
    params.push(options.until)
  }
  if (options.category !== undefined) {
    where.push('m.category = ?')
    params.push(options.category)
  }
  if (options.attachment === true) {
    where.push('m.attachment_count > 0')
  }
  else if (options.attachment !== undefined) {
    where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.sha = m.sha AND a.extension = ?)')
    params.push(options.attachment)
  }

  const factor = `CASE m.category ${Object.entries(CATEGORY_FACTOR).map(([category, value]) => `WHEN '${category}' THEN ${value}`).join(' ')} ELSE 1.0 END`
  const rows = db.prepare(`
    SELECT m.sha, m.date, m.from_address AS fromAddress, m.subject, m.category, m.thread,
      snippet(fts, 1, '[', ']', '…', 12) AS ownSnippet,
      snippet(fts, -1, '[', ']', '…', 12) AS snippet,
      bm25(fts, ${COLUMN_WEIGHTS.join(', ')}) * ${factor} AS score
    FROM fts JOIN messages m ON m.id = fts.rowid
    WHERE ${where.join(' AND ')}
  `).all(...params) as (MatchRow & { ownSnippet: string })[]

  // A thread ranks by its best message; further matches in the same thread add nothing.
  const best = new Map<string, MatchRow>()
  for (const { ownSnippet, ...match } of rows) {
    // The subject is shown anyway, so a passage from the own text is preferred.
    const row = {
      ...match,
      snippet: ownSnippet.includes('[')
        ? ownSnippet
        : match.snippet,
    }
    const current = best.get(row.thread)
    if (current === undefined || row.score < current.score)
      best.set(row.thread, row)
  }
  const ranked = [
    ...best.values(),
  ]
    .sort((a, b) => a.score - b.score || (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, options.limit)

  const threadStats = db.prepare('SELECT COUNT(*) AS size, MIN(date) AS first, MAX(date) AS last FROM messages WHERE thread = ?')
  return ranked.map((row) => {
    const stats = threadStats.get(row.thread) as { size: number, first: string | null, last: string | null }
    return {
      ...row,
      reference: row.sha.slice(0, 8),
      snippet: row.snippet.replace(/\s+/g, ' ').trim(),
      threadSize: stats.size,
      threadFirst: stats.first,
      threadLast: stats.last,
    }
  })
}

export function formatResults(results: SearchResult[]): string {
  if (results.length === 0)
    return 'no matches'
  const width = String(results.length).length + 1
  return results.map((result, i) => {
    const range = `${day(result.threadFirst)}..${day(result.threadLast)}`
    const size = `${result.threadSize} ${result.threadSize === 1
      ? 'msg'
      : 'msgs'}`
    const indent = ' '.repeat(width + 2)
    return [
      `${String(i + 1).padStart(width)}  ${result.reference}  ${day(result.date)}  ${result.fromAddress ?? '(unknown)'}  ${result.category}  ${size} ${range}`,
      `${indent}${result.subject ?? '(no subject)'}`,
      `${indent}${result.snippet}`,
    ].join('\n')
  }).join('\n\n')
}

export function day(date: string | null): string {
  return date?.slice(0, 10) ?? '----------'
}
