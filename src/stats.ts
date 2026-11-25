import type { DiskUsage, Stats } from './types.ts'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dbPath, openStore } from './store.ts'

export function readStats(dataDir: string): Stats {
  if (!existsSync(dbPath(dataDir))) {
    return {
      count: 0,
      bytes: 0,
      senders: [],
      disk: readDiskUsage(dataDir),
    }
  }
  const store = openStore(dataDir)
  try {
    return {
      ...store.totals(),
      senders: store.senders(),
      disk: readDiskUsage(dataDir),
    }
  }
  finally {
    store.close()
  }
}

function readDiskUsage(dataDir: string): DiskUsage {
  const usage: DiskUsage = { total: 0, raw: 0, database: 0 }
  if (!existsSync(dataDir))
    return usage
  const database = basename(dbPath(dataDir))
  for (const entry of readdirSync(dataDir, { recursive: true, encoding: 'utf8' })) {
    const stat = lstatSync(join(dataDir, entry))
    if (!stat.isFile())
      continue
    const allocated = stat.blocks * 512
    usage.total += allocated
    if (entry.startsWith(`raw/`))
      usage.raw += allocated
    else if (entry.startsWith(database))
      usage.database += allocated
  }
  return usage
}

export function formatStats(stats: Stats): string {
  const rows = stats.senders.map(s => `${formatBytes(s.bytes).padStart(10)}  ${String(s.count).padStart(6)}  ${s.sender}`)
  const { disk } = stats
  return [
    `messages: ${stats.count} · ${formatBytes(stats.bytes)}`,
    `disk: ${formatBytes(disk.total)} (raw ${formatBytes(disk.raw)} · database ${formatBytes(disk.database)})`,
    '',
    `${'bytes'.padStart(10)}  ${'count'.padStart(6)}  sender`,
    ...rows,
  ].join('\n')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 ** 2)
    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3)
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
