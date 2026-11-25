# Tasks

Every group writes its tests first from the scenarios it names and shows them failing before the code exists. Tests use synthetic messages only (extend `eml()` in `src/testing.ts`); the agent never reads the cache.

## 1. Setup

- [ ] 1.1 Get `better-sqlite3` working in the worktree (the developer runs `pnpm install` in their terminal if the sandbox blocks the native build) and verify `pnpm test` passes on the unchanged code

## 2. Parsing and segmentation (`mail-search`)

- [ ] 2.1 Write tests for "HTML-only message", "Unparseable message", all scenarios of "Quoted text and signatures" except "Match only in a quote", and attachment names from "Attachment names searchable"; verify they fail
- [ ] 2.2 Parse a raw message into headers (`Message-ID`, `In-Reply-To`, `References`, `Auto-Submitted`, `List-Unsubscribe`, `Precedence`, content type), plain text (HTML converted when missing) and attachment names; verify the 2.1 parsing tests pass
- [ ] 2.3 Segment bodies into own text, quoted text and signature with the German and English markers of design decision 4; verify the 2.1 segmentation tests pass

## 3. Categories (`mail-search`)

- [ ] 3.1 Write tests for every scenario of "Categories"; verify they fail
- [ ] 3.2 Implement the category rules and lists of design decision 6 in `src/categories.ts`; verify the 3.1 tests pass

## 4. Threads (`mail-search`)

- [ ] 4.1 Write tests for every scenario of "Threads", including subject normalization of `Re[2]:`, `AW:`, `WG:` and nested prefixes; verify they fail
- [ ] 4.2 Implement union-find over Message-IDs with the correspondence-only subject fallback of design decision 5; verify the 4.1 tests pass

## 5. Index (`mail-search`)

- [ ] 5.1 Write tests for "Index derived from the cache only", "Index follows the cache", "Index rebuilt when rules change" and spam folder naming (`INBOX.Spam`, `INBOX.Import.Junk`, `Spam`); verify they fail
- [ ] 5.2 Create `index.db` with the schema of design decision 1, reading `mail.db` read-only, and the update of design decision 2 (diff by SHA, full rebuild on `RULES_VERSION` change, threads recomputed after each update); verify the 5.1 tests pass and a test asserts `mail.db` and raw files are byte-identical after indexing

## 6. Search (`mail-search`)

- [ ] 6.1 Write tests for "Match only in a quote", "Attachment names searchable", "Ranking", "Search command" and "Search filters"; verify they fail
- [ ] 6.2 Implement the weighted FTS5 query, category factor, best-message-per-thread grouping and the filters of design decision 3; verify the 6.1 ranking and filter tests pass
- [ ] 6.3 Add `pnpm search` to `src/cli.ts` and `package.json` with the output of design decision 9, `--limit` and filter validation; verify the 6.1 command tests pass

## 7. Show (`mail-search`)

- [ ] 7.1 Write tests for every scenario of "Show command", including `--full`; verify they fail
- [ ] 7.2 Add `pnpm show <reference> [--full]`; verify the 7.1 tests pass

## 8. Spam review (`spam-review`)

- [ ] 8.1 Write tests for every scenario of "Suspect signals", "Free-mail domains give no domain signal", "Suspect count" and "Spam check command"; verify they fail
- [ ] 8.2 Compute suspects from headers of spam messages during each index update (design decision 8); verify the signal and count tests pass
- [ ] 8.3 Add `pnpm spam-check`; verify the command tests pass

## 9. Sync integration (`mail-sync`)

- [ ] 9.1 Write tests for "Summary printed" (spam suspects line) and every scenario of "Index update after sync"; extend the existing summary tests; verify they fail
- [ ] 9.2 Update the index at the end of every run that reached the cache and add the suspects line to the summary; verify the 9.1 tests and all existing sync tests pass

## 10. Test set and evaluation (`search-evaluation`)

- [ ] 10.1 Write tests for every scenario of "Record test entries", "Maintain the test set" and "Evaluation", including a check that `eval` output holds no subject, sender or body text from the fixtures; verify they fail
- [ ] 10.2 Implement `testset.json` handling (design decision 10) and `pnpm testset add|expect|list|remove`; verify the record and maintain tests pass
- [ ] 10.3 Implement `pnpm eval`; verify the evaluation tests pass

## 11. Documentation

- [ ] 11.1 Update `README.md` with the new commands and a short test set workflow, and `CLAUDE.md` so the new commands are listed as run by the developer; verify every documented command matches `src/cli.ts` usage output
- [ ] 11.2 Add decision log entries to `docs/architecture.md` (separate `index.db`, spam folders excluded with suspect report, category lists in code, weights and tokenizer pending `eval`); verify `pnpm lint`, `pnpm typecheck`, `pnpm test` pass

## 12. Integration on real data

- [ ] 12.1 Check before committing rule changes that `RULES_VERSION` was bumped wherever segmentation, categories, threading or tokenizer changed during this change; verify by reading the branch diff
- [ ] 12.2 The developer runs `pnpm sync`, `pnpm search` with a few queries, `pnpm show` and `pnpm spam-check` in their terminal and reports problems; verify the sync summary shows the suspects line and no errors

## Workflow follow-up

- The developer checks the spam purge period of the shadow mailbox in the Mittwald Kundencenter.
- The developer records about 10 test entries; then `pnpm eval` gives the baseline and decides the trigram question from the design.
- Review, `/opsx:archive mail-search`, fast-forward `main`.
