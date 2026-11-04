# Design: add-mail-sync

Node 24 runs TypeScript directly; IMAP via `imapflow`, metadata in SQLite, raw messages as content-addressed `.eml` files.

## Stack

- Node 24 with native TypeScript type stripping: no build step, `tsc --noEmit` for type checks (`erasableSyntaxOnly`).
- pnpm.
- `imapflow` for IMAP, `better-sqlite3` for metadata.
- `postal-mime` for header parsing (RFC 2047 decoding). Metadata is parsed locally from the raw source, not taken from the server's `ENVELOPE`, so a rebuild yields the same metadata.
- Vitest for tests, `@antfu/eslint-config` for lint.
- CLI argument parsing with `node:util` `parseArgs`.

## Configuration

Non-secret settings come from `.env` (git-ignored) via `process.loadEnvFile()`.

| Variable | Default |
| --- | --- |
| `IMAP_HOST` | none |
| `IMAP_PORT` | `993` (TLS) |
| `IMAP_USER` | none |
| `DATA_DIR` | `./data` (git-ignored) |

The password lives in the macOS Keychain as a generic password with service `yuc-mail-rag` and account `IMAP_USER`. It is stored once with `security add-generic-password -s yuc-mail-rag -a <IMAP_USER> -w` (prompts for the password) and read with `security find-generic-password -s yuc-mail-rag -a <IMAP_USER> -w` via `execFile`.

## Storage

```
DATA_DIR/
  mail.db                      SQLite metadata
  raw/<sha[0:2]>/<sha>.eml     raw message source, byte-exact, content-addressed
```

| Table | Columns |
| --- | --- |
| `messages` | `sha256` (primary key), `message_id` (indexed, nullable), `date`, `from_address`, `subject`, `size` |
| `locations` | `sha256` (references `messages`), `folder`, `uid_validity`, `uid`; primary key `(folder, uid_validity, uid)` |
| `folders` | `path`, `uid_validity` |

## Identity and deduplication

- A message is its raw source; its key is the SHA-256 of that source.
- `Message-ID` is an indexed, non-unique field for later phases (threads, duplicates in search). Sources sharing one `Message-ID` are counted in the run summary.

## Sync algorithm (per selectable folder)

1. Remove leftover temp files from an interrupted run.
2. List the folders and skip non-selectable ones. Remove the locations of recorded folders that are no longer listed.
3. Per folder: open it with `EXAMINE`, read `UIDVALIDITY` and record the folder before any of its locations, so step 2 also cleans up a folder whose first sync was interrupted. A changed value means all UIDs of the folder are new; the old locations go in step 6.
4. Fetch the complete UID list. If that fails, record the error and leave the folder's locations untouched.
5. For each UID without a location: download with `BODY.PEEK[]` (no `\Seen` change) and hash it. If the hash is stored, insert only the location. Otherwise write the raw file (temp file + rename), then insert message and location in one transaction. A UID that is gone when fetched is skipped.
6. Delete the folder's locations that are not in the complete listing.
7. After all folders, and only if the run had no errors: delete messages without locations, first the record, then the raw file.
8. Print the run summary; exit non-zero if any error was recorded.

Login, TLS and configuration errors end the run before step 1, with a summary that lists the error. A lost connection ends the run where it happens; step 7 is skipped. The adapter attaches an `error` listener to the `imapflow` client, because an error event without a listener would crash the process instead of rejecting the pending command.

Folder names are stored as `imapflow`'s decoded `path`, the form `mailboxOpen` expects.

A raw file is named by its hash and written before its database row. An interrupted run leaves at most a complete orphan file, which the next run reuses, or a temp file, which step 1 removes. After a `UIDVALIDITY` change the folder is downloaded once more; at this volume that is acceptable.

## Testability

IMAP access sits behind a small interface (list folders, open folder, list UIDs, fetch messages) that offers read operations only, so the sync code cannot express a write or a non-peek fetch. Sync tests run against an in-memory fake that models `UIDVALIDITY`, expunge between listing and fetch, failing listings and connections, and logs every call. Failing logins are tested through the injected connect function. Fixtures include 8-bit non-UTF-8 bytes, bare LF line endings and a NUL byte. TLS verification is tested through the client configuration.

Read-only access is tested at the adapter level against a recording `imapflow` client (`readOnly: true`, `source: true`). That `imapflow` sends only `EXAMINE` and `BODY.PEEK[]` on the wire was verified in the manual run against the real shadow mailbox, with `imapflow`'s command log enabled.

The output layout of `sync` and `stats` is not part of the spec; tests compare against the formatter output for the expected numbers.
