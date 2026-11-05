# Design

## Context

See proposal.md - Why. Current `.claude/settings.json` holds two deny rules: `Read(/data.noindex/**)` and `Bash(*data.noindex*)`. The project has no `.mcp.json` and no hooks. Tests create their data in `os.tmpdir()`, so they never touch the cache directory.

Facts from the Claude Code docs (sandboxing, settings reference, permissions), checked for this change:

- The sandbox is off by default and is enabled with `sandbox.enabled`. It covers shell commands and their child processes. File tools, MCP servers, and hooks run outside it.
- `sandbox.filesystem.denyRead` blocks sandboxed commands from reading a path. Sandbox paths use plain conventions: `./x` is relative to the project root in project settings, `/x` is absolute, `~/x` is relative to home. This differs from permission rules, where `/x` is project-relative and `//x` is absolute.
- `sandbox.allowUnsandboxedCommands: false` makes Claude Code ignore the `dangerouslyDisableSandbox` parameter. `sandbox.failIfUnavailable: true` refuses to start a session when the sandbox cannot start, instead of running unsandboxed.
- `sandbox.excludedCommands` runs matching commands outside the sandbox.
- On macOS, network access goes through a proxy whose allowlist starts empty (`sandbox.network.allowedDomains`); new hosts prompt, or are refused in auto mode unless the classifier approves.
- Sandboxed commands cannot write Claude Code's settings files in `.claude/`, even inside the writable working directory.
- `Read(...)` deny rules are enforced for the file tools; for Grep and Glob the docs call this "best-effort".

Not stated in the docs, and therefore verified by the canary test: that `denyRead` on a subdirectory wins over the writable working directory, and that it covers all files below the directory.

## Goals / Non-Goals

**Goals:**

- OS-enforced read denial of `data.noindex/` for every agent shell command, independent of command text.
- No way for the agent to opt out of the sandbox within this project's settings.
- Project checks (`lint`, `typecheck`, `test`) and commits keep working for the agent.

**Non-Goals:**

- Protection against settings the developer sets elsewhere (`~/.claude/settings.json`, `.claude/settings.local.json`, `--settings`, managed policy). These rank above or beside project settings and stay under the developer's control.
- Write protection of the cache from the agent. The goal is confidentiality; a corrupted cache is rebuildable from IMAP.
- A separate operating-system user (option B from the discussion). Revisit only if the canary test shows a gap the sandbox cannot close.
- Protection for a non-default `DATA_DIR`.

## Decisions

### D1: Claude Code sandbox instead of a separate macOS user

The sandbox gives kernel-level enforcement (Seatbelt) for shell commands with a few lines of project configuration. A separate user would also cover the file tools and the browser, but needs a second keychain for the IMAP password, `sudoers` entries, and directory permissions on `node_modules`. The file tools are already covered by permission rules, so the extra cost buys little.

### D2: Settings

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "filesystem": { "denyRead": ["./data.noindex"] },
    "network": { "allowedDomains": ["registry.npmjs.org"] }
  },
  "permissions": {
    "deny": [
      "Read(/data.noindex/**)",
      "Edit(/.claude/settings.json)",
      "Edit(/.claude/settings.local.json)"
    ]
  }
}
```

- `failIfUnavailable` closes the silent path where the sandbox fails to start and every command runs unrestricted.
- No `excludedCommands`: any excluded pattern would be a way around `denyRead`.
- `registry.npmjs.org` is the only host the agent's shell needs (`pnpm install`, `pnpm add`). Other hosts prompt per session; the IMAP host is deliberately not on the list, because `sync` belongs to the developer.
- The `Edit(...)` deny rules on the settings files keep the agent's file tools from switching the sandbox off. Sandboxed shell commands are already denied these writes. Settings changes become the developer's manual task.
- `autoAllowBashIfSandboxed` stays at its default (`true`): sandboxed commands run without a prompt, which is safe once the cache is unreadable.

### D3: Drop the `Bash(*data.noindex*)` rule

The rule matches command text only. It is bypassable and blocks harmless commands that merely mention the name (for example a `grep` for the string in the source code). The sandbox replaces it as the boundary.

### D4: `sync` and `stats` belong to the developer

Both commands access the cache, so they fail in the agent's shell. An `excludedCommands` entry for them was rejected: the match is on command text, and a script in `src/` that the agent can edit would run unsandboxed with full read access. The developer runs them in the terminal panel; the agent reads the aggregated output there.

### D5: Verification by canary file

The developer creates `data.noindex/CANARY.txt` with a random marker string. The agent then tries every read path from the spec scenarios. Any printed marker means the change fails. The developer deletes the canary afterwards. This covers the two points the docs leave open (D2 precedence, recursive coverage).

## Risks / Trade-offs

- [Grep and Glob enforce read denial only "best-effort"] → Covered by canary scenarios; if a search tool returns cache content, add explicit `Grep(...)`/`Glob(...)` deny rules or fall back to option B.
- [MCP servers, hooks, and the browser tools run outside the sandbox; a browser can open `file://` URLs] → No project MCP servers or hooks exist. The canary test includes a `file://` attempt in the built-in browser; the data rule in `CLAUDE.md` keeps forbidding it. If the browser can read the canary, record it as a known limitation.
- [Higher-ranked settings can disable the sandbox] → Accepted, see Non-Goals; the developer owns those files.
- [Commands that need other hosts (e.g. `gh`, git over SSH) fail or prompt in the sandbox on macOS] → Push and remote work already belong to the developer. Hosts are added only when a concrete need comes up.
- [`denyRead` might not apply below the writable working directory] → Canary test; if it fails, stop and revisit D1.

## Migration Plan

1. Update `.claude/settings.json`; restart the Claude Code session so the sandbox takes effect.
2. Run the canary test, then delete the canary.
3. Run the project checks from the agent's shell.
4. Rollback: revert the settings commit and restart the session.
