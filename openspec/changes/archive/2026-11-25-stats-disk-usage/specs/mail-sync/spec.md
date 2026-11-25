# Spec Delta

## MODIFIED Requirements

### Requirement: Storage statistics

The system SHALL report the number of stored messages and their total size, overall and per sender address, counting each message once with the size of its raw file. It SHALL also report the disk space allocated by the data directory, overall and split into raw files and database.

#### Scenario: Stats per sender

- **WHEN** `stats` runs
- **THEN** it prints the total message count and bytes, and the senders ranked by bytes descending, ties by sender address ascending, each with message count and bytes

#### Scenario: Sender address case

- **WHEN** two messages have sender addresses differing only in letter case
- **THEN** `stats` lists them under one sender

#### Scenario: Message without sender

- **WHEN** a message has no parseable `From` address
- **THEN** `stats` counts it under the sender `(unknown)`

#### Scenario: Empty store

- **WHEN** `stats` runs on an empty or missing data directory
- **THEN** it prints zero messages and zero bytes and exits 0

#### Scenario: Disk usage

- **WHEN** `stats` runs
- **THEN** it prints the disk space allocated by all files in the data directory, and separately by the raw files under `raw/` and by the database files `mail.db*`, counting allocated blocks rather than file lengths
