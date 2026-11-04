import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex')
}

export function rawPath(dataDir: string, sha: string): string {
  return join(dataDir, 'raw', sha.slice(0, 2), `${sha}.eml`)
}

function tempDir(dataDir: string): string {
  return join(dataDir, 'raw', '.tmp')
}

/** Writes via temp file and rename, so a raw file is either complete or absent. */
export function writeRaw(dataDir: string, sha: string, source: Uint8Array): void {
  const target = rawPath(dataDir, sha)
  const temp = join(tempDir(dataDir), `${sha}.${process.pid}`)
  mkdirSync(tempDir(dataDir), { recursive: true })
  mkdirSync(join(target, '..'), { recursive: true })
  const fd = openSync(temp, 'w')
  try {
    let written = 0
    while (written < source.byteLength)
      written += writeSync(fd, source, written)
    fsyncSync(fd)
  }
  finally {
    closeSync(fd)
  }
  renameSync(temp, target)
}

export function removeTempFiles(dataDir: string): void {
  rmSync(tempDir(dataDir), { recursive: true, force: true })
}

export function deleteRaw(dataDir: string, sha: string): void {
  rmSync(rawPath(dataDir, sha), { force: true })
}
