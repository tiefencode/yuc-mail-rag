# Spec Delta

## Purpose

Keeps the local mail cache (`data.noindex/` in the project root) technically unreadable for the coding agent, Claude Code, so mail content never reaches the model provider, while the developer keeps full access through their own shell.

## ADDED Requirements

### Requirement: Agent file tools cannot read the cache

The agent's file tools SHALL be denied any read, search, or listing inside the cache directory `data.noindex/`. Verification uses a canary file: a file the developer places in the cache directory with a known marker string.

#### Scenario: Reading the canary with the file read tool

- **WHEN** the agent reads the canary file with its file read tool
- **THEN** the read is denied and the marker string does not appear in the agent's context

#### Scenario: Searching the cache

- **WHEN** the agent searches for the marker string with its content search or path search tools inside the cache directory
- **THEN** the search is denied and no file name or content from the cache directory is returned

### Requirement: Agent shell cannot read the cache

Every command the agent runs in its shell, and every child process it starts, SHALL be denied read access to the cache directory, regardless of how the path appears in the command text.

#### Scenario: Direct read through the shell

- **WHEN** the agent runs `cat` on the canary file
- **THEN** the command fails with a permission error and does not print the marker string

#### Scenario: Path not named in the command

- **WHEN** the agent runs a command that reaches the canary file through a glob or `find` without spelling out the directory name
- **THEN** the command fails to read the file and does not print the marker string

#### Scenario: Read from a child process

- **WHEN** the agent runs a Node.js one-liner that reads the canary file
- **THEN** the read fails and the marker string is not printed

### Requirement: No unsandboxed escape

The agent SHALL NOT be able to run a shell command outside the restrictions that deny the cache directory.

#### Scenario: Agent requests an unsandboxed run

- **WHEN** the agent asks to run a command that reads the canary file with the sandbox disabled
- **THEN** the command still runs under the restrictions and does not print the marker string

### Requirement: Developer access is unaffected

Commands the developer runs in their own terminal SHALL keep full read and write access to the cache directory.

#### Scenario: Developer runs stats

- **WHEN** the developer runs `pnpm stats` in their own terminal
- **THEN** the command reads the cache and prints the aggregated statistics as before

#### Scenario: Developer runs sync

- **WHEN** the developer runs `pnpm sync` in their own terminal
- **THEN** the command connects to the IMAP server and writes to the cache as before

### Requirement: Project checks run for the agent

The agent SHALL be able to run the project checks, which do not use the cache directory, under the restrictions.

#### Scenario: Checks before a commit

- **WHEN** the agent runs `pnpm lint`, `pnpm typecheck` and `pnpm test`
- **THEN** each check runs to completion with the same result as outside the restrictions
