import type { Category } from './categories.ts'

export interface ThreadInput {
  sha: string
  messageId: string | null
  inReplyTo: string[]
  references: string[]
  category: Category
  fromAddress: string | null
  subject: string | null
}

const SUBJECT_PREFIX = /^\s*(?:re|aw|antw|fwd?|wg|wtr)(?:\[\d+\])?\s*:\s*/i

export function normalizeSubject(subject: string | null): string {
  let rest = subject ?? ''
  while (SUBJECT_PREFIX.test(rest))
    rest = rest.replace(SUBJECT_PREFIX, '')
  return rest.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Groups messages into threads and returns each message's thread id, the smallest sha in its thread.
 * Messages sharing any Message-ID through In-Reply-To or References belong together, also when the
 * message with that id is missing; correspondence left alone joins messages of the same sender and subject.
 */
export function buildThreads(messages: ThreadInput[]): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (node: string): string => {
    let root = node
    while (parent.get(root) !== root)
      root = parent.get(root)!
    for (let current = node; current !== root;) {
      const next = parent.get(current)!
      parent.set(current, root)
      current = next
    }
    return root
  }
  const add = (node: string): void => {
    if (!parent.has(node))
      parent.set(node, node)
  }
  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB)
      parent.set(rootA, rootB)
  }

  // Nodes: `m:<sha>` for messages, `id:<Message-ID>` for ids, so missing messages still join their replies.
  for (const message of messages) {
    const node = `m:${message.sha}`
    add(node)
    for (const id of [
      message.messageId,
      ...message.inReplyTo,
      ...message.references,
    ]) {
      if (!id)
        continue
      add(`id:${id}`)
      union(node, `id:${id}`)
    }
  }

  const linked = new Map<string, number>()
  for (const message of messages) {
    const root = find(`m:${message.sha}`)
    linked.set(root, (linked.get(root) ?? 0) + 1)
  }
  // Taken before the subject fallback changes any thread.
  const linkedShas = new Set(messages.filter(message => linked.get(find(`m:${message.sha}`))! > 1).map(message => message.sha))
  const isLinked = (message: ThreadInput): boolean => linkedShas.has(message.sha)

  // Lone correspondence joins a thread of the same sender and subject: a linked one if there is one
  // (the first by sha), otherwise the other lone messages. Linked threads are never merged with each other.
  const bySenderSubject = new Map<string, ThreadInput[]>()
  for (const message of [...messages].sort((a, b) => a.sha.localeCompare(b.sha))) {
    const subject = normalizeSubject(message.subject)
    if (message.category !== 'correspondence' || !message.fromAddress || subject === '')
      continue
    const key = `${message.fromAddress}\n${subject}`
    bySenderSubject.set(key, [
      ...(bySenderSubject.get(key) ?? []),
      message,
    ])
  }
  for (const group of bySenderSubject.values()) {
    const anchor = group.find(isLinked) ?? group[0]!
    for (const message of group) {
      if (!isLinked(message))
        union(`m:${message.sha}`, `m:${anchor.sha}`)
    }
  }

  const smallest = new Map<string, string>()
  for (const message of messages) {
    const root = find(`m:${message.sha}`)
    const current = smallest.get(root)
    if (current === undefined || message.sha < current)
      smallest.set(root, message.sha)
  }
  return new Map(messages.map(message => [
    message.sha,
    smallest.get(find(`m:${message.sha}`))!,
  ]))
}
