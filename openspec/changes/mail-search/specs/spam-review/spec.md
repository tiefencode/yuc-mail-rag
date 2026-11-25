# Spec Delta

## Purpose

Finds messages in spam folders of the shadow mailbox that look like real correspondence, so the developer can move them out of spam on the server before they are purged. Spam folders and indexed messages are defined in the `mail-search` capability.

## ADDED Requirements

### Requirement: Suspect signals

The system SHALL mark a spam message (every location in a spam folder) as suspect when it has at least one signal, judged against indexed correspondence messages: `reply` (its `In-Reply-To` or `References` names a `Message-ID` known from an indexed thread), `sender` (its address sent correspondence), `domain` (its domain sent correspondence) or `subject` (its normalized subject equals a correspondence thread's).

#### Scenario: Reply to a known thread

- **WHEN** a spam message has `In-Reply-To` naming the `Message-ID` of an indexed message
- **THEN** it is a suspect with signal `reply`

#### Scenario: Known sender

- **WHEN** a spam message comes from an address that sent an indexed correspondence message
- **THEN** it is a suspect with signal `sender`

#### Scenario: Known organization domain

- **WHEN** a spam message comes from a new address at a domain that sent an indexed correspondence message
- **THEN** it is a suspect with signal `domain`

#### Scenario: Free-mail domain alone

- **WHEN** a spam message comes from a new `gmail.com` address with no other signal, and other `gmail.com` addresses sent correspondence
- **THEN** it is not a suspect

#### Scenario: Known sender of notifications only

- **WHEN** a spam message comes from an address whose indexed messages are all notifications
- **THEN** that address gives no `sender` signal

#### Scenario: Unknown spam

- **WHEN** a spam message has none of the signals
- **THEN** it is not a suspect

### Requirement: Free-mail domains give no domain signal

The `domain` signal SHALL NOT apply to domains of public mail providers: `gmail.com`, `googlemail.com`, `gmx.de`, `gmx.net`, `web.de`, `t-online.de`, `posteo.de`, `freenet.de`, `outlook.com`, `icloud.com`, `proton.me`, `protonmail.com`, and every `hotmail.*`, `yahoo.*` and `yandex.*` domain.

#### Scenario: Free-mail provider

- **WHEN** a spam message comes from a new `web.de` address and other `web.de` addresses sent correspondence
- **THEN** it has no `domain` signal

### Requirement: Suspect count

The system SHALL compute the suspects whenever the index is updated, and SHALL report their number without any mail content.

#### Scenario: Count after an update

- **WHEN** the index is updated and the cache holds two suspects
- **THEN** the update reports 2 spam suspects

#### Scenario: Rescued message

- **WHEN** a suspect is moved out of the spam folder on the server and `sync` runs
- **THEN** it is no longer a suspect and becomes an indexed message

### Requirement: Spam check command

`spam-check` SHALL list every suspect, newest first, with reference, date, sender, subject, folder and signals, and SHALL print that there are none when there are none. It SHALL NOT change anything on the server.

#### Scenario: List suspects

- **WHEN** `spam-check` runs and there are suspects
- **THEN** it prints one line per suspect with its signals, and exits 0

#### Scenario: No suspects

- **WHEN** `spam-check` runs and there are no suspects
- **THEN** it prints that no spam suspects were found and exits 0
