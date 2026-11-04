# Proposal: add-mail-sync

Add a read-only `sync` that copies every message of the shadow mailbox into a local, rebuildable cache, plus a `stats` command that reports message count and size.

## Why

Incoming mail now reaches the shadow mailbox. Every later phase (parsing, search, answers) needs a complete local copy of it. Real numbers on storage use, in particular for the daily order confirmations, replace guesses.

## What changes

- New capability `mail-sync`; all its requirements are added.
- New CLI commands `sync` and `stats`.
- Project scaffolding: Node/TypeScript setup, tests, lint.

## Non-goals

- Parsing message bodies, threads, categories, search.
- Sent mail, and copying the active mailbox into the shadow mailbox.
- Attachment extraction (attachments stay inside the raw messages).
- Automatic or scheduled runs; `sync` is started manually. Automation is a later change.
- Protection against concurrent runs; it comes with the automation change.

## Open questions

- [x] IMAP host and port of the shadow mailbox: implicit TLS on port 993. Host and user go into `.env`, not into this doc.

