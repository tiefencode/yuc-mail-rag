# Spec Delta

## MODIFIED Requirements

### Requirement: Run summary

The system SHALL end every `sync` run with a summary and SHALL exit with 0 only if the run had no errors.

#### Scenario: Summary printed

- WHEN `sync` finishes
- THEN it prints the number of downloaded messages, new locations, removed locations, deleted messages, `Message-ID`s with several sources, spam suspects, and errors

## ADDED Requirements

### Requirement: Index update after sync

The system SHALL update the search index at the end of every `sync` run that reached the cache, also when the run had errors, and SHALL count a failed index update as an error of the run.

#### Scenario: Index updated

- **WHEN** `sync` stores a new message outside a spam folder
- **THEN** `search` finds it right after the run, without rebuilding the index first

#### Scenario: Index update fails

- **WHEN** the index cannot be updated at the end of a run
- **THEN** the summary lists the index error, the cache keeps every stored message, and `sync` exits non-zero

#### Scenario: Run without connection

- **WHEN** `sync` cannot connect or log in
- **THEN** the index is not touched
