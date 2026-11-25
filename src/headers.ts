import type { Address } from 'postal-mime'
import type { Metadata } from './types.ts'
import PostalMime from 'postal-mime'

const EMPTY: Metadata = {
  messageId: null,
  date: null,
  fromAddress: null,
  subject: null,
}

export async function extractMetadata(raw: Uint8Array): Promise<Metadata> {
  try {
    const email = await PostalMime.parse(headerSection(raw))
    const messageIdHeader = email.headers.find(header => header.key === 'message-id')
    return {
      messageId: normalizeMessageId(messageIdHeader?.value),
      date: toUtc(email.date),
      fromAddress: firstAddress(email.from),
      subject: email.subject || null,
    }
  }
  catch {
    return EMPTY
  }
}

// Only the header block is parsed, so broken or huge bodies cannot affect the metadata.
export function headerSection(raw: Uint8Array): Uint8Array {
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i] === 0x0A && raw[i + 1] === 0x0A)
      return raw.subarray(0, i + 2)
    if (raw[i] === 0x0A && raw[i + 1] === 0x0D && raw[i + 2] === 0x0A)
      return raw.subarray(0, i + 3)
  }
  return raw
}

function normalizeMessageId(value: string | undefined): string | null {
  const id = value?.trim().replace(/^<|>$/g, '').trim()
  return id || null
}

function toUtc(value: string | undefined): string | null {
  if (!value)
    return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString()
}

function firstAddress(from: Address | undefined): string | null {
  const address = from?.group ? from.group[0]?.address : from?.address
  return address?.includes('@')
    ? address.toLowerCase()
    : null
}
