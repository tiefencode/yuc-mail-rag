# Tasks

## 1. Baseline (red)

- [ ] 1.1 Developer creates `data.noindex/CANARY.txt` containing a random marker string; verify the agent reports only that the file exists (developer confirms, the agent does not read it with its file tools)
- [ ] 1.2 Agent runs `cat data*/CANARY.txt` under the current settings, targeting only the canary file; verify the marker is printed, which shows the gap the Bash text rule leaves open

## 2. Sandbox configuration

- [ ] 2.1 Update `.claude/settings.json` as in design.md D2 (sandbox enabled, `failIfUnavailable`, `allowUnsandboxedCommands: false`, `denyRead` for `./data.noindex`, `registry.npmjs.org` allowlist, `Read` deny kept, `Edit` deny on the settings files, `Bash(*data.noindex*)` removed); verify the file parses as JSON
- [ ] 2.2 Developer restarts the Claude Code session; verify the session starts and a harmless command such as `ls src` runs without a prompt

## 3. Canary verification (green)

- [ ] 3.1 File tools: Read on the canary, Grep for the marker in `data.noindex/`, Glob on `data.noindex/**`; verify each is denied and the marker never appears
- [ ] 3.2 Shell: `cat data.noindex/CANARY.txt`, `cat data*/CANARY.txt`, `find . -name CANARY.txt -exec cat {} \;`; verify each fails with a permission error and prints no marker
- [ ] 3.3 Child process: `node -e` reading the canary; verify the read fails and prints no marker
- [ ] 3.4 Escape: request a run of `cat data*/CANARY.txt` with the sandbox disabled; verify it still runs sandboxed and prints no marker
- [ ] 3.5 Settings: attempt to edit `.claude/settings.json` with the file tools and with `echo >> .claude/settings.json`; verify both are denied and the file is unchanged (`git diff`)
- [ ] 3.6 Browser: open `file://<project>/data.noindex/CANARY.txt` in the built-in browser; record whether it is blocked, and if it is readable, add it as a known limitation in `docs/architecture.md`
- [ ] 3.7 Developer deletes the canary file; verify it is gone (developer confirms)

## 4. Agent and developer workflows

- [ ] 4.1 Agent runs `pnpm lint`, `pnpm typecheck`, `pnpm test`; verify all pass as before
- [ ] 4.2 Developer runs `pnpm stats` in their own terminal; verify the agent can read the aggregated output from the terminal panel

## 5. Documentation

- [ ] 5.1 Update `CLAUDE.md`: data rules name the sandbox as the boundary; `sync` and `stats` are run by the developer; settings changes are made by the developer; verify by reading the diff
- [ ] 5.2 Add a decision-log entry to `docs/architecture.md` (sandbox instead of separate user, removed Bash text rule, canary results); verify the entry references the canary outcome
- [ ] 5.3 Run `openspec validate sandbox-mail-data --strict`; verify it passes

## Workflow follow-up

- Review, then `/opsx:archive`; fast-forward `main` onto `sandbox-mail-data` and delete the branch as `CLAUDE.md` describes.
