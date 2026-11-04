import type { Config } from './types.ts'
import { execFile } from 'node:child_process'
import { DEFAULT_DATA_DIR, DEFAULT_PORT, KEYCHAIN_SERVICE } from './constants.ts'
import { ConfigError } from './errors.ts'

export type PasswordLookup = (service: string, account: string) => Promise<string | null>

export const keychainPassword: PasswordLookup = (service, account) => new Promise((resolve) => {
  execFile('security', [
    'find-generic-password',
    '-s',
    service,
    '-a',
    account,
    '-w',
  ], (error, stdout) => {
    resolve(error
      ? null
      : stdout.replace(/\n$/, '') || null)
  })
})

export async function loadConfig(env: NodeJS.ProcessEnv, lookup: PasswordLookup): Promise<Config> {
  const host = env.IMAP_HOST?.trim()
  const user = env.IMAP_USER?.trim()
  const port = Number(env.IMAP_PORT?.trim() || DEFAULT_PORT)
  const missing = [!host && 'IMAP_HOST', !user && 'IMAP_USER'].filter(Boolean)
  if (missing.length > 0)
    throw new ConfigError(`missing configuration: ${missing.join(', ')}`)
  if (!Number.isInteger(port))
    throw new ConfigError(`invalid IMAP_PORT: ${env.IMAP_PORT}`)

  const password = await lookup(KEYCHAIN_SERVICE, user!)
  if (!password)
    throw new ConfigError(`missing Keychain entry: service ${KEYCHAIN_SERVICE}, account ${user}`)

  return {
    host: host!,
    port,
    user: user!,
    password,
    dataDir: env.DATA_DIR?.trim() || DEFAULT_DATA_DIR,
  }
}
