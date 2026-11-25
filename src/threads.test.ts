import type { ThreadInput } from './threads.ts'
import { describe, expect, it } from 'vitest'
import { buildThreads, normalizeSubject } from './threads.ts'

function message(sha: string, overrides: Partial<ThreadInput> = {}): ThreadInput {
  return {
    sha,
    messageId: `${sha}@example.com`,
    inReplyTo: [],
    references: [],
    category: 'correspondence',
    fromAddress: `${sha}@example.com`,
    subject: `Subject ${sha}`,
    ...overrides,
  }
}

describe('Requirement: Threads', () => {
  it('Scenario: Reply to a missing sent message', () => {
    const threads = buildThreads([
      message('a', { messageId: 'a' }),
      message('b', {
        messageId: 'b',
        references: ['a', 's'],
        inReplyTo: ['s'],
      }),
      message('c', { messageId: 'c' }),
    ])
    expect(threads.get('a')).toBe(threads.get('b'))
    expect(threads.get('c')).not.toBe(threads.get('a'))
  })

  it('joins replies that only share a missing message', () => {
    const threads = buildThreads([
      message('b', {
        messageId: 'b',
        inReplyTo: ['s'],
      }),
      message('d', {
        messageId: 'd',
        references: ['s'],
      }),
    ])
    expect(threads.get('b')).toBe(threads.get('d'))
  })

  it('names a thread after its smallest sha', () => {
    const threads = buildThreads([
      message('b2', {
        messageId: 'b2',
        references: ['a1'],
      }),
      message('a1', { messageId: 'a1' }),
    ])
    expect(threads.get('b2')).toBe('a1')
  })

  it('Scenario: Subject fallback', () => {
    const threads = buildThreads([
      message('a', { fromAddress: 'max@band.com', subject: 'Trackliste Album' }),
      message('b', { fromAddress: 'max@band.com', subject: '  AW: re: TRACKLISTE   album ' }),
      message('c', { fromAddress: 'other@band.com', subject: 'Trackliste Album' }),
    ])
    expect(threads.get('a')).toBe(threads.get('b'))
    expect(threads.get('c')).not.toBe(threads.get('a'))
  })

  it('does not use the subject fallback for messages linked by headers', () => {
    const threads = buildThreads([
      message('a', { messageId: 'a', fromAddress: 'max@band.com', subject: 'Promo' }),
      message('b', {
        messageId: 'b',
        references: ['a'],
        fromAddress: 'max@band.com',
        subject: 'Promo',
      }),
      message('c', { messageId: 'c', fromAddress: 'max@band.com', subject: 'Promo' }),
      message('d', {
        messageId: 'd',
        references: ['c'],
        fromAddress: 'max@band.com',
        subject: 'Promo',
      }),
    ])
    expect(threads.get('a')).not.toBe(threads.get('c'))
  })

  it('Scenario: No subject fallback for notifications', () => {
    const threads = buildThreads([
      message('a', { category: 'notification', fromAddress: 'noreply@bandcamp.com', subject: 'New order' }),
      message('b', { category: 'notification', fromAddress: 'noreply@bandcamp.com', subject: 'New order' }),
    ])
    expect(threads.get('a')).not.toBe(threads.get('b'))
  })

  it('ignores empty subjects for the fallback', () => {
    const threads = buildThreads([
      message('a', { fromAddress: 'max@band.com', subject: null }),
      message('b', { fromAddress: 'max@band.com', subject: 'Re:' }),
    ])
    expect(threads.get('a')).not.toBe(threads.get('b'))
  })
})

describe('normalizeSubject', () => {
  it('strips nested reply and forward prefixes', () => {
    expect(normalizeSubject('Re[2]: AW: WG: Fwd: Fw:  Trackliste')).toBe('trackliste')
    expect(normalizeSubject('RE:Trackliste')).toBe('trackliste')
    expect(normalizeSubject('Antw: Trackliste')).toBe('trackliste')
  })

  it('keeps words that only start like a prefix', () => {
    expect(normalizeSubject('Review: Album')).toBe('review: album')
  })

  it('returns an empty string for missing subjects', () => {
    expect(normalizeSubject(null)).toBe('')
  })
})
