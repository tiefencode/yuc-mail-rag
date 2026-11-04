# yuc-mail-rag

Local, evidence-based search over the email correspondence of Young & Cold Records. Architecture and decision log: `docs/architecture.md`.

## Workflow

Specs and changes follow the user skill `openspec-light`: non-trivial changes start with it, and every feature ends with its completion checklist.

## Commands

- `pnpm sync` (`--log-imap` prints the IMAP command log to stderr), `pnpm stats`
- Checks before every commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Setup: copy `.env.example` to `.env`; store the IMAP password once with `security add-generic-password -s yuc-mail-rag -a <IMAP_USER> -w`

## Data rules

- The shadow mailbox on Mittwald is the source of truth. The local data directory is a derived cache and must be rebuildable from IMAP at any time.
- Never modify server state (no flag changes, moves, deletes, appends).
- Credentials and mail data are never committed.
