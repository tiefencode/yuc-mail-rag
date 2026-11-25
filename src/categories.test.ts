import type { CategoryInput } from './categories.ts'
import { describe, expect, it } from 'vitest'
import { categorize } from './categories.ts'

function input(overrides: Partial<CategoryInput>): CategoryInput {
  return {
    fromAddress: 'max@example-band.com',
    autoSubmitted: null,
    listUnsubscribe: false,
    precedence: null,
    contentType: 'text/plain',
    ...overrides,
  }
}

describe('Requirement: Categories', () => {
  it('Scenario: Service sender', () => {
    expect(categorize(input({ fromAddress: 'noreply@bandcamp.com' }))).toBe('notification')
    expect(categorize(input({ fromAddress: 'ordermessages@orders.discogs.com' }))).toBe('notification')
    expect(categorize(input({ fromAddress: 'service@paypal.de' }))).toBe('notification')
    expect(categorize(input({ fromAddress: 'shop@youngandcold.de' }))).toBe('notification')
  })

  it('Scenario: Bulk header', () => {
    expect(categorize(input({ listUnsubscribe: true }))).toBe('notification')
    expect(categorize(input({ autoSubmitted: 'auto-generated' }))).toBe('notification')
    expect(categorize(input({ precedence: 'bulk' }))).toBe('notification')
    expect(categorize(input({ precedence: 'list' }))).toBe('notification')
  })

  it('treats Auto-Submitted: no and Precedence: junk differently', () => {
    expect(categorize(input({ autoSubmitted: 'no' }))).toBe('correspondence')
    expect(categorize(input({ precedence: 'first-class' }))).toBe('correspondence')
  })

  it('Scenario: Collecting society with bulk header', () => {
    expect(categorize(input({ fromAddress: 'vr-ev@gema.de', listUnsubscribe: true }))).toBe('correspondence')
    expect(categorize(input({ fromAddress: 'statement@audioglobe.it', autoSubmitted: 'auto-generated' }))).toBe('correspondence')
  })

  it('Scenario: Bounce', () => {
    expect(categorize(input({ fromAddress: 'mailer-daemon@mailwebout01.agenturserver.de' }))).toBe('bounce')
    expect(categorize(input({ fromAddress: 'MAILER-DAEMON@t-online.de' }))).toBe('bounce')
    expect(categorize(input({ contentType: 'multipart/report; report-type=delivery-status; boundary="x"' }))).toBe('bounce')
  })

  it('Scenario: Personal mail', () => {
    expect(categorize(input({}))).toBe('correspondence')
    expect(categorize(input({ fromAddress: null }))).toBe('correspondence')
  })

  it('does not match a domain that only ends with a listed name', () => {
    expect(categorize(input({ fromAddress: 'x@notbandcamp.com' }))).toBe('correspondence')
  })
})
