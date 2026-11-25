import type { FetchedSource, FolderInfo, MailSource, OpenedFolder } from './types.ts'
import { Buffer } from 'node:buffer'
import { ConnectionLostError } from './errors.ts'
import { openStore } from './store.ts'
import { sync } from './sync.ts'

/** Syncs the fake server into the data directory, as `pnpm sync` does before its index update. */
export async function syncCache(dataDir: string, server: MailSource): Promise<void> {
  const store = openStore(dataDir)
  try {
    const summary = await sync(server, store, dataDir)
    if (summary.errors.length > 0)
      throw new Error(summary.errors.join('\n'))
  }
  finally {
    store.close()
  }
}

export interface EmlAttachment {
  name: string
  type?: string
  content?: string
}

export interface EmlOptions {
  from?: string
  subject?: string
  messageId?: string
  /** Plain-text body; `null` leaves the plain-text part out. */
  body?: string | null
  date?: string
  inReplyTo?: string
  references?: string[]
  /** Extra header lines, written as given. */
  headers?: Record<string, string>
  html?: string
  attachments?: EmlAttachment[]
}

export function eml(options: EmlOptions = {}): Uint8Array {
  const headers = [
    options.messageId !== undefined && `Message-ID: <${options.messageId}>`,
    options.from !== undefined && `From: ${options.from}`,
    options.subject !== undefined && `Subject: ${options.subject}`,
    `Date: ${options.date ?? 'Wed, 04 Nov 2026 10:00:00 +0000'}`,
    options.inReplyTo !== undefined && `In-Reply-To: <${options.inReplyTo}>`,
    options.references !== undefined && `References: ${options.references.map(id => `<${id}>`).join(' ')}`,
    ...Object.entries(options.headers ?? {}).map(([key, value]) => `${key}: ${value}`),
  ].filter(Boolean)
  const text = options.body === undefined
    ? 'body'
    : options.body
  if (options.html === undefined && options.attachments === undefined) {
    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${text ?? ''}\r\n`)
  }

  const boundary = 'eml-boundary'
  const bodies: string[] = []
  if (text !== null)
    bodies.push(`Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}`)
  if (options.html !== undefined)
    bodies.push(`Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${options.html}`)
  // Mail clients send text and HTML as alternatives of one body.
  const parts = bodies.length === 2
    ? [`Content-Type: multipart/alternative; boundary="alt"\r\n\r\n${bodies.map(b => `--alt\r\n${b}`).join('\r\n')}\r\n--alt--`]
    : bodies
  for (const attachment of options.attachments ?? []) {
    parts.push([
      `Content-Type: ${attachment.type ?? 'application/octet-stream'}; name="${attachment.name}"`,
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(attachment.content ?? 'attachment').toString('base64'),
    ].join('\r\n'))
  }
  return Buffer.from([
    ...headers,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts.map(part => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    '',
  ].join('\r\n'))
}

export interface FakeMessage {
  uid: number
  source: Uint8Array
  flags: Set<string>
}

export interface FakeFolder {
  path: string
  uidValidity: number
  selectable: boolean
  nextUid: number
  messages: FakeMessage[]
}

/** In-memory mailbox that records every call it receives. */
export class FakeMailSource implements MailSource {
  folders: FakeFolder[] = []
  calls: string[] = []
  fetchedUids: number[] = []
  failingListings = new Set<string>()
  expungeBeforeFetch = new Set<number>()
  loseConnectionAfterFetches: number | undefined
  private opened: FakeFolder | undefined

  addFolder(path: string, options: { selectable?: boolean, uidValidity?: number } = {}): FakeFolder {
    const folder = {
      path,
      uidValidity: options.uidValidity ?? 1,
      selectable: options.selectable ?? true,
      nextUid: 1,
      messages: [],
    }
    this.folders.push(folder)
    return folder
  }

  addMessage(path: string, source: Uint8Array, flags: string[] = []): number {
    const folder = this.folder(path)
    const uid = folder.nextUid++
    folder.messages.push({
      uid,
      source,
      flags: new Set(flags),
    })
    return uid
  }

  removeMessage(path: string, uid: number): void {
    const folder = this.folder(path)
    folder.messages = folder.messages.filter(message => message.uid !== uid)
  }

  moveMessage(from: string, uid: number, to: string): void {
    const message = this.folder(from).messages.find(m => m.uid === uid)!
    this.removeMessage(from, uid)
    this.addMessage(to, message.source, [...message.flags])
  }

  renumber(path: string): void {
    const folder = this.folder(path)
    folder.uidValidity++
    for (const message of folder.messages)
      message.uid = folder.nextUid++
  }

  removeFolder(path: string): void {
    this.folders = this.folders.filter(folder => folder.path !== path)
  }

  folder(path: string): FakeFolder {
    const folder = this.folders.find(f => f.path === path)
    if (!folder)
      throw new Error(`no folder ${path}`)
    return folder
  }

  async listFolders(): Promise<FolderInfo[]> {
    this.calls.push('listFolders')
    return this.folders.map(({ path, selectable }) => ({ path, selectable }))
  }

  async openFolder(path: string): Promise<OpenedFolder> {
    this.calls.push(`openFolder ${path}`)
    this.opened = this.folder(path)
    return { uidValidity: this.opened.uidValidity }
  }

  async listUids(): Promise<number[]> {
    const folder = this.opened!
    this.calls.push(`listUids ${folder.path}`)
    if (this.failingListings.has(folder.path))
      throw new Error(`listing ${folder.path} failed`)
    return folder.messages.map(message => message.uid)
  }

  async* fetchSources(uids: number[]): AsyncIterable<FetchedSource> {
    const folder = this.opened!
    this.calls.push(`fetchSources ${folder.path}`)
    for (const uid of uids) {
      if (this.loseConnectionAfterFetches !== undefined && this.fetchedUids.length >= this.loseConnectionAfterFetches)
        throw new ConnectionLostError('connection lost')
      if (this.expungeBeforeFetch.has(uid))
        this.removeMessage(folder.path, uid)
      const message = folder.messages.find(m => m.uid === uid)
      if (!message)
        continue
      this.fetchedUids.push(uid)
      yield { uid, source: message.source }
    }
  }

  async close(): Promise<void> {
    this.calls.push('close')
  }
}
