# Spec Delta

## Purpose

Makes the correspondence in the local mail cache searchable without an LLM: a derived index over the raw messages and terminal commands that find threads and show them, ranking correspondence before automated notifications.

## ADDED Requirements

### Requirement: Index derived from the cache only

The system SHALL build a search index in the data directory from the raw messages and metadata in the cache alone, SHALL NOT modify the cache, and SHALL contact no server while indexing or searching.

#### Scenario: Cache unchanged

- **WHEN** the index is built and searched
- **THEN** every raw file and the metadata database in the cache are byte-identical to before

#### Scenario: Index deleted

- **WHEN** the index file is deleted and `search` runs
- **THEN** the index is rebuilt from the cache and the results equal those before the deletion

### Requirement: Index follows the cache

After every update, the index SHALL contain exactly the cache's messages with at least one location outside a spam folder (indexed messages), each with its current folders. A spam folder is a folder whose last hierarchy segment is `Spam` or `Junk`, case ignored.

#### Scenario: Message deleted by sync

- **WHEN** a message is deleted from the cache and the index is updated
- **THEN** `search` no longer returns it

#### Scenario: Message moved into a spam folder

- **WHEN** a message's only location moves into a spam folder and the index is updated
- **THEN** `search` no longer returns it

#### Scenario: Message rescued from spam

- **WHEN** a message's only location moves from a spam folder to another folder and the index is updated
- **THEN** `search` returns it

### Requirement: Index rebuilt when rules change

The system SHALL record in the index the version of the rules it was built with, and SHALL rebuild the index completely before the next search or update when that version differs from the current one.

#### Scenario: Rules changed

- **WHEN** the index was built with an older rules version and `search` runs
- **THEN** the index is rebuilt with the current rules before results are printed

### Requirement: Body text extraction

The system SHALL index the plain-text body of every message, and SHALL convert the HTML body to text when a message has no plain-text body.

#### Scenario: HTML-only message

- **WHEN** a message has only an HTML body containing a word inside markup and an HTML entity
- **THEN** `search` finds the message by that word and by the decoded entity character

#### Scenario: Unparseable message

- **WHEN** a raw message cannot be parsed as MIME
- **THEN** it is indexed by its stored subject and sender, and indexing continues with the next message

### Requirement: Quoted text and signatures

The system SHALL separate each body into own text (neither quoted nor signature), quoted text and signature, and SHALL rank a match in quoted text or signature below an equal match in own text. German and English quote markers SHALL both be recognized.

#### Scenario: Quote marker lines

- **WHEN** a message body has lines starting with `>`
- **THEN** those lines are quoted text

#### Scenario: Attribution lines

- **WHEN** a body contains a line such as `On <date>, <name> wrote:` or `Am <date> schrieb <name>:` followed by text
- **THEN** that line and the text after it are quoted text

#### Scenario: Outlook-style reply header

- **WHEN** a body contains `-----Original Message-----`, `-----Ursprüngliche Nachricht-----`, or a header block starting with `From:`/`Von:` followed by `Sent:`/`Gesendet:`
- **THEN** that block and the text after it are quoted text

#### Scenario: Signature delimiter

- **WHEN** own text contains a line consisting of `-- `
- **THEN** the text after it up to the quoted text is signature

#### Scenario: Match only in a quote

- **WHEN** message A contains a term in its own text and message B contains it only in quoted text, in otherwise comparable messages of the same category
- **THEN** `search` ranks the thread of A above the thread of B

#### Scenario: Forwarded message

- **WHEN** a body contains a forwarded message introduced by `Begin forwarded message:`, `Anfang der weitergeleiteten Nachricht:` or `---------- Forwarded message ---------`
- **THEN** the forwarded content counts as own text

### Requirement: Attachment names searchable

The system SHALL index the file name of every attachment, and SHALL NOT index attachment content.

#### Scenario: Search by file name

- **WHEN** a message without a matching body has an attachment named `Trackliste_final.pdf`
- **THEN** `search Trackliste` returns its thread

#### Scenario: Attachment content

- **WHEN** a text attachment contains a word that appears nowhere else in the message
- **THEN** `search` does not return the message for that word

### Requirement: Threads

The system SHALL group indexed messages into threads: messages sharing a `Message-ID` through `In-Reply-To` or `References` belong to one thread, also when the connecting message is not in the cache. A message without such links SHALL join a correspondence thread with the same normalized subject and the same sender address.

#### Scenario: Reply to a missing sent message

- **WHEN** message A has `Message-ID` a, and message B has `References: <a> <s>` where s is not in the cache
- **THEN** A and B are in one thread

#### Scenario: Subject fallback

- **WHEN** two correspondence messages from the same sender have no linking headers and subjects that differ only by `Re:`, `AW:`, `Fwd:` or `WG:` prefixes, case and surrounding whitespace
- **THEN** they are in one thread

#### Scenario: No subject fallback for notifications

- **WHEN** two notification messages share sender and subject but have no linking headers
- **THEN** they are in separate threads

### Requirement: Categories

The system SHALL assign each indexed message one category out of `correspondence`, `notification` and `bounce`: `bounce` for delivery status reports and `mailer-daemon` senders; `notification` for messages from known service senders or with `Auto-Submitted` other than `no`, `List-Unsubscribe`, or `Precedence: bulk|list`; otherwise `correspondence`. Senders on the correspondence list SHALL be `correspondence` regardless of these headers.

#### Scenario: Service sender

- **WHEN** a message comes from `noreply@bandcamp.com`
- **THEN** its category is `notification`

#### Scenario: Bulk header

- **WHEN** a message from an unknown sender has a `List-Unsubscribe` header
- **THEN** its category is `notification`

#### Scenario: Collecting society with bulk header

- **WHEN** a message from a `gema.de` address has a `List-Unsubscribe` header
- **THEN** its category is `correspondence`

#### Scenario: Bounce

- **WHEN** a message comes from a `mailer-daemon@` address or has content type `multipart/report; report-type=delivery-status`
- **THEN** its category is `bounce`

#### Scenario: Personal mail

- **WHEN** a message from a band's personal address has none of these headers
- **THEN** its category is `correspondence`

### Requirement: Ranking

`search` SHALL rank threads by the relevance of their best matching message, and SHALL rank a `notification` or `bounce` thread below a `correspondence` thread of equal text relevance.

#### Scenario: Correspondence before notification

- **WHEN** a correspondence message and a notification message contain the search term equally often in comparable own text
- **THEN** the correspondence thread is listed first

#### Scenario: One result per thread

- **WHEN** five messages of one thread match the query
- **THEN** `search` lists the thread once, with the best matching message marked

### Requirement: Search command

`search <query>` SHALL print the matching threads in rank order, at most 20 unless `--limit <n>` is given. Each result SHALL show the reference (first 8 hexadecimal characters of the SHA-256) of the best matching message, its date, sender, subject and category, the thread's message count and date range, and a snippet of the matching text. Terms SHALL match case- and diacritic-insensitively, a term ending in `*` SHALL match as prefix, and a quoted phrase SHALL match as phrase.

#### Scenario: No match

- **WHEN** no indexed message matches the query
- **THEN** `search` prints that nothing was found and exits 0

#### Scenario: Diacritics

- **WHEN** a message contains `Müller` and the query is `muller` or `MÜLLER`
- **THEN** the message matches

#### Scenario: Prefix

- **WHEN** a message contains `Vertriebsvertrag` and the query is `vertrieb*`
- **THEN** the message matches

#### Scenario: Barcode

- **WHEN** a message contains the 13-digit number `4260123456789` and the query is that number
- **THEN** the message matches

### Requirement: Search filters

`search` SHALL restrict results by `--from <address-or-domain>`, `--since <date>`, `--until <date>`, `--category <category>` and `--attachment [<extension>]`, combined with AND. Dates SHALL be accepted as `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, with `--until` inclusive of the whole period given.

#### Scenario: Domain filter

- **WHEN** `search vertrag --from audioglobe.it` runs
- **THEN** only threads whose matching message comes from an address at `audioglobe.it` are listed

#### Scenario: Period filter

- **WHEN** `search vertrag --since 2024 --until 2024-06` runs
- **THEN** only matching messages dated from 2024-01-01 through 2024-06-30 count

#### Scenario: Attachment filter

- **WHEN** `search layout --attachment pdf` runs
- **THEN** only matching messages with at least one attachment ending in `.pdf` count

#### Scenario: Invalid filter value

- **WHEN** `search x --since 2024-13` or `--category foo` runs
- **THEN** `search` exits non-zero with an error naming the invalid value

### Requirement: Show command

`show <reference>` SHALL print the thread containing that message in date order: for each message its reference, date, sender, subject, category, attachment names, own text, the number of quoted lines, and the path of its raw file. `--full` SHALL print quoted text and signatures as well.

#### Scenario: Show a thread

- **WHEN** `show` runs with a reference printed by `search`
- **THEN** it prints every message of that thread with its raw file path

#### Scenario: Unknown or ambiguous reference

- **WHEN** the reference matches no indexed message, or more than one
- **THEN** `show` exits non-zero and says which
