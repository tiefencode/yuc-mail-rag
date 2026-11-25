import { describe, expect, it } from 'vitest'
import { htmlToText } from './html-text.ts'
import { parseMessage } from './parse.ts'
import { eml } from './testing.ts'

describe('Requirement: Body text extraction', () => {
  it('uses the plain-text body when there is one', async () => {
    const parsed = await parseMessage(eml({ body: 'Hallo Welt', html: '<p>Anders</p>' }))
    expect(parsed.text).toContain('Hallo Welt')
    expect(parsed.text).not.toContain('Anders')
  })

  it('Scenario: HTML-only message', async () => {
    const parsed = await parseMessage(eml({
      body: null,
      html: '<html><head><style>.x{color:red}</style></head><body><p>Die <b>Trackliste</b> f&uuml;r das Caf&eacute; &amp; mehr&#33;</p></body></html>',
    }))
    expect(parsed.text).toContain('Trackliste')
    expect(parsed.text).toContain('für das Café & mehr!')
    expect(parsed.text).not.toContain('color')
    expect(parsed.text).not.toContain('<')
  })
})

describe('htmlToText', () => {
  it('turns block elements and line breaks into newlines', () => {
    expect(htmlToText('<div>eins</div><div>zwei<br>drei</div>').split('\n').map(l => l.trim()).filter(Boolean))
      .toEqual(['eins', 'zwei', 'drei'])
  })

  it('decodes numeric and hexadecimal entities', () => {
    expect(htmlToText('&#252;&#xFC;&nbsp;x')).toBe('üü x')
  })

  it('leaves unknown entities as they are', () => {
    expect(htmlToText('&bogus;')).toBe('&bogus;')
  })
})

describe('Requirement: Attachment names searchable', () => {
  it('collects attachment file names and extensions', async () => {
    const parsed = await parseMessage(eml({
      body: 'siehe Anhang',
      attachments: [
        { name: 'Trackliste_final.pdf', type: 'application/pdf' },
        { name: 'Cover.JPG', type: 'image/jpeg' },
        { name: 'README', type: 'text/plain', content: 'geheimwort' },
      ],
    }))
    expect(parsed.attachments).toEqual([
      { name: 'Trackliste_final.pdf', extension: 'pdf' },
      { name: 'Cover.JPG', extension: 'jpg' },
      { name: 'README', extension: '' },
    ])
  })

  it('Scenario: Attachment content', async () => {
    const parsed = await parseMessage(eml({
      body: 'siehe Anhang',
      attachments: [
        { name: 'notes.txt', type: 'text/plain', content: 'geheimwort' },
      ],
    }))
    expect(parsed.text).not.toContain('geheimwort')
  })
})

describe('headers for threads and categories', () => {
  it('reads Message-ID, In-Reply-To and References as bare ids', async () => {
    const parsed = await parseMessage(eml({
      messageId: 'b@example.com',
      inReplyTo: 's@example.com',
      references: ['a@example.com', 's@example.com'],
    }))
    expect(parsed.messageId).toBe('b@example.com')
    expect(parsed.inReplyTo).toEqual(['s@example.com'])
    expect(parsed.references).toEqual(['a@example.com', 's@example.com'])
  })

  it('reads bulk and report headers', async () => {
    const parsed = await parseMessage(eml({
      headers: {
        'Auto-Submitted': 'auto-generated',
        'List-Unsubscribe': '<mailto:x@example.com>',
        'Precedence': 'Bulk',
      },
    }))
    expect(parsed.autoSubmitted).toBe('auto-generated')
    expect(parsed.listUnsubscribe).toBe(true)
    expect(parsed.precedence).toBe('bulk')
  })

  it('reads the top-level content type', async () => {
    const raw = new TextEncoder().encode([
      'From: mailer-daemon@example.com',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'Delivery failed',
      '--b--',
      '',
    ].join('\r\n'))
    const parsed = await parseMessage(raw)
    expect(parsed.contentType).toContain('multipart/report')
    expect(parsed.contentType).toContain('delivery-status')
  })

  it('reports missing headers as empty', async () => {
    const parsed = await parseMessage(eml())
    expect(parsed.messageId).toBeNull()
    expect(parsed.inReplyTo).toEqual([])
    expect(parsed.references).toEqual([])
    expect(parsed.autoSubmitted).toBeNull()
    expect(parsed.listUnsubscribe).toBe(false)
    expect(parsed.precedence).toBeNull()
  })
})
