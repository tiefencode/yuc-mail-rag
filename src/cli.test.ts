import type { SyncDeps } from './cli.ts'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStats, runSync } from './cli.ts'
import { loadConfig } from './config.ts'
import { AuthError } from './errors.ts'
import { formatStats } from './stats.ts'
import { openStore } from './store.ts'
import { emptySummary, formatSummary } from './sync.ts'
import { eml, FakeMailSource } from './testing.ts'

let baseDir: string
let dataDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'yuc-cli-'))
  dataDir = join(baseDir, 'data')
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps & { output: string[] } {
  const output: string[] = []
  return {
    env: { IMAP_HOST: 'imap.example', IMAP_USER: 'user', DATA_DIR: dataDir },
    lookup: async () => 'secret',
    connect: async () => new FakeMailSource(),
    out: text => output.push(text),
    output,
    ...overrides,
  }
}

describe('Requirement: Secure connection', () => {
  it('Scenario: Authentication rejected', async () => {
    const connect = vi.fn(async () => {
      throw new AuthError('authentication failed')
    })
    const d = deps({ connect })
    expect(await runSync(d)).toBe(1)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(d.output.join('\n')).toContain('authentication failed')
    expect(existsSync(dataDir)).toBe(false)
  })
})

describe('Requirement: Run summary', () => {
  it('Scenario: Summary printed', async () => {
    const server = new FakeMailSource()
    server.addFolder('INBOX')
    server.addMessage('INBOX', eml({ subject: 'a' }))
    const d = deps({
      connect: async () => server,
    })
    expect(await runSync(d)).toBe(0)
    expect(d.output).toEqual([
      formatSummary({
        ...emptySummary(),
        downloaded: 1,
        newLocations: 1,
      }),
    ])
  })

  it('exits non-zero when the run had errors', async () => {
    const server = new FakeMailSource()
    server.addFolder('INBOX')
    server.failingListings.add('INBOX')
    const d = deps({
      connect: async () => server,
    })
    expect(await runSync(d)).toBe(1)
    expect(d.output).toEqual([
      formatSummary({
        ...emptySummary(),
        errors: ['INBOX: listing INBOX failed'],
      }),
    ])
  })

  it('prints a summary when the run fails before it starts', async () => {
    const d = deps({
      env: { DATA_DIR: dataDir },
    })
    expect(await runSync(d)).toBe(1)
    expect(d.output).toEqual([
      formatSummary({
        ...emptySummary(),
        errors: ['missing configuration: IMAP_HOST, IMAP_USER'],
      }),
    ])
  })
})

describe('Requirement: Configuration outside the repository', () => {
  it('Scenario: Missing configuration', async () => {
    await expect(loadConfig({}, async () => 'secret')).rejects.toThrow('missing configuration: IMAP_HOST, IMAP_USER')
    await expect(loadConfig({ IMAP_HOST: 'h', IMAP_USER: 'u' }, async () => null))
      .rejects
      .toThrow('missing Keychain entry: service yuc-mail-rag, account u')

    const connect = vi.fn(async () => new FakeMailSource())
    const d = deps({
      env: { DATA_DIR: dataDir },
      connect,
    })
    expect(await runSync(d)).toBe(1)
    expect(connect).not.toHaveBeenCalled()
  })

  it('looks up the password with service yuc-mail-rag and the IMAP user', async () => {
    const lookup = vi.fn(async () => 'secret')
    const config = await loadConfig({ IMAP_HOST: 'h', IMAP_USER: 'p1' }, lookup)
    expect(lookup).toHaveBeenCalledWith('yuc-mail-rag', 'p1')
    expect(config).toMatchObject({
      host: 'h',
      port: 993,
      user: 'p1',
      password: 'secret',
      dataDir: './data.noindex',
    })
  })
})

describe('Requirement: Storage statistics', () => {
  it('Scenario: Empty store (output and exit code)', () => {
    const zero = formatStats({ count: 0, bytes: 0, senders: [] })
    const output: string[] = []
    expect(runStats(dataDir, text => output.push(text))).toBe(0)
    openStore(dataDir).close()
    expect(runStats(dataDir, text => output.push(text))).toBe(0)
    expect(output).toEqual([zero, zero])
  })
})
