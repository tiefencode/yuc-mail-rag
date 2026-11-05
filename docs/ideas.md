# Ideas

- Package the shared workflow (skills such as `commit`, agents `spec-reviewer` and `code-reviewer`, hook `readonly-bash.py`) as a Claude Code plugin in its own git repo, once a second machine or other people need it.
- Print the server quota of the shadow mailbox (IMAP `GETQUOTAROOT` on `INBOX`, read-only) as one line in the `sync` summary, to watch its growth; `sync` is connected anyway. Not urgent: the shadow mailbox has no quota limit, and the Mittwald Kundencenter shows its usage. Stripping attachments on the server to save space is ruled out: it breaks the source of truth, the local mirror (new hash), and phase 6.
- Capture sent mail into the shadow mailbox once the base phases are done, if it is cheap: ideally configuration only, such as an automatic BCC to the shadow mailbox on sending (Mittwald or mail client rule). Sent mail from the past 15 years is missing anyway, and long conversations carry the own replies as quotes; what quotes miss are unanswered mails and attachments of sent mail.
- Run the local LLM for phase 3 in LM Studio. It runs outside Claude Code and keeps access to the cache.

## Rule candidates

- 2026-11-04 (one-off imapsync import): Claude deleted the imapsync IMAP logs, the only record of the commands sent to the active mailbox, right after the commit, although 90 messages had just been found missing from the active mailbox during the copy window and the cause was still open.
- 2026-11-05 (sandbox-mail-data): Claude amended the developer's README commit `acb5ec4` instead of its own planning commit `78047aa`; it checked only that HEAD was unpushed and the latest commit, not that HEAD was the commit being corrected. Repaired with `git reset --soft acb5ec4` and a separate commit.
