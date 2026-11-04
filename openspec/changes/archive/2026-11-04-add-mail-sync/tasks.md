# Tasks: add-mail-sync

- [x] Scaffold: `package.json`, `tsconfig.json`, lint, Vitest, `.gitignore` (`.env`, `data/`), `.env.example`
- [x] Header metadata extraction with `postal-mime`
- [x] Store: SQLite schema, content-addressed raw files with temp file + rename
- [x] `MailSource` interface and in-memory fake with command log
- [x] Sync algorithm with a test per scenario in `openspec/specs/mail-sync/spec.md`
- [x] Run summary and exit codes
- [x] `stats` command
- [x] Configuration: `.env` and Keychain lookup
- [x] `imapflow` adapter: TLS with verification, single login, `EXAMINE`, `BODY.PEEK[]`
- [x] Manual run against the shadow mailbox with `imapflow` command log: full run, re-run, flags unchanged
- [x] Commands and Keychain setup in `CLAUDE.md`
