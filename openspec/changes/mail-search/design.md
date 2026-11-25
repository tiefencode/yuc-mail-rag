# Design

## Context

The cache (`mail-sync`) holds `raw/<xx>/<sha>.eml` and `mail.db` with five header fields, locations and folders. Everything phase 2 needs beyond that (`In-Reply-To`, `References`, bulk headers, body parts, attachment names) is only in the raw files. `postal-mime` is already a dependency; `better-sqlite3` bundles SQLite with FTS5 and the `unicode61` and `trigram` tokenizers.

The coding agent cannot read the cache (`mail-data-isolation`). Every behaviour is therefore tested with synthetic messages built in the tests, and every command that touches real data runs in the developer's terminal. Only `eval` and the `sync` summary are designed to be readable by the agent.

## Goals / Non-Goals

**Goals:**
- Rebuilding the whole index is cheap and safe, so rules can change freely.
- Ranking weights are plain constants, changeable without a rebuild.
- Rules that need a rebuild carry a version number.

**Non-Goals:**
- A query language beyond FTS5's terms, prefixes and phrases.
- Incremental re-parsing of changed rules; any rules change rebuilds everything.
- Performance work: about 1,200 messages, growing by tens per day.

## Decisions

### 1. Separate `index.db` next to `mail.db`

The index lives in its own SQLite file in the data directory, and reads `mail.db` through a separate read-only connection.

- Deleting `index.db` is always safe; `mail.db` stays the sync mirror only.
- Alternative: tables inside `mail.db`. Rejected: a rebuild would write into the mirror, and a bug in indexing could damage sync state.

`index.db` holds a `meta` table (`rules_version`), a `messages` table (sha, thread id, category, date, sender, domain, subject, normalized subject, has-attachment, folders), `attachments` (sha, file name, extension), `refs` (sha, referenced Message-ID), and an FTS5 table.

### 2. Index update: diff by SHA, rebuild by version

An update computes the set of indexed messages from `mail.db` (messages with a location outside a spam folder), removes rows whose sha left that set, parses and inserts new shas, and then recomputes threads and suspects for the whole index. Threads and suspects are recomputed in full because one new message can merge two threads; at this size that takes milliseconds.

A constant `RULES_VERSION` in code covers segmentation, categories, threading and tokenizer. If `meta.rules_version` differs, the update drops and recreates all tables first. Any commit that changes those rules bumps the constant. No test can detect a forgotten bump, so it is a review checklist item in `tasks.md`.

`search`, `show`, `spam-check`, `testset` and `eval` call the update before reading, so the index is never stale, also when `sync` failed to update it. `sync` calls it at the end of a run (`mail-sync` delta).

### 3. One FTS5 table, three weighted columns

```
fts(own, attachments, secondary)   -- secondary = quoted text + signature
tokenize = 'unicode61 remove_diacritics 2'
rank = bm25(fts, 1.0, 1.0, 0.3)
```

- Quoted text stays searchable at 30 % weight: own replies exist almost only as quotes because sent mail is not captured.
- Signatures go into `secondary`: contact data stays findable ("who was the contact at X") without signatures dominating every search for a name.
- `remove_diacritics 2` folds `ü` to `u`; `ß` is not folded to `ss`. Accepted: the test set will show whether that matters.
- Alternative: `trigram` tokenizer, which finds parts of compound words (`vertrag` in `Vertriebsvertrag`). Deferred, not rejected: it triples the index and ranks worse on whole words. `vertrag*` covers prefixes now; whether a second trigram table pays off is decided by `eval` once the test set has about 10 entries (see Open Questions).
- Category ranking: final score = bm25 × factor, with factor 1.0 for correspondence and 0.5 for notification and bounce (bm25 is negative in SQLite, smaller is better; the factor shrinks the magnitude). Constants, no rebuild.

Thread ranking: the best (lowest) message score per thread wins; further matches in the same thread add nothing. That also stops one quote repeated in eight replies from counting eight times.

### 4. Body segmentation: line-based rules, German and English

Plain text from `postal-mime`; if absent, HTML converted by a small own converter: drop `script`/`style`, turn block elements and `<br>` into newlines, strip tags, decode named entities for Latin-1 and numeric entities. Alternative: the `html-to-text` package. Rejected for now: one more dependency for a search-only use; revisit if `show` output is unreadable for common senders.

Segmentation walks the lines once:
1. A forwarded-message marker switches to own text for the forwarded block (it is new information for this mailbox).
2. The first reply marker (attribution line `On … wrote:` / `Am … schrieb …:`, possibly wrapped over two lines; `-----Original Message-----`, `-----Ursprüngliche Nachricht-----`; a `From:`/`Von:` line followed within three lines by `Sent:`/`Gesendet:`) starts quoted text up to the end, except a later forwarded block.
3. Lines starting with `>` are quoted wherever they appear.
4. In own text, a `-- ` line starts the signature; `Sent from my iPhone` / `Von meinem iPhone gesendet` and similar device lines count as signature.

The rules are deliberately simple. Wrong splits only shift weight between columns; nothing is lost from the index.

### 5. Threads: union-find over Message-IDs, subject fallback for correspondence

Each message contributes its own `Message-ID` and every id in `In-Reply-To` and `References`; union-find joins all messages sharing any id. Ids of messages not in the cache (own sent replies) act as joints, which is what keeps conversations together without sent mail.

Messages still alone afterwards join an existing correspondence thread with the same normalized subject and the same sender address. Normalization strips repeated `Re:`, `AW:`, `Fwd:`, `Fw:`, `WG:` prefixes (also `Re[2]:`), lower-cases and collapses whitespace. Notifications and bounces never use the fallback: Discogs and PayPal subjects repeat across unrelated orders.

The thread id is the smallest sha in the thread, so it is stable across rebuilds as long as membership is.

### 6. Categories: rules in code, service and organization domains only

`src/categories.ts` lists notification senders (`bandcamp.com`, `paypal.de`, `paypal.com`, `discogs.com`, `orders.discogs.com`, `sumup.com`, `sumup.de`, `booking.com`, `dhl.de`, `dhl.com`, `fedex.com`, `google.com`, `instagram.com`, `spotify.com`, `wetransfer.com`, `winzip.com`, `cleverbridge.com`, the own shop address) and correspondence overrides (`gema.de`, `audioglobe.it`, `readymadedistribution.com`, `pakajo.world`). Order of checks: bounce, correspondence override, notification sender, bulk headers, default correspondence.

The lists contain only domains of companies and public bodies, which appear in the `stats` output the developer shared; no private addresses go into the repo. Alternative: a rules file in the data directory. Rejected: the agent could not maintain it, and these domains are not mail content.

### 7. Spam folders by name, configurable later

A folder is a spam folder when its last hierarchy segment (split on `.` and `/`) is `Spam` or `Junk`, case ignored; this also covers `INBOX.Import.Spam` from the one-off import. The IMAP special-use flag `\Junk` would be more exact, but the sync does not record it; adding it would change `mail-sync` for no observed need.

### 8. Spam suspects from headers only

Suspects use only metadata and headers of spam messages (`From`, `Subject`, `In-Reply-To`, `References`); spam bodies are never parsed or indexed. The known-id set for `reply` is every `Message-ID` and every referenced id of indexed messages, so a reply to an own sent mail that the counterpart also referenced is caught.

### 9. CLI shape

All commands go through `src/cli.ts` and `pnpm <command>` scripts: `search`, `show`, `spam-check`, `testset`, `eval`. Each command's logic is a function taking the data directory and an `out` callback, like `runStats`, so tests call it directly.

`search` output, one block per thread:

```
1  1a2b3c4d  2025-03-14  band@example.com  correspondence  5 msgs 2025-02-01..2025-03-20
   Re: Trackliste und Layout
   ... die finale [Trackliste] kommt morgen ...
```

`show` prints `raw: <absolute path>` per message, so the developer can run `open <path>` to view it in Apple Mail.

### 10. Test set as JSON in the data directory

`testset.json`: `{ "nextId": 5, "entries": [{ "id": 1, "question": "...", "query": "...", "expected": ["<sha>"] }] }`. Written via temp file and rename. `eval` reuses the search function with default options and limit 20.

## Risks / Trade-offs

- [Quote detection misses a client's format, so its quotes rank as own text] → `show` displays own text and the quoted-line count, so the developer sees misplaced splits; new markers are a rules-version bump.
- [Subject fallback merges unrelated threads from one sender, e.g. repeated "Promo"] → limited to identical sender address and correspondence; visible in `show`.
- [Category lists drift as new services appear] → notifications still rank, only lower; the developer reports misfiled senders and the list grows.
- [The agent cannot verify behaviour on real mail] → synthetic test messages per mail-client format; `eval` numbers as the only feedback channel from real data.
- [`sync` gets slower by the index update] → milliseconds for threads and suspects; parsing only new messages.
- [Forgotten `RULES_VERSION` bump leaves an index built with old rules] → checklist item in tasks; the developer can always delete `index.db`.
- [Spam purge on the server is shorter than the sync interval] → outside the code; the developer checks the Mittwald setting (proposal, Impact).

## Migration Plan

None: `index.db` and `testset.json` are new files, created on first use. Rollback means deleting both.

## Open Questions

- Does a second FTS5 table with the `trigram` tokenizer improve `eval` enough to justify it? Answered with the first ~10 test entries; adding it changes neither the specs nor the commands.
- Are the initial weights (0.3 for quotes, 0.5 for notifications) right? Tuned with `eval`; constants only.
