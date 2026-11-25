export interface FolderInfo {
  path: string
  selectable: boolean
}

export interface OpenedFolder {
  uidValidity: number
}

export interface FetchedSource {
  uid: number
  source: Uint8Array
}

/** Read-only access to the shadow mailbox. */
export interface MailSource {
  listFolders: () => Promise<FolderInfo[]>
  openFolder: (path: string) => Promise<OpenedFolder>
  listUids: () => Promise<number[]>
  fetchSources: (uids: number[]) => AsyncIterable<FetchedSource>
  close: () => Promise<void>
}

export interface Metadata {
  messageId: string | null
  date: string | null
  fromAddress: string | null
  subject: string | null
}

export interface Location {
  folder: string
  uidValidity: number
  uid: number
}

export interface StoredLocation extends Location {
  sha256: string
}

export interface SyncSummary {
  downloaded: number
  newLocations: number
  removedLocations: number
  deletedMessages: number
  messageIdsWithSeveralSources: number
  errors: string[]
}

export interface SenderStats {
  sender: string
  count: number
  bytes: number
}

export interface DiskUsage {
  total: number
  raw: number
  database: number
}

export interface Stats {
  count: number
  bytes: number
  senders: SenderStats[]
  disk: DiskUsage
}

export interface Config {
  host: string
  port: number
  user: string
  password: string
  dataDir: string
}
