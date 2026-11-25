# Proposal

## Why

The mail cache in `data.noindex/` holds PINs and other secrets, and mail content must never reach the Anthropic API. Today only the `Read(...)` deny rule is enforced; the `Bash(*data.noindex*)` rule matches command text and is bypassed by globs (`cat data*/…`), `find -exec`, or any Node script or test Claude writes and runs. The protection should be a technical boundary, not a convention.

## What Changes

- Enable Claude Code's OS-level Bash sandbox (macOS Seatbelt) for this project in `.claude/settings.json`, with read access to `data.noindex/` denied for every sandboxed command and its child processes.
- Disable the escape hatch that lets Claude run a command outside the sandbox.
- The restriction applies to Claude Code only. Local components outside it, such as LM Studio and project commands the developer runs, keep full access to the cache.
- Keep the `Read(/data.noindex/**)` deny rule for the file tools (Read, Grep, Glob), which the sandbox does not cover.
- Replace the text-matching `Bash(*data.noindex*)` rule; it is no longer the boundary.
- **BREAKING** (workflow): Claude can no longer run `pnpm sync` or `pnpm stats`, since both access the cache. The developer runs them in their own terminal; Claude reads only the aggregated output from the terminal panel.
- Verify the boundary with a canary file in `data.noindex/` that Claude attempts to read through every path (file tools, shell, Node).
- Record the decision in the decision log of `docs/architecture.md` and update the data rules in `CLAUDE.md`.

## Capabilities

### New Capabilities

- `mail-data-isolation`: the local mail cache is technically unreadable for the coding agent, while the developer's own commands keep full access.

### Modified Capabilities

None. `mail-sync` behavior is unchanged.

## Impact

- `.claude/settings.json`: sandbox section, permission rules.
- `CLAUDE.md`, `docs/architecture.md`: data rules and decision log.
- Developer workflow: `sync` and `stats` move to the developer's terminal; `pnpm install` and other network access from Claude's shell go through the sandbox's network allowlist.
- No change to `src/`; tests use temporary directories and stay sandbox-compatible.
- The protection covers the default `DATA_DIR=./data.noindex`; a different `DATA_DIR` is out of scope and needs the same settings for its path.
