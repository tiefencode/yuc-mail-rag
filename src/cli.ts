import type { PasswordLookup } from './config.ts'
import type { Store } from './store.ts'
import type { Config, MailSource } from './types.ts'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { keychainPassword, loadConfig } from './config.ts'
import { DEFAULT_DATA_DIR } from './constants.ts'
import { connectImap } from './imapflow-source.ts'
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

async function main(): Promise<number> {
  if (existsSync('.env'))
    process.loadEnvFile('.env')
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'log-imap': { type: 'boolean', default: false },
    },
  })
  const out = (text: string): void => console.log(text)

  switch (positionals[0]) {
    case 'sync':
      return runSync({
        env: process.env,
        lookup: keychainPassword,
        connect: config => connectImap(config, values['log-imap']),
        out,
      })
    case 'stats':
      return runStats(process.env.DATA_DIR?.trim() || DEFAULT_DATA_DIR, out)
    default:
      console.error('usage: cli.ts sync [--log-imap] | stats')
      return 1
  }
}

if (import.meta.main)
  process.exitCode = await main()
