import type { Header } from 'postal-mime'
import PostalMime from 'postal-mime'
import { headerSection } from './headers.ts'
import { htmlToText } from './html-text.ts'

export interface AttachmentName {
  name: string
  /** Lower-case extension without the dot; empty when the name has none. */
  extension: string
}

export interface ParsedMessage {
  messageId: string | null
  inReplyTo: string[]
  references: string[]
  autoSubmitted: string | null
  listUnsubscribe: boolean
  precedence: string | null
  /** Top-level `Content-Type` value, lower-cased. */
  contentType: string | null
  text: string
  attachments: AttachmentName[]
}

/** Parses a raw message for indexing; throws when the source is not parseable MIME. */
export async function parseMessage(raw: Uint8Array): Promise<ParsedMessage> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' })
  const header = (key: string): string | null => firstHeader(email.headers, key)
  return {
    messageId: messageIds(header('message-id'))[0] ?? null,
    inReplyTo: messageIds(header('in-reply-to')),
    references: messageIds(header('references')),
    autoSubmitted: header('auto-submitted')?.trim().toLowerCase() || null,
    listUnsubscribe: header('list-unsubscribe') !== null,
    precedence: header('precedence')?.trim().toLowerCase() || null,
    contentType: header('content-type')?.trim().toLowerCase() || null,
    text: email.text ?? (email.html
      ? htmlToText(email.html)
      : ''),
    attachments: email.attachments
      .filter(attachment => attachment.filename)
      .map(attachment => attachmentName(attachment.filename!)),
  }
}

/** `Message-ID`, `In-Reply-To` and `References` from the header section only; the body is never parsed. */
export async function parseThreadHeaders(raw: Uint8Array): Promise<{ messageId: string | null, ids: string[] }> {
  const email = await PostalMime.parse(headerSection(raw))
  return {
    messageId: messageIds(firstHeader(email.headers, 'message-id'))[0] ?? null,
    ids: [
      ...messageIds(firstHeader(email.headers, 'in-reply-to')),
      ...messageIds(firstHeader(email.headers, 'references')),
    ],
  }
}

function firstHeader(headers: Header[], key: string): string | null {
  return headers.find(header => header.key === key)?.value ?? null
}

/** Ids in angle brackets; a value without brackets counts as whitespace-separated ids. */
export function messageIds(value: string | null): string[] {
  if (!value)
    return []
  const bracketed = [
    ...value.matchAll(/<([^<>]+)>/g),
  ].map(match => match[1]!.trim())
  const ids = bracketed.length > 0
    ? bracketed
    : value.split(/\s+/)
  return ids.filter(Boolean)
}

function attachmentName(name: string): AttachmentName {
  const dot = name.lastIndexOf('.')
  return {
    name,
    extension: dot > 0
      ? name.slice(dot + 1).toLowerCase()
      : '',
  }
}
