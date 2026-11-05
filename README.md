# yuc-mail-rag

Local, evidence-based search over the email correspondence of Young & Cold Records. Architecture and decision log: [docs/architecture.md](docs/architecture.md).

The current phase is the mail sync: a read-only copy of the shadow mailbox on Mittwald into a local cache.

## Requirements

- macOS (the IMAP password is read from the Keychain)
- Node.js 24 or later (runs the TypeScript sources directly)
- pnpm 10

## Setup

Once per machine:

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the configuration and fill in `IMAP_HOST` and `IMAP_USER`:

   ```bash
   cp .env.example .env
   ```

   | Variable | Default | Meaning |
   |---|---|---|
   | `IMAP_HOST` | (required) | IMAP server of the shadow mailbox |
   | `IMAP_PORT` | `993` | IMAP port, TLS |
   | `IMAP_USER` | (required) | login of the shadow mailbox |
   | `DATA_DIR` | `./data.noindex` | local cache; the `.noindex` suffix keeps Spotlight out |

3. Store the IMAP password in the Keychain. The command prompts for it, so it never lands in the shell history:

   ```bash
   security add-generic-password -s yuc-mail-rag -a <IMAP_USER> -w
   ```

   To replace an existing entry, add `-U`.

## Sync

```bash
pnpm sync
```

pnpm runs the script in the project root, where `.env` is read and the default `DATA_DIR` is resolved.

- The first run downloads every message of every selectable folder, including spam and trash. Later runs download only new messages.
- The local cache mirrors the server: messages removed or moved on the server are removed or moved locally.
- Access is read-only. The sync never changes flags, moves, deletes or appends anything on the server.
- An interrupted run is safe; the next run picks up the missing messages without storing any message twice.

At the end it prints a summary:

```
downloaded: 12
new locations: 12
removed locations: 0
deleted messages: 0
Message-IDs with several sources: 0
errors: 0
```

The exit code is 0 only if `errors` is 0. Each error is listed below the summary.

To see the IMAP commands that were sent (for example to confirm that nothing writes to the server), print the command log to stderr:

```bash
pnpm sync --log-imap
```

### Troubleshooting

- `missing configuration: IMAP_HOST, IMAP_USER`: `.env` is missing or incomplete.
- `missing Keychain entry: service yuc-mail-rag, account …`: the Keychain entry is missing or stored under a different account than `IMAP_USER`.

### Rebuilding the cache

The local cache is derived data. To rebuild it from scratch, delete `DATA_DIR` and run `pnpm sync` again.

## Statistics

```bash
pnpm stats
```

Prints the number of stored messages and their total size, overall and per sender address. It reads only the local cache and needs no server connection.

## Development

Checks before every commit:

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

Changes follow the OpenSpec flow described in [CLAUDE.md](CLAUDE.md).
