# Phase 5 evidence

Phase 5 is "Git-native conversation model". Branches, revert, stash, and merge are persisted domain operations now: each command either produces a conversation message or changes conversation context, every state change survives a reload, and the state changes that happen after a message exists reach the other client without one. The specification is [docs/phase-5-git-native.md](../../docs/phase-5-git-native.md).

## Result

Complete. `bun run check` exits 0 with 187 unit and integration tests across 15 files and 27 browser tests. Migration 3 stores the member's current branch, four commands became real (`git branch`, `git switch`, `git revert`, `git merge`, plus the three `git stash` forms), both command routes answer an untagged union of `{ message }`, `{ branches }`, or `{ stashes }`, and a new `message.updated` frame carries a reverted or stashed row to every client in the conversation. A branch switch survives a reload, a reverted message keeps its place with a pill, a stashed message leaves the chat until a pop restores it, and a merge records both heads.

## Commands and results

Every command was run from the repository root. Exit codes are the real ones.

| Command | Result |
| --- | --- |
| `cmd /c "bun run check > %TEMP%\check.log 2>&1"` | exit 0: 187 unit tests, 27 browser tests, build 255.72 kB |
| `bun run typecheck` | exit 0 (4 projects: command-engine, api, web app, web node/tests) |
| `bun run lint` | exit 0 (oxlint over `apps` and `packages`) |
| `bun run test` | exit 0: 187 passed, 0 failed, 15 files |
| `bun run build` | exit 0, `dist/assets/index-*.js` 255.72 kB, CSS 30.27 kB |
| `bun run --cwd apps/web test:e2e tests/e2e/git-native.spec.ts` | first run 1 failed, 3 passed (recorded below); second run exit 0, 4 passed |
| `bun run test:e2e` | exit 0, 27 passed (18.6 s in the final run) |
| `bun run db:inspect apps/web/test-results/gitping-e2e.db` | exit 0, output in [db-dump.txt](db-dump.txt) |

Each slice ended with `bun run typecheck`, `bun run lint`, and `bun run test` green before the next one started:

| Slice | Unit tests | typecheck | lint | test |
| --- | --- | --- | --- | --- |
| 1. Migration 3 and branch context | 143 | exit 0 | exit 0 | exit 0 |
| 2. Revert and message state | 162 | exit 0 | exit 0 | exit 0 |
| 3. Merge | 170 | exit 0 | exit 0 | exit 0 |
| 4. Stash | 183 | exit 0 | exit 0 | exit 0 |
| 5. Client and evidence | 187 | exit 0 | exit 0 | exit 0 |

The 187 unit tests are 32 command-engine parser tests, 36 HTTP API tests (branch, revert, merge, and stash bodies on both command routes), 44 command-service tests, 12 conversation-service tests, 8 migration tests, 2 command-request repository tests, 6 message-repository tests, 7 message-hub tests, 4 frame-parser tests, 10 realtime integration tests against a real Bun server, 8 client message tests, 7 client realtime tests, 3 heartbeat tests, 4 client command-request id tests, and 4 current-branch selection tests.

The 27 browser tests are 6 mocked UI tests, 2 real-API domain tests, 2 real-API conversation tests, 8 visual parity tests, 4 real-API realtime tests, 1 real-API idempotency test, and 4 real-API Git-native tests.

## The data model

### Branch context belongs to the member

Migration 3 adds one column and backfills it:

```sql
ALTER TABLE conversation_members
  ADD COLUMN current_branch_id TEXT REFERENCES branches(id);

UPDATE conversation_members
SET current_branch_id = (
  SELECT b.id FROM branches b
  WHERE b.conversation_id = conversation_members.conversation_id
    AND b.name = 'main'
);
```

The column is read and written in exactly one place, `apps/api/src/repositories/branch-repository.ts`. `currentFor` resolves it in one statement, falling back to the conversation's `main` branch when the column is NULL, so a member created before the backfill still resolves. `setCurrent` writes it for the member who ran the switch. A `git switch` by one member does not move anyone else's context ([command-service.test.ts](../../apps/api/src/services/command-service.test.ts), "switching in one conversation leaves another member's view alone").

On a fresh database the seed runs after migrations, so seeded members keep a NULL column and resolve to `main` on read. The backfill is proven where it applies, on a version 2 database upgraded in place ([migrations.test.ts](../../apps/api/src/migrations.test.ts), "version 3 adds branch context, backfilled to main"); the dump below shows the two members who switched carrying a real branch id.

### Message state comes from events

There is no boolean column. `reverted` and `stashed` are computed in the message repository's `SELECT` from `message_events`, and `stashed` is true only while a `stashed` event has no matching `unstashed` event. One expression is shared by the selected column and the "not stashed" filter that picks the next stash target, so the two cannot disagree. The derivation is a pure function of the event set, which is what makes it independent of the order the events were written in ([message-repository.test.ts](../../apps/api/src/repositories/message-repository.test.ts), "does not depend on the order the events were written in").

Event payloads written by Phase 5:

| Event | Payload | Written by |
| --- | --- | --- |
| `reverted` | `{ "byMessageId": "<revert message id>" }` | `git revert` |
| `stashed` | `{ "note": "..." \| null }` | `git stash` |
| `unstashed` | `{ "byMessageId": "<generated id>" }` | `git stash pop` |
| `merged` | `{ "sourceBranchId", "sourceBranchName", "targetBranchId", "sourceHeadMessageId", "targetHeadMessageId" }` | `git merge` |

The dump shows all four types with their payloads.

### Stash state is per conversation, not per member

A stash is a flag and a note on a message, derived per conversation and branch. That means the stash of `#engineering` is the same list for every member, which is the honest limit of a model with no identity: two people who both say `git stash` walk the same branch backwards, newest message first, and a pop by one restores the message for both. Per-member stashes need the identity work in Phase 8.

## Commands

| Command | Result | Failure |
| --- | --- | --- |
| `git branch` | `{ branches }` with `current` on the member's branch | — |
| `git branch <name>` | creates from the current head, `{ branches }`, no message, current unchanged | `400 Invalid branch name: <name>`, `409 Branch already exists: <name>` |
| `git switch <name>` | persists `current_branch_id`, `{ branches }` | `400 Unknown branch: <name>` |
| `git switch -c <name>` | creates at the current head and switches, in one transaction | `400` invalid, `409` duplicate |
| `git revert <id> [prefix]` | one message on the current branch, `reverted` event, head moves | `400 Unknown message: <target>`, `400 Ambiguous message prefix: <target>`, `409 Message <prefix> is already reverted` |
| `git merge <branch>` | one message on the current branch, `merged` event with both heads | `400 Unknown branch: <name>`, `400 Cannot merge a branch into itself`, `400 Already up to date` |
| `git stash` / `git stash push -m "note"` | stashes the newest message on the branch that is not already stashed | `400 Nothing to stash on <branch>` |
| `git stash list` | `{ stashes }` for the current branch, newest first | — |
| `git stash pop [id]` | restores the newest stash or the named one | `400 No stash to pop on <branch>`, `400 Unknown stash: <id>` |

Branch names are `/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/` and `HEAD` is refused. Branches are case-sensitive, like Git. A revert target is a full message id or a unique prefix of at least four characters, resolved inside the conversation, so the same prefix in another conversation cannot match. A stash id is a full message id or a unique prefix.

## HTTP contract

`POST /conversations/:id/commands` and `POST /commands` return one untagged body:

```json
{ "message": { "id": "...", "seq": 12, "reverted": false, "stashed": false } }
{ "branches": [ { "id": "...", "name": "main", "headMessageId": "...", "current": true } ] }
{ "stashes": [ { "id": "...", "text": "...", "note": "wip", "createdAt": "..." } ] }
```

A `message` body is `201`; a context body is `200`. `GET /conversations/:id/branches` now includes `current` per branch, and `GET /conversations/:id/stashes` returns the same `stashes` array for the current user's current branch. The compatibility `POST /commands` keeps its long-standing `400` for an unknown conversation while the conversation-scoped route answers `404`; the response mapper takes that status from the route so the divergence is explicit, not accidental.

## Realtime

`message.updated` is written after the state transaction commits, never before, and once per affected message:

```json
{ "type": "message.updated", "conversationId": "conv-engineering", "seq": 12, "message": { "id": "...", "reverted": true, "stashed": false } }
```

- `git revert` publishes `message.created` for the revert message and then `message.updated` for the target.
- `git stash` and `git stash pop` publish one `message.updated` each.
- `git branch` and `git switch` publish nothing: branch context is per member, and the actor has the new list in its response.
- A replayed command publishes nothing, so one retry stays one event.

The integration tests use a real Bun server and two sockets in the same conversation plus one in another: [realtime.test.ts](../../apps/api/src/realtime/realtime.test.ts), "broadcasts a revert to both clients in the conversation and no other" and "broadcasts stash and pop state to the conversation and no other".

## What the client does

- The selector marks the `current` branch from the server on load and after every command response, so a reload restores where the member was.
- A reverted message keeps its place, dimmed with a strikethrough and a `reverted` pill; the verb pill reads the message's own command, so a revert row says `revert`.
- A stashed message is filtered out of the main list. `git stash` and `git stash list` show a transient `STASH` notice with the count, and `git stash pop` shows `Restored from stash`.
- `message.updated` merges by id, so the row is replaced in place and keeps its `seq` ([messages.test.ts](../../apps/web/tests/unit/messages.test.ts), "replaces a row in place when an update arrives for it").
- No new modal, panel, or dependency. The composer remains the interface.

## Browser proof against the real API

`tests/e2e/git-native.spec.ts` uses the real API on port 3000 with a fresh database. Each test creates its own channel so the proof does not depend on parallel tests. Screenshots are in [screenshots/](screenshots/).

### 1. `git switch -c` persists the branch

1. A fresh channel, then `git commit -m "base work …"`.
2. `git switch -c release`: the selector follows the response. [screenshots/switch-created-branch.png](screenshots/switch-created-branch.png)
3. `GET /conversations/:id/branches` reports `current: true` on `release`.
4. Reload: the selector still shows `release`, because the member's column is what the client reads. [screenshots/switch-branch-after-reload.png](screenshots/switch-branch-after-reload.png)
5. The next commit lands on `release`, proven by the branch head matching the rendered commit id.

### 2. `git revert` reaches both clients and survives a reload

1. Sender creates a channel, receiver opens it in a second context, sender commits.
2. Sender sends `git revert <8-character id>`: the target gets the pill and the revert message appears. [screenshots/revert-reverted-pill.png](screenshots/revert-reverted-pill.png)
3. The receiver never reloaded and shows the pill, which is the `message.updated` frame landing. [screenshots/revert-other-client-live.png](screenshots/revert-other-client-live.png)
4. `GET /messages` reports `reverted: true` for that row.
5. The receiver reloads and reopens the channel: the pill is still there. [screenshots/revert-after-reload.png](screenshots/revert-after-reload.png)

### 3. `git merge` records the merge

1. A fresh channel: commit on `main`, `git branch feature`, `git switch feature`, commit on `feature`, `git merge main`.
2. The merge message appears on the current branch. [screenshots/merge-message.png](screenshots/merge-message.png)
3. A reload keeps the merge row and the `feature` context. [screenshots/merge-after-reload.png](screenshots/merge-after-reload.png)
4. `GET /messages` reports one message with text `Merge branch 'main' into feature` and command `git merge`.

### 4. `git stash` and `git stash pop`

1. Sender creates a channel, receiver opens it, sender commits.
2. `git stash`: the message leaves the chat, and the notice reports the count. [screenshots/stash-hidden.png](screenshots/stash-hidden.png)
3. `git stash list`: the same count from a read command. [screenshots/stash-list-notice.png](screenshots/stash-list-notice.png)
4. The receiver never reloaded and the message is gone there too. [screenshots/stash-other-client-live.png](screenshots/stash-other-client-live.png)
5. `GET /stashes` returns the message, so the UI claim is backed by SQLite.
6. `git stash pop`: the message returns and the notice says `Restored from stash`. [screenshots/stash-pop-restored.png](screenshots/stash-pop-restored.png)
7. A reload still shows the restored message. [screenshots/stash-after-reload.png](screenshots/stash-after-reload.png)

## Database dump

[db-dump.txt](db-dump.txt) is the database left by the final `bun run check`, at schema version 3:

```text
messages: 18, commands: 18, message events: 22
  events: created (one per message), reverted, stashed, unstashed, merged
  message state: two rows with reverted = 1 and 0, every other row 0
  conversations: 6 seeded + 10 created by the Phase 3, 4, and 5 browser tests
  branches: 8 seeded + one main per created conversation + release, feature, shared-head
  conversation_members: 31
    seeded members are NULL and resolve to main (the seed runs after migration 3)
    phase-five-switch: current_branch = release
    phase-five-merge: current_branch = feature
  command requests: 18, one per content command the browser sent
```

The revert test's target still exists with `reverted: 1`, next to its revert message, which is the "nothing is deleted" claim in row form. The stash test's message is `stashed: 0` because the test pops it before it ends; the `stashed` and `unstashed` events for it are both in `## message events`.

## Failures found and fixed

1. **The first run of `git-native.spec.ts` was 1 failed, 3 passed.** The revert test compared the 8-character id rendered in `.commit-id` against full ids from `GET /messages`, so the lookup missed. The test now matches by prefix. The raw log was overwritten by the next run; the failure is recorded here rather than dropped.
2. **One command-service test failed during slice 4.** The "stashed message is still in history" test named the first commit `newer`, so the assertion expected the older message to be the stash target. The fixture names were wrong, not the service: the newest message by `seq` is the one stashed. Renamed to `older` then `newer`.
3. **A non-member commit lost its default branch.** Reading the persisted branch first meant an author with no `conversation_members` row resolved to no branch, so `git commit` failed instead of landing on `main`. The existing test "creates a user for a new author handle" caught it; `branchFor` now falls back to the conversation's `main` branch.
4. **The shared response mapper changed the compatibility route's unknown-conversation status from 400 to 404.** The mapper takes that one status from the route, so `POST /commands` keeps the behavior its clients rely on while `POST /conversations/:id/commands` answers 404.

## Visual parity

All 8 baselines pass unchanged with no `--update-snapshots` run. No baseline shows a reverted message, a stashed message, or a non-`commit` verb pill, so the new styling sits outside them. The Phase 3 and Phase 4 specs recapture their own screenshots on every run, so those folders were restored to their committed state after the final run; only `evidence/phase-5/screenshots/` is new.

## Remaining risk and limits

- **No ancestry graph.** A merge compares only the two heads. It cannot detect a real common ancestor or fast-forward, so "already up to date" means "the heads are equal", not "there is nothing to merge". This is the honest limit of the recorded-event model.
- **Stash is conversation-wide.** Per-member stashes need identity (Phase 8). A retried `git stash` after a lost response also stashes the next message, because `requestId` maps a request to a message and a context command makes none; content commands are unaffected.
- **Membership is not enforced.** A `git switch` from an author who is not a member writes no row, so their context reads back as `main`. The browser always acts as a member.
- **History is not branch-filtered.** The conversation view stays conversation-wide, as in Phase 4, so a merge records intent rather than partitioning history.
- **No revert of a merge is special-cased.** Reverting a revert is allowed, as Git allows it.
