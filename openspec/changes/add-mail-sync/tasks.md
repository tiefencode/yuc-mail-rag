# Tasks: add-mail-sync

- [ ] Scaffold: `package.json`, `tsconfig.json`, lint, Vitest, `.gitignore` (`.env`, `data/`), `.env.example`
- [ ] Header metadata extraction with `postal-mime`
- [ ] Store: SQLite schema, content-addressed raw files with temp file + rename
- [ ] `MailSource` interface and in-memory fake with command log
- [ ] Sync algorithm with a test per scenario in `openspec/specs/mail-sync/spec.md`
- [ ] Run summary and exit codes
- [ ] `stats` command
- [ ] Configuration: `.env` and Keychain lookup
- [ ] `imapflow` adapter: TLS with verification, single login, `EXAMINE`, `BODY.PEEK[]`
- [ ] Manual run against the shadow mailbox with `imapflow` command log: full run, re-run, flags unchanged
- [ ] Commands and Keychain setup in `CLAUDE.md`
