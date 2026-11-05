# yuc-mail-rag

Local, evidence-based search over the email correspondence of Young & Cold Records. Architecture and decision log: `docs/architecture.md`.

## Workflow

- This project uses OpenSpec: changes run through its own flow (`/opsx:explore`, `/opsx:propose`, `/opsx:update`, `/opsx:apply`, `/opsx:archive`). No other spec workflow skill applies.
- After `/opsx:archive`, fast-forward `main` onto the feature branch without asking (root on `main`, `git merge --ff-only <branch>`), delete the branch and ask the developer to push.

## Commands

- `pnpm sync` (`--log-imap` prints the IMAP command log to stderr), `pnpm stats`: the developer runs them in their own terminal; they fail in Claude's sandboxed shell
- Checks before every commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Setup: copy `.env.example` to `.env`; store the IMAP password once with `security add-generic-password -s yuc-mail-rag -a <IMAP_USER> -w`

## Data rules

- The shadow mailbox on Mittwald is the source of truth. The local data directory is a derived cache and must be rebuildable from IMAP at any time.
- Never modify server state (no flag changes, moves, deletes, appends).
- Credentials and mail data are never committed.
- Claude never reads mail content, so it does not reach the API: `.claude/settings.json` denies `data.noindex/` to the file tools and, through the Claude Code sandbox, to every shell command. Work with aggregated output the developer runs, such as `pnpm stats`, read from the terminal panel. Only the developer changes `.claude/settings*.json`.
