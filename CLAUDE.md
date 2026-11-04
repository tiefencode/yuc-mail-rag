# yuc-mail-rag

Local, evidence-based search over the email correspondence of Young & Cold Records. Architecture and decision log: `docs/architecture.md`.

## Spec workflow (OpenSpec-light, no OpenSpec tooling)

- `openspec/specs/<capability>/spec.md` is the living source of truth for current behavior.
- Non-trivial changes get `openspec/changes/<change-id>/` with `proposal.md` (why, scope, non-goals, affected requirements) and `tasks.md`; `design.md` only for real design decisions.
- No delta specs: edit the living spec directly on the feature branch. The git diff is the delta.
- Small fixes skip the change folder and update spec and code in the same commit.
- Every spec, new or changed, goes through interview rounds with the developer before it is finalized. Each round asks only what code and docs cannot answer; rounds continue until scope, behavior, and open questions are settled.
- A proposal is approved by the developer before implementation starts.

### Feature completion

On the feature branch, in this order:

1. All tasks in `tasks.md` are done; tests, lint, and type check pass.
2. Run the `spec-reviewer` agent with the touched living specs, `proposal.md`, and `design.md` as requirements, base `main`.
3. Run the `code-reviewer` agent on the branch diff.
4. Fix the findings, or state to the developer why one is not fixed.
5. Check the rule candidates in `docs/ideas.md` (see below).
6. Move the change folder to `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`.

### Spec format

```markdown
### Requirement: <name>
The system SHALL <behavior>.

#### Scenario: <name>
- WHEN <condition>
- THEN <expected outcome>
```

Scenarios use `####` headings. Each scenario maps to at least one test.

## Rule changes

- Rule changes go to the "Rule candidates" section of `docs/ideas.md`, unless the developer says to apply them directly.
- Entry format: `- <rule> (features: <change-id>, …)`.
- At feature completion: a candidate that came up in a second feature is adopted into this file; a candidate that has not come up again within three completed features since its last occurrence is removed.
- Applies to the rules in this file only, not to the global `~/.claude/CLAUDE.md`.

## Data rules

- The shadow mailbox on Mittwald is the source of truth. The local data directory is a derived cache and must be rebuildable from IMAP at any time.
- Never modify server state (no flag changes, moves, deletes, appends).
- Credentials and mail data are never committed.
