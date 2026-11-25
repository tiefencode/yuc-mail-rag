# Architecture

## Goal

Make the email knowledge of Young & Cold Records permanently accessible and searchable: natural-language questions, answers backed by verifiable source messages, and an explicit "no evidence" when sources are missing. Knowledge retrieval, not certified archiving.

## Data flow

```
Incoming mail → info@ → active mailbox (cleaned regularly)
                      ↘ shadow mailbox "Schattenarchiv" (Mittwald, source of truth)
                                ↓ IMAP, read-only
                        local cache on the Mac (raw messages + metadata + indexes)
                                ↓
                        search → local LLM → answer with citations
```

- Data flows only from Mittwald to the Mac. The Mac is never the only copy.
- The local cache includes full text and raw messages; full-text search, offline use, and index rebuilds depend on it.

## Phases

Order and scope are revised as results come in.

1. **Mail sync**: shadow mailbox → local raw-message cache with metadata.
2. **Search without LLM**: parsing, quote/signature segmentation, threads, category rules, full-text search; measured against a set of real test questions.
3. **Answers**: local LLM over retrieved threads, citations verified in code.
4. **Hybrid retrieval**: embeddings, only if the test set shows a measurable gain.
5. **Sent mail**: progressive add-on.
6. **Attachments and context**: document text, entity aliases, extraction of commitments. Starts by deciding whether large attachments stay on the server and are fetched on demand (see `docs/ideas.md`).

## Known limitations

- Sent mail is not captured by forwarding. Partial recovery via quotes in replies; dedicated capture is deferred.
- Mail deleted from the active mailbox before forwarding was set up is lost unless still present elsewhere.

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-04 | Capture incoming mail via Mittwald forwarding of info@ to the additional mailbox "Schattenarchiv" (unlimited quota). Delivery tested successfully. | Server-side copy at delivery time, no extra cost, independent of the Mac. Sieve or cron alternatives only if forwarding fails. |
| 2026-11-04 | Shadow mailbox is the source of truth; the Mac keeps a rebuildable local cache including full text. | Full-text search, LLM context, and index rebuilds need the text; on-demand IMAP fetching is slow and offline-incapable. |
| 2026-11-04 | Sent mail capture is deferred. | Regular incoming mail has priority. |
| 2026-11-04 | The local store mirrors the shadow mailbox, including deletions; messages are identified by the SHA-256 of their raw source. | The shadow mailbox is the only source of truth; hash identity loses no message even when `Message-ID`s repeat. |
| 2026-11-04 | Specs follow OpenSpec-light without tooling, defined in the user skill `openspec-light`; drafts are refined in a Claude Doc with interview rounds before they enter the repo. | Living capability specs with minimal overhead; one workflow across projects. Superseded by the next entry. |
| 2026-11-04 | Specs and changes use OpenSpec with its CLI and the `/opsx` commands for Claude Code (`openspec init`); the `openspec-light` skill is deleted. See `CLAUDE.md`. | `openspec validate` checks the specs, and the change flow comes with the tool instead of a hand-maintained skill. |
| 2026-11-04 | One-off copy of the mail still in the active mailbox (info@, `p266187p3`) into the shadow mailbox with `imapsync` 2.314: all folders including Sent and Trash, into `INBOX.Import.<original folder>`; duplicates of mail forwarded since today are accepted. 217 messages (78 MiB) in 18 folders copied, the first one in a single-folder test run; the IMAP log shows no write command to the active mailbox. Sent (13) and Trash (72) had been emptied in the active mailbox minutes before the copy and are missing. | Rescues mail that is being cleaned out of the active mailbox; an external tool keeps the project's own code read-only. The `Import` tree keeps provenance apart from forwarded mail. |
| 2026-11-04 | The local cache moves from `data/` to `data.noindex/`, and `.claude/settings.json` denies Claude reading it (`Read` and any `Bash` command naming the directory). FileVault, Mittwald 2FA and rotating the PINs found in mail are the developer's tasks outside the repo. | The mail contains PINs and other secrets. The `.noindex` suffix keeps Spotlight from copying mail text into its index; the deny rules keep mail content out of the Anthropic API. The Bash rule matches the command text only and is a guard against accidents, not a security boundary. |
| 2026-11-05 | The Claude Code sandbox (macOS Seatbelt) denies every Claude shell command and its child processes reading `data.noindex/`, with no unsandboxed retry and no unsandboxed start; `Edit` deny rules keep Claude off `.claude/settings*.json`; the `Bash(*data.noindex*)` text rule is removed. Only Claude Code is restricted: LM Studio and commands the developer runs keep full access, and `sync`/`stats` move to the developer's terminal. Canary test: `cat data*/CANARY.txt` printed the marker under the old rules; with the sandbox, glob, `find -exec`, `grep -r`, `node` and a requested unsandboxed run all fail with `EPERM`, and Read and settings edits are denied; Grep and Glob are not offered as tools, so search runs through the sandboxed shell. The built-in browser opens local files for the developer, but its page tools refuse them, so the content does not reach Claude. Accepted residual risk: Claude's file tools run outside the sandbox and could plant hooks or code that later runs with full rights; the developer reviews diffs before running project commands against the cache. | The text rule was bypassable by accident (globs, recursive search, scripts). The sandbox enforces the boundary in the kernel against accidental reads and injected instructions. A separate macOS user was rejected: a second keychain and `sudoers` entries cost more than they add over the sandbox plus permission rules. |
