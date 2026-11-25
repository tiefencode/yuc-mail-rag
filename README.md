# yuc-mail-rag

Local, evidence-based search over the email correspondence of Young & Cold Records. Architecture and decision log: [docs/architecture.md](docs/architecture.md).

Two phases are in place: the mail sync, a read-only copy of the shadow mailbox on Mittwald into a local cache, and a full-text search over that cache without an LLM.

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
spam suspects: 0
errors: 0
```

The exit code is 0 only if `errors` is 0. Each error is listed below the summary.

After the download, `sync` updates the search index (see [Search](#search)). `spam suspects` counts messages in spam folders that look like correspondence; `pnpm spam-check` lists them.

To see the IMAP commands that were sent (for example to confirm that nothing writes to the server), print the command log to stderr:

```bash
pnpm sync --log-imap
```

### Troubleshooting

- `missing configuration: IMAP_HOST, IMAP_USER`: `.env` is missing or incomplete.
- `missing Keychain entry: service yuc-mail-rag, account …`: the Keychain entry is missing or stored under a different account than `IMAP_USER`.

### Rebuilding the cache

The local cache is derived data. To rebuild it from scratch, delete `DATA_DIR` and run `pnpm sync` again. The search index `DATA_DIR/index.db` is derived from the cache; delete it to rebuild it with the next command.

## Statistics

```bash
pnpm stats
```

Prints the number of stored messages and their total size, overall and per sender address. It reads only the local cache and needs no server connection.

## Search

All search commands read only the local cache and need no server connection. Each one first brings the index `DATA_DIR/index.db` in step with the cache, and rebuilds it completely when the indexing rules changed.

```bash
pnpm search trackliste album
```

- All words must match, case and accents ignored (`muller` finds `Müller`). `vertrieb*` matches as prefix, `'"final mix"'` as phrase.
- One result per thread, with the best matching message: its reference, date, sender, category, the thread's size and date range, subject and a passage.
- Correspondence ranks before notifications (shop, Bandcamp, PayPal, Discogs and similar services) and bounces. Text in quotes and signatures counts, but less than new text. Attachment file names are searchable, attachment content is not.
- Spam folders (`…Spam`, `…Junk`) are not searched.

Filters, combined with AND:

| Option | Example | Meaning |
|---|---|---|
| `--from` | `--from audioglobe.it` | sender address or domain, subdomains included |
| `--since`, `--until` | `--since 2024 --until 2024-06` | date as `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, both inclusive |
| `--category` | `--category notification` | `correspondence`, `notification` or `bounce` |
| `--attachment` | `--attachment pdf` | with an attachment of that extension; without a value (last on the line), any attachment |
| `--limit` | `--limit 50` | number of results, default 20 |

To read a thread, pass the reference from the results:

```bash
pnpm show 1a2b3c4d
```

It prints every message of the thread with its own text, the number of quoted lines and the path of the raw file, which opens in Apple Mail with `open <path>`. `--full` adds quoted text and signatures.

### Spam check

```bash
pnpm spam-check
```

Lists messages in spam folders that look like correspondence: a reply to a known thread (`reply`), a known sender (`sender`), a known organization domain (`domain`, not for free-mail providers) or a known subject (`subject`). Move real ones out of spam on the server by hand; the next `sync` indexes them. Nothing is changed on the server.

### Test set

The test set measures search quality with real questions. It is stored in `DATA_DIR/testset.json` and never committed.

1. Search, then record the question with the message that answers it:

   ```bash
   pnpm testset add --query "trackliste album" --pick 1a2b3c4d --question "Welche Trackliste hat die Band geschickt?"
   ```

2. Add further messages that also answer it: `pnpm testset expect <id> <reference>`. Review with `pnpm testset list`, delete with `pnpm testset remove <id>`.

3. Measure:

   ```bash
   pnpm eval
   ```

   It prints hit@1, hit@5, hit@10 and the mean reciprocal rank (MRR) and one rank per entry id, `-` when the expected thread is not among the first 20 results and `gone` when its message left the cache. The output holds no mail content, so it can be shared with Claude.

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
