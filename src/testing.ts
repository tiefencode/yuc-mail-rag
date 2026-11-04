import type { FetchedSource, FolderInfo, MailSource, OpenedFolder } from './types.ts'
import { Buffer } from 'node:buffer'
import { ConnectionLostError } from './errors.ts'

export interface EmlOptions {
  from?: string
  subject?: string
  messageId?: string
  body?: string
}

export function eml(options: EmlOptions = {}): Uint8Array {
  const headers = [
    options.messageId !== undefined && `Message-ID: <${options.messageId}>`,
    options.from !== undefined && `From: ${options.from}`,
    options.subject !== undefined && `Subject: ${options.subject}`,
    'Date: Wed, 04 Nov 2026 10:00:00 +0000',
  ].filter(Boolean)
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${options.body ?? 'body'}\r\n`)
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
