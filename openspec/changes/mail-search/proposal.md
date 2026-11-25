# Proposal

## Why

Phase 1 mirrors the shadow mailbox into a local cache (1188 messages at the last `stats`), but nothing can search it yet. Phase 2 of `docs/architecture.md` makes the correspondence findable without an LLM and builds the test set that later phases (answers, embeddings) are measured against. It also closes a capture gap: spam false positives in the shadow mailbox are invisible to the developer and are lost if the server purges its spam folder.

## What Changes

- New derived search index next to the cache, built from the raw messages only: own text, quoted text and signatures, attachment file names, threads and a category per message. It can be deleted and rebuilt at any time and rebuilds itself when its rules change.
- New command `search`: full-text search in German and English, one result per thread with the best matching message marked, filters by sender or domain, period, category and attachment. Correspondence ranks before notifications (Bandcamp, PayPal, Discogs, own shop, bounces); quoted text counts, but less than new text. GEMA and distributors count as correspondence.
- New command `show`: prints a thread from a search result, with the path of each raw file so it can be opened in a mail client.
- Spam folders are left out of the index. A new check reports spam-folder messages that look like correspondence (reply to a known thread, known sender, known organization domain, known thread subject); command `spam-check` lists them so the developer can move them out of spam on the server by hand.
- New test set and evaluation: command `testset` records a question, the search query and the expected message from a search result; command `eval` reports hit rates and ranks per question id, without mail content. The test set lives in the data directory.
- `sync` updates the index after every run and reports the number of spam suspects in its summary.

Out of scope: text inside attachments and OCR (phase 6), sent mail (no capture planned; own replies are found through quotes), LLM answers (phase 3), embeddings (phase 4), moving or flagging anything on the server.

## Capabilities

### New Capabilities

- `mail-search`: the derived index and the commands `search` and `show`: segmentation, threads, categories, ranking, filters, and keeping the index in step with the cache.
- `spam-review`: detecting likely false positives in spam folders and reporting them for manual rescue.
- `search-evaluation`: recording test questions with their expected messages and measuring search quality against them.

### Modified Capabilities

- `mail-sync`: the run summary adds the number of spam suspects, and a run ends by updating the search index.

## Impact

- Code: new modules for parsing, segmentation, threading, categories, index, search, spam check and evaluation; `src/cli.ts` gains the commands `search`, `show`, `spam-check`, `testset`, `eval`; `src/sync.ts` summary gains one line.
- Data: new files `index.db` and `testset.json` in the data directory; `mail.db` and `raw/` stay read-only for everything except `sync`.
- Dependencies: none new; `better-sqlite3` ships SQLite with FTS5, `postal-mime` parses MIME.
- Docs: `README.md` usage, `CLAUDE.md` command list (the new commands read the cache, so the developer runs them), decision log in `docs/architecture.md`.
- Outside the repo: the developer checks in the Mittwald Kundencenter whether and after how many days the shadow mailbox purges spam; the sync interval must stay below that period.
