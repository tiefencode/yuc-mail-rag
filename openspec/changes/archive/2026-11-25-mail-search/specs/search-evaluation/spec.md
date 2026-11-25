# Spec Delta

## Purpose

Measures search quality against real questions the developer records, so changes to ranking, rules or tokenization are judged by numbers; the measurement prints no mail content, so the coding agent can read it.

## ADDED Requirements

### Requirement: Record test entries

`testset add --query <query> --pick <reference> [--question <text>]` SHALL run the search for the query, require the reference to identify a message in the results, and append an entry (id, question, query, expected messages by SHA-256) with the next free id to `testset.json` in the data directory, which git never tracks. `testset expect <id> <reference>` SHALL add another expected message to an entry.

#### Scenario: Add an entry

- **WHEN** `testset add --query "trackliste album" --pick 1a2b3c4d --question "Welche Trackliste hat die Band geschickt?"` runs and `1a2b3c4d` is in the results
- **THEN** the test set gains an entry with a new id, the question, the query and that message, and the command prints the id

#### Scenario: Pick not among the results

- **WHEN** the reference identifies no message in the results for the query
- **THEN** the test set is unchanged and the command exits non-zero

#### Scenario: Question omitted

- **WHEN** `--question` is not given
- **THEN** the entry stores the query as its question

### Requirement: Maintain the test set

`testset list` SHALL print every entry with id, question, query and expected references; `testset remove <id>` SHALL delete one entry. Ids SHALL never be reused.

#### Scenario: Remove an entry

- **WHEN** entry 3 is removed and a new entry is added
- **THEN** the new entry does not get id 3

### Requirement: Evaluation

`eval` SHALL run every entry's query with default options and print the number of entries, hit@1, hit@5, hit@10 and the mean reciprocal rank, followed by one line per entry with its id and rank: the position of the first result thread containing an expected message, or `-` when none is among the first 20. Its output SHALL contain no question, query, subject, sender or message text.

#### Scenario: Metrics

- **WHEN** the test set holds four entries with ranks 1, 3, 12 and none
- **THEN** `eval` prints 4 entries, hit@1 0.25, hit@5 0.50, hit@10 0.50 and MRR 0.35 ((1 + 1/3 + 1/12 + 0) / 4, rounded to two decimals)

#### Scenario: Expected message gone

- **WHEN** no expected message of an entry is indexed any more
- **THEN** that entry's line says `gone`, the entry counts as a miss, and the number of gone entries is printed

#### Scenario: Empty test set

- **WHEN** the test set is missing or empty
- **THEN** `eval` prints 0 entries and exits 0

#### Scenario: Content-free output

- **WHEN** `eval` runs
- **THEN** its output consists of digits, metric names, `gone` and `-` only, besides fixed labels
