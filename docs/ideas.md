# Ideas

- Package the shared workflow (skills such as `commit`, agents `spec-reviewer` and `code-reviewer`, hook `readonly-bash.py`) as a Claude Code plugin in its own git repo, once a second machine or other people need it.
- Print the server quota of the shadow mailbox (IMAP `GETQUOTAROOT` on `INBOX`, read-only) as one line in the `sync` summary, to watch its growth; `sync` is connected anyway. Not urgent: the shadow mailbox has no quota limit, and the Mittwald Kundencenter shows its usage. Stripping attachments on the server to save space is ruled out: it breaks the source of truth, the local mirror (new hash), and phase 6.

## Rule candidates

None yet.
