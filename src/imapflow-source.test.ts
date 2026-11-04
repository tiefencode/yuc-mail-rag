import type { ImapFlow } from 'imapflow'
import type { ImapClient } from './imapflow-source.ts'
import type { Config } from './types.ts'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuthError, ConnectionLostError } from './errors.ts'
import { connectImap, createImapSource, imapflowOptions } from './imapflow-source.ts'
import { openStore } from './store.ts'
import { sync } from './sync.ts'
import { eml } from './testing.ts'

const config: Config = {
  host: 'imap.example',
  port: 993,
  user: 'user',
  password: 'secret',
  dataDir: './data',
}

interface Call {
  method: string
  args: unknown[]
}

function recordingClient(sources: Uint8Array[]): ImapClient & { calls: Call[] } {
  const calls: Call[] = []
  const client = {
    calls,
    usable: true,
    list: async (...args: unknown[]) => {
      calls.push({ method: 'list', args })
      return [
        {
          path: 'INBOX',
          flags: new Set<string>(),
        },
        {
          path: 'Archive',
          flags: new Set(['\\Noselect']),
        },
      ]
    },
    mailboxOpen: async (...args: unknown[]) => {
      calls.push({ method: 'mailboxOpen', args })
      return { uidValidity: 7n }
    },
    search: async (...args: unknown[]) => {
      calls.push({ method: 'search', args })
      return sources.map((_, i) => i + 1)
    },
    async* fetch(...args: unknown[]) {
      calls.push({ method: 'fetch', args })
      for (const [i, source] of sources.entries()) {
        yield {
          seq: i + 1,
          uid: i + 1,
          source: Buffer.from(source),
        }
      }
    },
    logout: async () => {
      calls.push({ method: 'logout', args: [] })
    },
  }
  return client as unknown as ImapClient & { calls: Call[] }
}

describe('Requirement: Read-only server access (imapflow adapter)', () => {
  it('Scenario: Only read-only commands', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'yuc-imap-'))
    const client = recordingClient([
      eml({ subject: 'a' }),
      eml({ subject: 'b' }),
    ])
    const store = openStore(dataDir)
    const summary = await sync(createImapSource(client), store, dataDir)
    store.close()
    rmSync(dataDir, { recursive: true, force: true })

    expect(summary.errors).toEqual([])
    expect(new Set(client.calls.map(c => c.method))).toEqual(new Set([
      'list',
      'mailboxOpen',
      'search',
      'fetch',
    ]))
    expect(client.calls.filter(c => c.method === 'mailboxOpen').map(c => c.args)).toEqual([
      [
        'INBOX',
        { readOnly: true },
      ],
    ])
  })

  it('Scenario: Unread message stays unread', async () => {
    const client = recordingClient([
      eml(),
    ])
    const source = createImapSource(client)
    await source.openFolder('INBOX')
    await Array.fromAsync(source.fetchSources([1]))
    // imapflow sends `source: true` as BODY.PEEK[], which leaves \Seen untouched.
    expect(client.calls.find(c => c.method === 'fetch')!.args.slice(1)).toEqual([
      { uid: true, source: true },
      { uid: true },
    ])
  })
})

describe('Requirement: Secure connection (imapflow adapter)', () => {
  it('Scenario: Invalid certificate', () => {
    const options = imapflowOptions(config)
    expect(options.secure).toBe(true)
    expect(options.tls?.rejectUnauthorized).toBe(true)
    expect(options.port).toBe(993)
  })

  it('reports a lost connection as ConnectionLostError', async () => {
    const client = recordingClient([])
    client.search = async () => {
      (client as { usable: boolean }).usable = false
      throw Object.assign(new Error('socket closed'), { code: 'NoConnection' })
    }
    await expect(createImapSource(client).listUids()).rejects.toBeInstanceOf(ConnectionLostError)
  })

  it('survives an error event after connect, leaving pending commands to reject', async () => {
    const client = Object.assign(new EventEmitter(), {
      connect: async () => {},
    })
    await connectImap(config, false, () => client as unknown as ImapFlow)
    expect(() => client.emit('error', new Error('socket hang up'))).not.toThrow()
  })

  it('reports a rejected login as AuthError after one attempt', async () => {
    let attempts = 0
    const client = Object.assign(new EventEmitter(), {
      connect: async () => {
        attempts++
        throw Object.assign(new Error('Authentication failed'), { authenticationFailed: true })
      },
    })
    await expect(connectImap(config, false, () => client as unknown as ImapFlow)).rejects.toBeInstanceOf(AuthError)
    expect(attempts).toBe(1)
  })
})
