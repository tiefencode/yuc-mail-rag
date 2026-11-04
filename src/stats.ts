import type { Stats } from './types.ts'
import { existsSync } from 'node:fs'
import { dbPath, openStore } from './store.ts'

export function readStats(dataDir: string): Stats {
  if (!existsSync(dbPath(dataDir)))
    return { count: 0, bytes: 0, senders: [] }
  const store = openStore(dataDir)
  try {
    return {
      ...store.totals(),
      senders: store.senders(),
    }
  }
  finally {
    store.close()
  }
}

export function formatStats(stats: Stats): string {
  const rows = stats.senders.map(s => `${formatBytes(s.bytes).padStart(10)}  ${String(s.count).padStart(6)}  ${s.sender}`)
  return [
    `messages: ${stats.count} · ${formatBytes(stats.bytes)}`,
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
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
