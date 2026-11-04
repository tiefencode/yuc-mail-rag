# Ideas

- Package the shared workflow (skills `openspec-light` and `commit`, agents `spec-reviewer` and `code-reviewer`, hook `readonly-bash.py`) as a Claude Code plugin in its own git repo, once a second machine or other people need it.
- Print the server quota of the shadow mailbox (IMAP `GETQUOTAROOT` on `INBOX`, read-only) as one line in the `sync` summary, to watch its growth; `sync` is connected anyway. Not urgent: the shadow mailbox has no quota limit, and the Mittwald Kundencenter shows its usage. Stripping attachments on the server to save space is ruled out: it breaks the source of truth, the local mirror (new hash), and phase 6.

## Rule candidates

- 2026-11-04 (add-mail-sync): `openspec validate` (CLI 1.16.0) failed on `openspec/specs/mail-sync/spec.md` because the `## Purpose` section was missing; the spec format in the `openspec-light` skill shows neither `## Purpose` nor `## Requirements`, and no step runs `openspec validate`.
