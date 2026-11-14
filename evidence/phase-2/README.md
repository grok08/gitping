# Phase 2 evidence

Phase 2 is "Model GitPing Properly". The single `messages` table becomes an explicit Git-native model: users, conversations, members, branches, messages, parsed commands, and message events. Behavior visible in the browser must not change.

## Result

Complete. 48 unit and integration tests pass, 16 browser tests pass, and a commit typed in the browser lands in all four domain tables with a matching commit id.

## Commands and results

| Command | Result |
| --- | --- |
| `bun run typecheck` | exit 0 (4 projects) |
| `bun run lint` | exit 0 |
| `bun run test` | 48 passed, 0 failed (30 parser, 8 command service, 6 HTTP API, 4 migrations) |
| `bun run test:e2e` | 16 passed, including 2 tests against the real API and 8 visual parity checks |
| `bun run build` | exit 0 |
| `bun run db:inspect apps/web/test-results/gitping-e2e.db` | see [db-dump.txt](db-dump.txt) |
| `bun run check` | exit 0 |

## The model

```text
users ──────────────┐
  │                 │
  │        conversation_members
  │                 │
conversations ──────┴── branches ── messages ── git_commands
                                      │
                                      └──────── message_events
```

- `messages.seq` is an autoincrement commit order, so ordering never depends on timestamp ties.
- `messages` stores no free-text `command` column. The verb and the parsed command live in `git_commands`, and the API joins them back for compatibility.
- `branches.head_message_id` moves to the newest message on every accepted commit.
- `message_events` records a `created` event per message, which is the hook for revert, stash, and merge later.
- `PRAGMA user_version` guards a versioned migration. Migration 1 creates the schema, and on an existing database it renames the old table, seeds the workspace, backfills every legacy row, then drops the old table.

## Code

```text
apps/api/src/migrations.ts                 migration runner, schema, legacy backfill
apps/api/src/seed.ts                       four users, six conversations, eight branches
apps/api/src/types/domain.ts               User, Conversation, ConversationMember, Branch,
                                           Message, GitCommandRecord, MessageEvent
apps/api/src/repositories/user-repository.ts
apps/api/src/repositories/conversation-repository.ts
apps/api/src/repositories/branch-repository.ts
apps/api/src/repositories/message-repository.ts
apps/api/src/services/command-service.ts   parse, resolve, write in one transaction
apps/api/scripts/inspect-db.ts             repeatable database dump
apps/api/scripts/start-e2e.ts              test server with a fresh database
```

The command service resolves the author, conversation, and branch before writing, then inserts the message, its command, and its event inside one transaction and moves the branch head. An unknown conversation or branch is a 400 with a named error, not a silent default.

`POST /commands` now accepts optional `conversation` and `branch` fields. The browser does not send them yet, so the UI still commits to `engineering` on `main`. Wiring conversation selection through the UI is Phase 3 work.

## Browser proof against the real API

`tests/e2e/domain.spec.ts` runs with no request mocking. Playwright starts the API on port 3000 with a fresh database, starts Vite, and drives the real form.

1. The spec types `git commit -m "phase two persists <timestamp>"` and sends it.
2. The message appears in the conversation. Screenshot: [screenshots/commit-rendered.png](screenshots/commit-rendered.png)
3. The page reloads, which forces `GET /messages` to read from SQLite.
4. The message is still there. Screenshot: [screenshots/commit-reloaded-from-sqlite.png](screenshots/commit-reloaded-from-sqlite.png)
5. A second test sends `git log` and asserts the API rejection appears in the UI. Screenshot: [screenshots/api-rejection.png](screenshots/api-rejection.png)

The browser screenshot shows commit id `fce70654`. The database dump records `message_id: fce70654-03b7-4fd2-aba3-2d5af17c712d` in `git_commands` and `message_events`, with `verb: "commit"`, the raw input, and `args` holding the parsed AST. The same id appears in `messages`, joined to author `grok08`, conversation `engineering`, and branch `main`, whose head now points at that message.

## Migration proof

`apps/api/src/migrations.test.ts` covers four cases:

- A fresh database reaches schema version 1 with all seven tables.
- Initializing twice does not duplicate seed data (4 users, 6 conversations, 20 memberships, 8 branches).
- A database holding the old `messages` table is renamed, backfilled, and left without the legacy table. Legacy authors become users, the verb is normalized from `git commit` to `commit`, and the parsed command is reconstructed from the old row.
- Re-running the migration is a no-op.

## Bug found and fixed during this phase

The first seed attempt inserted zero rows. Bun's SQLite bindings need `$`-prefixed keys, so spreading plain objects bound nulls, and `INSERT OR IGNORE` swallowed the NOT NULL failures. The seed now binds explicit `$`-prefixed parameters. The failing case is exactly what the new seed test would have caught, which is why `seeded the workspace once` asserts counts instead of existence.

## Known follow-ups

- Conversation and member endpoints are Phase 3. The tables are seeded, but nothing reads them over HTTP yet.
- The UI still keeps conversations in local state. Phase 3 replaces that list with `GET /conversations`.
- `git_commands.args` is text today. If querying inside the AST becomes necessary, SQLite JSON functions can index it without a schema change.
