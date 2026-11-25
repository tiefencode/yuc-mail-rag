import { describe, expect, it } from 'vitest'
import { segment } from './segment.ts'

function lines(...text: string[]): string {
  return text.join('\n')
}

describe('Requirement: Quoted text and signatures', () => {
  it('keeps a plain body as own text', () => {
    const result = segment(lines('Hallo,', 'anbei die Trackliste.'))
    expect(result.own).toBe(lines('Hallo,', 'anbei die Trackliste.'))
    expect(result.quoted).toBe('')
    expect(result.signature).toBe('')
    expect(result.quotedLines).toBe(0)
  })

  it('Scenario: Quote marker lines', () => {
    const result = segment(lines('Passt so.', '> Ist die Trackliste final?', '>> Frage davor', 'Gruß'))
    expect(result.own).toBe(lines('Passt so.', 'Gruß'))
    expect(result.quoted).toContain('Ist die Trackliste final?')
    expect(result.quoted).toContain('Frage davor')
    expect(result.quotedLines).toBe(2)
  })

  it('Scenario: Attribution lines', () => {
    const english = segment(lines('Fine.', '', 'On Tue, 3 Mar 2025 at 10:00, Max Band <max@example.com> wrote:', 'Is the tracklist final?'))
    expect(english.own.trim()).toBe('Fine.')
    expect(english.quoted).toContain('Is the tracklist final?')

    const german = segment(lines('Passt.', 'Am 03.03.2025 um 10:00 schrieb Max Band <max@example.com>:', 'Ist die Trackliste final?'))
    expect(german.own.trim()).toBe('Passt.')
    expect(german.quoted).toContain('Ist die Trackliste final?')
  })

  it('recognizes an attribution line wrapped over two lines', () => {
    const result = segment(lines('Passt.', 'Am Di., 3. März 2025 um 10:00 Uhr schrieb Max Band <', 'max@example.com>:', 'Ist die Trackliste final?'))
    expect(result.own.trim()).toBe('Passt.')
    expect(result.quoted).toContain('Ist die Trackliste final?')
  })

  it('Scenario: Outlook-style reply header', () => {
    for (const marker of ['-----Original Message-----', '-----Ursprüngliche Nachricht-----']) {
      const result = segment(lines('Danke!', marker, 'From: Label', 'Alte Nachricht'))
      expect(result.own.trim()).toBe('Danke!')
      expect(result.quoted).toContain('Alte Nachricht')
    }
    const block = segment(lines('Danke!', '', 'Von: Max Band <max@example.com>', 'Gesendet: Dienstag, 3. März 2025 10:00', 'An: info@example.com', 'Betreff: Trackliste', '', 'Alte Nachricht'))
    expect(block.own.trim()).toBe('Danke!')
    expect(block.quoted).toContain('Alte Nachricht')

    const english = segment(lines('Thanks!', 'From: Max Band', 'Sent: Tuesday', 'Old message'))
    expect(english.own.trim()).toBe('Thanks!')
    expect(english.quoted).toContain('Old message')
  })

  it('does not treat a lone From: line in own text as a reply header', () => {
    const result = segment(lines('From: the band, with love', 'see you'))
    expect(result.quoted).toBe('')
  })

  it('Scenario: Signature delimiter', () => {
    const result = segment(lines('Anbei.', '-- ', 'Max Band', 'Tel. 0123', '> zitiert'))
    expect(result.own).toBe('Anbei.')
    expect(result.signature).toBe(lines('Max Band', 'Tel. 0123'))
    expect(result.quoted).toContain('zitiert')
  })

  it('accepts a signature delimiter whose trailing space was stripped', () => {
    const result = segment(lines('Anbei.', '--', 'Max Band'))
    expect(result.own).toBe('Anbei.')
    expect(result.signature).toBe('Max Band')
  })

  it('treats device lines as signature', () => {
    const result = segment(lines('Ok.', '', 'Von meinem iPhone gesendet'))
    expect(result.own.trim()).toBe('Ok.')
    expect(result.signature).toBe('Von meinem iPhone gesendet')
  })

  it('Scenario: Forwarded message', () => {
    for (const marker of ['Begin forwarded message:', 'Anfang der weitergeleiteten Nachricht:', '---------- Forwarded message ---------']) {
      const result = segment(lines('FYI', '', marker, '', 'From: Max Band <max@example.com>', 'Date: 3 March 2025', 'Subject: Trackliste', '', 'Hier die Trackliste.'))
      expect(result.own).toContain('Hier die Trackliste.')
      expect(result.quoted).toBe('')
    }
  })

  it('quotes a reply inside a forwarded message', () => {
    const result = segment(lines('FYI', 'Begin forwarded message:', 'From: Max', 'Subject: x', '', 'Neu', 'On Mon, Max wrote:', 'Alt'))
    expect(result.own).toContain('Neu')
    expect(result.quoted).toContain('Alt')
  })
})
