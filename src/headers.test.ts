import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { extractMetadata } from './headers.ts'

function raw(text: string): Uint8Array {
  return Buffer.from(text.replace(/\n/g, '\r\n'), 'latin1')
}

describe('Requirement: Raw message storage (metadata)', () => {
  it('extracts and normalizes the metadata fields', async () => {
    const metadata = await extractMetadata(raw([
      'Message-ID:  <Order-1@Shop.Example>  ',
      'Message-ID: <second@example>',
      'Date: Wed, 04 Nov 2026 10:15:00 +0100',
      'From: "Shop" <NoReply@Shop.Example.DE>, other@example.com',
      'Subject: =?UTF-8?B?QmVzdGVsbHVuZyDDpA==?=',
      '',
      'body',
    ].join('\n')))
    expect(metadata).toEqual({
      messageId: 'Order-1@Shop.Example',
      date: '2026-11-04T09:15:00.000Z',
      fromAddress: 'noreply@shop.example.de',
      subject: 'Bestellung ä',
    })
  })

  it('Scenario: Malformed headers', async () => {
    const metadata = await extractMetadata(raw([
      'Message-ID: <>',
      'Date: not a date',
      'From: garbage',
      '',
      'body',
    ].join('\n')))
    expect(metadata).toEqual({
      messageId: null,
      date: null,
      fromAddress: null,
      subject: null,
    })
  })

  it('treats a message without headers as having no metadata', async () => {
    expect(await extractMetadata(raw('just text'))).toEqual({
      messageId: null,
      date: null,
      fromAddress: null,
      subject: null,
    })
  })
})
