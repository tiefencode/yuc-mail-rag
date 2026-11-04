import type { Store } from './store.ts'
import type { MailSource, SyncSummary } from './types.ts'
import { ConnectionLostError } from './errors.ts'
import { extractMetadata } from './headers.ts'
import { deleteRaw, removeTempFiles, sha256, writeRaw } from './raw-files.ts'

export function emptySummary(): SyncSummary {
  return {
    downloaded: 0,
    newLocations: 0,
    removedLocations: 0,
    deletedMessages: 0,
    messageIdsWithSeveralSources: 0,
    errors: [],
  }
}

export async function sync(source: MailSource, store: Store, dataDir: string): Promise<SyncSummary> {
  const summary = emptySummary()
  removeTempFiles(dataDir)

  try {
    const folders = (await source.listFolders()).filter(folder => folder.selectable)
    const listed = new Set(folders.map(folder => folder.path))
    for (const path of store.folders()) {
      if (!listed.has(path))
        summary.removedLocations += store.removeFolder(path)
    }
    for (const { path } of folders) {
      try {
        await syncFolder(source, store, dataDir, path, summary)
      }
      catch (error) {
        if (error instanceof ConnectionLostError)
          throw error
        summary.errors.push(`${path}: ${messageOf(error)}`)
      }
    }
  }
  catch (error) {
    summary.errors.push(messageOf(error))
  }

  // Deleting only after an error-free run keeps a partial view of the server from removing messages.
  if (summary.errors.length === 0) {
    for (const sha of store.orphanMessages()) {
      store.deleteMessage(sha)
      deleteRaw(dataDir, sha)
      summary.deletedMessages++
    }
  }
  summary.messageIdsWithSeveralSources = store.countMessageIdsWithSeveralSources()
  return summary
}

async function syncFolder(source: MailSource, store: Store, dataDir: string, path: string, summary: SyncSummary): Promise<void> {
  const { uidValidity } = await source.openFolder(path)
  const uids = await source.listUids()
  const known = store.locationsOf(path)
  const recorded = new Set(known.filter(l => l.uidValidity === uidValidity).map(l => l.uid))
  // Recorded before any location, so a folder whose first sync is interrupted is still cleaned up if it disappears.
  store.setFolder(path, uidValidity)

  for await (const { uid, source: raw } of source.fetchSources(uids.filter(uid => !recorded.has(uid)))) {
    summary.downloaded++
    const sha = sha256(raw)
    const location = { folder: path, uidValidity, uid }
    if (store.hasMessage(sha)) {
      store.insertLocation(sha, location)
    }
    else {
      writeRaw(dataDir, sha, raw)
      store.insertMessage(sha, await extractMetadata(raw), raw.byteLength, location)
    }
    summary.newLocations++
  }

  const present = new Set(uids)
  for (const location of known) {
    if (location.uidValidity !== uidValidity || !present.has(location.uid)) {
      store.removeLocation(location)
      summary.removedLocations++
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error)
}

export function formatSummary(summary: SyncSummary): string {
  const lines = [
    `downloaded: ${summary.downloaded}`,
    `new locations: ${summary.newLocations}`,
    `removed locations: ${summary.removedLocations}`,
    `deleted messages: ${summary.deletedMessages}`,
    `Message-IDs with several sources: ${summary.messageIdsWithSeveralSources}`,
    `errors: ${summary.errors.length}`,
    ...summary.errors.map(error => `  ${error}`),
  ]
  return lines.join('\n')
}
