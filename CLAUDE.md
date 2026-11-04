# yuc-mail-rag

Local, evidence-based search over the email correspondence of Young & Cold Records. Architecture and decision log: `docs/architecture.md`.

## Spec workflow (OpenSpec-light, no OpenSpec tooling)

- `openspec/specs/<capability>/spec.md` is the living source of truth for current behavior.
- Non-trivial changes get `openspec/changes/<change-id>/` with `proposal.md` (why, scope, non-goals, affected requirements) and `tasks.md`; `design.md` only for real design decisions.
- No delta specs: edit the living spec directly on the feature branch. The git diff is the delta.
- Small fixes skip the change folder and update spec and code in the same commit.
- After merge, move the change folder to `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`.
- A proposal is approved by the developer before implementation starts.

### Spec format

```markdown
### Requirement: <name>
The system SHALL <behavior>.

#### Scenario: <name>
- WHEN <condition>
- THEN <expected outcome>
```

Scenarios use `####` headings. Each scenario maps to at least one test.

## Data rules

- The shadow mailbox on Mittwald is the source of truth. The local data directory is a derived cache and must be rebuildable from IMAP at any time.
- Never modify server state (no flag changes, moves, deletes, appends).
- Credentials and mail data are never committed.
