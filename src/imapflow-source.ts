import type { ImapFlowOptions } from 'imapflow'
import type { Config, FetchedSource, MailSource } from './types.ts'
import { ImapFlow } from 'imapflow'
import { FETCH_BATCH_SIZE } from './constants.ts'
import { AuthError, ConnectionLostError } from './errors.ts'

export type ImapClient = Pick<ImapFlow, 'list' | 'mailboxOpen' | 'search' | 'fetch' | 'logout' | 'usable'>

const commandLogger = {
  debug: (entry: object) => console.error(JSON.stringify(entry)),
  info: () => {},
  warn: (entry: object) => console.error(JSON.stringify(entry)),
  error: (entry: object) => console.error(JSON.stringify(entry)),
}

export function imapflowOptions(config: Config, logCommands = false): ImapFlowOptions {
  return {
    host: config.host,
    port: config.port,
    secure: true,
    tls: { rejectUnauthorized: true },
    auth: { user: config.user, pass: config.password },
    disableAutoIdle: true,
    logger: logCommands ? commandLogger : false,
  }
}

export async function connectImap(
  config: Config,
  logCommands = false,
  createClient: (options: ImapFlowOptions) => ImapFlow = options => new ImapFlow(options),
): Promise<MailSource> {
  const client = createClient(imapflowOptions(config, logCommands))
  // Without a listener, a socket error after connect() would crash the process; pending commands reject with NoConnection instead.
  client.on('error', () => {})
  try {
    await client.connect()
  }
  catch (error) {
    if ((error as { authenticationFailed?: boolean }).authenticationFailed)
      throw new AuthError('authentication failed')
    throw new Error(`connection failed: ${(error as Error).message}`)
  }
  return createImapSource(client)
}

export function createImapSource(client: ImapClient): MailSource {
  async function guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      throw toConnectionError(client, error)
    }
  }

  return {
    listFolders: () => guard(async () => (await client.list()).map(folder => ({
      path: folder.path,
      selectable: !folder.flags.has('\\Noselect') && !folder.flags.has('\\NonExistent'),
    }))),
    openFolder: path => guard(async () => {
      const mailbox = await client.mailboxOpen(path, { readOnly: true })
      return {
        uidValidity: Number(mailbox.uidValidity),
      }
    }),
    listUids: () => guard(async () => {
      const uids = await client.search({ all: true }, { uid: true })
      if (!Array.isArray(uids))
        throw new TypeError('UID listing failed')
      return uids
    }),
    async* fetchSources(uids: number[]): AsyncIterable<FetchedSource> {
      for (let i = 0; i < uids.length; i += FETCH_BATCH_SIZE) {
        const range = uids.slice(i, i + FETCH_BATCH_SIZE).join(',')
        try {
          for await (const message of client.fetch(range, { uid: true, source: true }, { uid: true })) {
            if (message.source)
              yield { uid: message.uid, source: message.source }
          }
        }
        catch (error) {
          throw toConnectionError(client, error)
        }
      }
    },
    close: async () => {
      await client.logout().catch(() => {})
    },
  }
}

function toConnectionError(client: ImapClient, error: unknown): unknown {
  if (!client.usable || (error as { code?: string }).code === 'NoConnection')
    return new ConnectionLostError(`connection lost: ${(error as Error).message}`)
  return error
}
