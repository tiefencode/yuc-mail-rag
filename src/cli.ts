import type { PasswordLookup } from './config.ts'
import type { Store } from './store.ts'
import type { Config, MailSource } from './types.ts'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { keychainPassword, loadConfig } from './config.ts'
import { DEFAULT_DATA_DIR } from './constants.ts'
import { UsageError } from './errors.ts'
import { connectImap } from './imapflow-source.ts'
import { openIndex, updateIndex } from './search-index.ts'
import { formatResults, parseSearchOptions, search } from './search.ts'
import { showThread } from './show.ts'
import { formatSuspects } from './spam.ts'
import { formatStats, readStats } from './stats.ts'
import { openStore } from './store.ts'
import { emptySummary, formatSummary, sync } from './sync.ts'

export interface SyncDeps {
  env: NodeJS.ProcessEnv
  lookup: PasswordLookup
  connect: (config: Config) => Promise<MailSource>
  out: (text: string) => void
}

export async function runSync(deps: SyncDeps): Promise<number> {
  let config: Config
  let source: MailSource
  try {
    config = await loadConfig(deps.env, deps.lookup)
    source = await deps.connect(config)
  }
  catch (error) {
    deps.out(formatSummary({
      ...emptySummary(),
      errors: [(error as Error).message],
    }))
    return 1
  }

  let store: Store | undefined
  try {
    store = openStore(config.dataDir)
    const summary = await sync(source, store, config.dataDir)
    deps.out(formatSummary(summary))
    return summary.errors.length === 0
      ? 0
      : 1
  }
  finally {
    try {
      store?.close()
    }
    finally {
      await source.close()
    }
  }
}

export function runStats(dataDir: string, out: (text: string) => void): number {
  out(formatStats(readStats(dataDir)))
  return 0
}

export type RawOptions = Record<string, string | boolean | undefined>

/** Runs a command that reads the index; usage errors print their message and exit 1. */
async function withIndex(dataDir: string, out: (text: string) => void, command: (db: ReturnType<typeof openIndex>) => string): Promise<number> {
  try {
    await updateIndex(dataDir)
    const db = openIndex(dataDir)
    try {
      out(command(db))
      return 0
    }
    finally {
      db.close()
    }
  }
  catch (error) {
    if (error instanceof UsageError) {
      out(error.message)
      return 1
    }
    throw error
  }
}

export async function runSearch(dataDir: string, query: string[], raw: RawOptions, out: (text: string) => void): Promise<number> {
  return withIndex(dataDir, out, db => formatResults(search(db, query.join(' '), parseSearchOptions(raw))))
}

export async function runShow(dataDir: string, reference: string, full: boolean, out: (text: string) => void): Promise<number> {
  return withIndex(dataDir, out, db => showThread(db, dataDir, reference, full))
}

export async function runSpamCheck(dataDir: string, out: (text: string) => void): Promise<number> {
  return withIndex(dataDir, out, formatSuspects)
}

const USAGE = [
  'usage: cli.ts sync [--log-imap]',
  '       cli.ts stats',
  '       cli.ts search <words> [--limit n] [--from address|domain] [--since date] [--until date] [--category c] [--attachment [ext]]',
  '       cli.ts show <reference> [--full]',
  '       cli.ts spam-check',
].join('\n')

// `--attachment` takes an optional extension; without one (last, or before another option) it means any attachment.
function normalizeArgs(args: string[]): string[] {
  return args.map((arg, i) => arg === '--attachment' && (i === args.length - 1 || args[i + 1]!.startsWith('-'))
    ? '--attachment='
    : arg)
}

async function main(): Promise<number> {
  if (existsSync('.env'))
    process.loadEnvFile('.env')
  const { positionals, values } = parseArgs({
    args: normalizeArgs(process.argv.slice(2)),
    allowPositionals: true,
    options: {
      'log-imap': { type: 'boolean', default: false },
      'limit': { type: 'string' },
      'from': { type: 'string' },
      'since': { type: 'string' },
      'until': { type: 'string' },
      'category': { type: 'string' },
      'attachment': { type: 'string' },
      'full': { type: 'boolean', default: false },
    },
  })
  const out = (text: string): void => console.log(text)
  const dataDir = process.env.DATA_DIR?.trim() || DEFAULT_DATA_DIR

  switch (positionals[0]) {
    case 'sync':
      return runSync({
        env: process.env,
        lookup: keychainPassword,
        connect: config => connectImap(config, values['log-imap']),
        out,
      })
    case 'stats':
      return runStats(dataDir, out)
    case 'search':
      return runSearch(dataDir, positionals.slice(1), values, out)
    case 'spam-check':
      return runSpamCheck(dataDir, out)
    case 'show':
      return runShow(dataDir, positionals[1] ?? '', values.full, out)
    default:
      console.error(USAGE)
      return 1
  }
}

if (import.meta.main)
  process.exitCode = await main()
