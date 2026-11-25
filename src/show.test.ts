import type { EmlOptions } from './testing.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runShow } from './cli.ts'
import { rawPath, sha256 } from './raw-files.ts'
import { eml, FakeMailSource, syncCache } from './testing.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'yuc-show-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function cache(...messages: EmlOptions[]): Promise<string[]> {
  const fake = new FakeMailSource()
  fake.addFolder('INBOX')
  const shas: string[] = []
  for (const message of messages) {
    const raw = eml(message)
    fake.addMessage('INBOX', raw)
    shas.push(sha256(raw))
  }
  await syncCache(dataDir, fake)
  return shas
}

async function show(reference: string, full = false): Promise<{ code: number, output: string }> {
  const output: string[] = []
  const code = await runShow(dataDir, reference, full, text => output.push(text))
  return {
    code,
    output: output.join('\n'),
  }
}

const thread: EmlOptions[] = [
  {
    messageId: 'b@x',
    references: ['a@x'],
    from: 'max@band.com',
    subject: 'Re: Trackliste',
    date: 'Thu, 20 Mar 2025 10:00:00 +0000',
    body: 'Hier die finale Liste.\n-- \nMax Band\n\nAm 3.3.2025 schrieb Label <l@x>:\n> Kommt die Liste?\n> Danke',
    attachments: [
      { name: 'Trackliste.pdf', type: 'application/pdf' },
    ],
  },
  {
    messageId: 'a@x',
    from: 'max@band.com',
    subject: 'Trackliste',
    date: 'Mon, 03 Mar 2025 10:00:00 +0000',
    body: 'Erster Entwurf.',
  },
]

describe('Requirement: Show command', () => {
  it('Scenario: Show a thread', async () => {
    const [b, a] = await cache(...thread, { messageId: 'c@x', subject: 'Anderes', body: 'nicht im Thread' })
    const { code, output } = await show(b!.slice(0, 8))

    expect(code).toBe(0)
    expect(output.indexOf(a!.slice(0, 8))).toBeLessThan(output.indexOf(b!.slice(0, 8)))
    expect(output).toContain('2025-03-03  max@band.com  correspondence')
    expect(output).toContain('Subject: Re: Trackliste')
    expect(output).toContain('Attachments: Trackliste.pdf')
    expect(output).toContain(`raw: ${resolve(rawPath(dataDir, a!))}`)
    expect(output).toContain(`raw: ${resolve(rawPath(dataDir, b!))}`)
    expect(output).toContain('Hier die finale Liste.')
    expect(output).toContain('[3 quoted lines]')
    expect(output).not.toContain('Kommt die Liste?')
    expect(output).not.toContain('Max Band\n')
    expect(output).not.toContain('nicht im Thread')
  })

  it('prints quoted text and signatures with --full', async () => {
    const [b] = await cache(...thread)
    const { output } = await show(b!.slice(0, 8), true)
    expect(output).toContain('Kommt die Liste?')
    expect(output).toContain('Max Band')
  })

  it('Scenario: Unknown or ambiguous reference', async () => {
    await cache(...Array.from({ length: 40 }, (_, i) => ({ messageId: `m${i}@x`, subject: `M${i}` })))
    const unknown = await show('zzzzzzzz')
    expect(unknown.code).toBe(1)
    expect(unknown.output).toMatch(/no indexed message/)

    const ambiguous = await show('')
    expect(ambiguous.code).toBe(1)

    const hexDigits = '0123456789abcdef'.split('')
    const results = await Promise.all(hexDigits.map(digit => show(digit)))
    expect(results.some(result => result.code === 1 && /ambiguous/.test(result.output))).toBe(true)
  })
})
