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
6. **Attachments and context**: document text, entity aliases, extraction of commitments.

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
