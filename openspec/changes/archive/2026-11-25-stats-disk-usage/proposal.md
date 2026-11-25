# Proposal

## Why

The local cache grows by an estimated 2–3 GB per year, mostly through large attachments. Whether large attachments should stay on the server (see `docs/ideas.md`) depends on how much disk the cache really takes; `stats` shows only the summed raw message sizes, not the database or the space allocated on disk.

## What Changes

- `stats` prints one more line with the disk space the data directory allocates, split into raw files and database.

## Capabilities

### Modified Capabilities

- `mail-sync`: the storage statistics requirement gains a disk usage scenario.

## Impact

- `src/stats.ts`, `src/types.ts`, `src/stats.test.ts`.
