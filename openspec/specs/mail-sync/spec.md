# mail-sync

## Purpose

Read-only sync of the shadow mailbox into a local store that mirrors it exactly, including deletions.

## Definitions

- **Location**: folder name as returned by the server, `UIDVALIDITY`, and UID.
- **Message**: one distinct raw source, identified by its SHA-256 hash.
- **Stored**: the complete raw file and its metadata record are both written.
- **Download**: fetching the full source of a message.

## Requirements

### Requirement: Read-only server access

The system SHALL NOT change server state and SHALL open every folder read-only.

#### Scenario: Unread message stays unread

- WHEN `sync` downloads a message without the `\Seen` flag
- THEN the message on the server still has no `\Seen` flag

#### Scenario: Only read-only commands

- WHEN `sync` runs
- THEN the server receives no `STORE`, `COPY`, `MOVE`, `EXPUNGE`, `APPEND`, `CREATE`, `DELETE`, `RENAME`, `SUBSCRIBE` or `UNSUBSCRIBE` command, and every folder is opened with `EXAMINE`

### Requirement: Secure connection

The system SHALL connect only via TLS with certificate verification and SHALL attempt the login once per run.

#### Scenario: Invalid certificate

- WHEN the server presents a certificate that fails verification
- THEN `sync` exits non-zero without sending credentials

#### Scenario: Authentication rejected

- WHEN the server rejects the login
- THEN `sync` exits non-zero with an authentication error after exactly one login attempt and changes nothing locally

### Requirement: Complete and incremental sync

The system SHALL download the message at every location in every selectable folder, including spam and trash folders, and on later runs only at locations not yet recorded.

#### Scenario: First run

- WHEN `sync` runs against an empty data directory
- THEN every message of every selectable folder is stored with all its locations

#### Scenario: New mail

- WHEN new messages arrived since the last run
- THEN `sync` downloads only those messages

#### Scenario: Nothing new

- WHEN nothing changed on the server since the last run
- THEN `sync` downloads no message

#### Scenario: Interrupted run

- WHEN the process is killed during a run, including while writing a raw file
- THEN no truncated raw file remains, and the next run stores the missing messages without storing any message twice

#### Scenario: Message expunged during run

- WHEN a listed message is expunged on the server before it is downloaded
- THEN no location is recorded for it and the run does not fail

#### Scenario: Non-ASCII folder name

- WHEN a folder name contains non-ASCII characters
- THEN its messages are synced and the location records the folder name as returned by the server

### Requirement: Raw message storage

The system SHALL store the raw source of every message byte-exact, with this metadata: `Message-ID` (first header, surrounding whitespace and angle brackets removed, empty counts as missing), date (`Date` header in UTC), sender address (first `From` address, lower-cased), subject (RFC 2047-decoded `Subject` header), and size (byte length of the raw file).

#### Scenario: Byte-exact copy

- WHEN a message containing 8-bit non-UTF-8 bytes, bare LF line endings and a NUL byte is stored
- THEN its raw file is identical to the source returned by the server

#### Scenario: Malformed headers

- WHEN a message has a missing or unparseable `Date`, `From`, `Subject` or `Message-ID` header
- THEN its raw source is stored and the affected fields are recorded as missing

### Requirement: Deduplication

The system SHALL store each distinct raw source once and SHALL record every location where it was found.

#### Scenario: Same raw source in two folders

- WHEN two folders contain byte-identical messages
- THEN one message is stored with two locations

#### Scenario: Same Message-ID, different raw source

- WHEN two locations hold messages with the same `Message-ID` but different raw sources
- THEN both messages are stored, each with its own location, and the run summary counts one `Message-ID` with several sources

### Requirement: Server mirror

The system SHALL remove a location when a complete listing of its folder no longer contains it, and SHALL delete a message locally once it has no location left, but only at the end of a run without errors.

#### Scenario: Message removed on the server

- WHEN a stored message is no longer present on the server
- THEN after a run without errors it is no longer stored locally

#### Scenario: Message moved between folders

- WHEN a stored message moved to another folder
- THEN it remains stored once, with only its new location

#### Scenario: Folder disappeared

- WHEN a folder recorded in a previous run is no longer listed by the server
- THEN its locations are removed, and messages without another location are deleted locally

#### Scenario: Folder listing fails

- WHEN listing the UIDs of a folder fails or is incomplete
- THEN no location of that folder is removed, no message is deleted in this run, the other folders are synced, and `sync` exits non-zero naming the folder

#### Scenario: Connection lost during run

- WHEN the connection to the server is lost during a run
- THEN `sync` stops, keeps every message stored so far, deletes no message, and exits non-zero

### Requirement: UIDVALIDITY change

The system SHALL treat a changed `UIDVALIDITY` of a folder as a renumbering of that folder.

#### Scenario: Folder renumbered

- WHEN the `UIDVALIDITY` of a folder differs from the stored value
- THEN the folder's locations are replaced by their new UIDs, no message is stored twice, and no message is deleted

#### Scenario: Renumbered folder, then nothing new

- WHEN `sync` ran once after a `UIDVALIDITY` change and runs again without changes on the server
- THEN the second run downloads no message

### Requirement: Rebuildable store

The system SHALL be able to rebuild the local store from the server alone.

#### Scenario: Data directory deleted

- WHEN the data directory is deleted and `sync` runs
- THEN the stored messages are exactly those on the server, each byte-identical to the server source, with all their locations

### Requirement: Run summary

The system SHALL end every `sync` run with a summary and SHALL exit with 0 only if the run had no errors.

#### Scenario: Summary printed

- WHEN `sync` finishes
- THEN it prints the number of downloaded messages, new locations, removed locations, deleted messages, `Message-ID`s with several sources, spam suspects, and errors

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

### Requirement: Configuration outside the repository

The system SHALL read the IMAP password from the macOS Keychain (service `yuc-mail-rag`, account = IMAP user) and all other settings from configuration that is not tracked by git.

#### Scenario: Missing configuration

- WHEN `sync` runs without IMAP host or user configured, or without a matching Keychain entry
- THEN it exits non-zero with an error naming what is missing and contacts no server

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
