# Phase 3 evidence

Phase 3 is "Real Conversation Persistence". The conversation model stops being local UI state: the browser requests conversations, members, branches, and per-conversation messages from the API, and creating a channel or direct message persists the conversation, its membership, and its `main` branch in SQLite. The composer commits into the selected conversation and branch.

## Result

Complete. `bun run check` exits 0. 72 unit and integration tests pass and 18 browser tests pass. A channel created in the browser and a commit sent into it survive a page reload, and [db-dump.txt](db-dump.txt) shows the matching conversation, membership, branch head, message, command, and event rows.

## Commands and results

| Command | Result |
| --- | --- |
| `bun install` (repo root) | 43 installs across 85 packages; lockfile updated for the added `@types/bun` dependency |
| `bun run typecheck` | exit 0 (4 projects: command-engine, api, web app, web node/tests) |
| `bun run lint` | exit 0 (oxlint over `apps` and `packages`) |
| `bun run test` | 72 passed, 0 failed, 5 files |
| `bun run build` | exit 0, `dist/assets/index-*.js` 250.55 kB, CSS 29.23 kB |
| `bun run test:e2e` | 18 passed |
| `bun run check` | exit 0 |
| `bun x playwright test tests/e2e/visual.spec.ts` before baseline update | 7 failed, 1 passed, deliberately; log in [visual-parity-before-update.txt](visual-parity-before-update.txt) |
| `bun x playwright test tests/e2e/visual.spec.ts --update-snapshots` | 8 passed; 7 baselines regenerated |
| `bun run db:inspect apps/web/test-results/gitping-e2e.db` | dump written to [db-dump.txt](db-dump.txt) |

The 72 unit tests are 30 command-engine parser tests, 17 HTTP API tests, 11 command-service tests, 10 conversation-service tests, and 4 migration tests. The 18 browser tests are 6 mocked UI tests, 2 real-API domain tests, 2 real-API conversation persistence tests, and 8 visual tests.

## The model and the endpoints

A conversation owns its membership and branches. Reads return a `ConversationSummary` computed in SQL: member count, last message preview, and unread count. Writes return the full summary after the transaction. There is no schema change; `PRAGMA user_version` stays at 1.

| Endpoint | Success | Expected failure |
| --- | --- | --- |
| `GET /conversations` | `200` summaries | none |
| `POST /conversations` | `201 { conversation }` | `400` invalid input or duplicate |
| `GET /conversations/:id/messages` | `200` messages by `seq` | `404 unknown conversation` |
| `POST /conversations/:id/commands` | `201 { message }` | `400` invalid command or unknown branch, `404` unknown conversation |
| `GET /conversations/:id/members` | `200` users with `id, handle, displayName, avatar, role` | `404` |
| `GET /conversations/:id/branches` | `200` `id, name, headMessageId`, `main` first | `404` |

`GET /messages` and `POST /commands` still work as compatibility endpoints. The browser now uses the conversation-scoped routes.

## Backend changes

- `apps/api/src/repositories/conversation-repository.ts` owns the summary query (member count, preview, unread), member reads, conversation inserts, and membership inserts.
- `apps/api/src/repositories/branch-repository.ts` gained `list` and `create`.
- `apps/api/src/services/conversation-service.ts` validates the name and kind, resolves a deterministic id (`conv-<kind>-<slug>`), rejects duplicates, and writes the conversation, membership, optional direct partner, and `main` branch in one `db.transaction`.
- `apps/api/src/services/command-service.ts` accepts `conversationId`, resolves the conversation before parsing, and returns a failure `reason` so routes can distinguish 404 from 400.
- `apps/api/src/routes/conversations.ts` maps HTTP. `apps/api/src/current-user.ts` holds the single acting user for this no-auth phase.
- `apps/api/scripts/inspect-db.ts` now prints conversation ids, branch ids, and conversation members.
- `packages/command-engine/package.json` now declares `@types/bun`. It used `"types": ["bun"]` without depending on the package, which only typechecked when a stale hoisted copy existed at the repo root.

Every expected failure is a result union from the service; none of the routes throw for user input. Named SQL parameters use explicit `$` keys.

## Frontend changes

- `App.tsx` loads `GET /conversations` on mount and selects `engineering` when present. Selecting a conversation loads its messages, branches, and members. The header and members panel show the server-computed member count, and each sidebar row shows the server-computed preview.
- The composer posts to `POST /conversations/:id/commands` with the selected branch, appends the returned message, updates the preview, and moves the local branch head.
- The branch selector renders `GET /conversations/:id/branches`.
- The conversation members panel renders `GET /conversations/:id/members`. The workspace-wide members panel stays on local data until Phase 8, as specified.
- Both creation modals post to `POST /conversations`, append the returned conversation, and select it. Errors such as a duplicate name appear in the existing toast.
- `tests/e2e/mock-api.ts` now mirrors the new endpoint contract so the existing UI tests stay deterministic. `tests/e2e/conversations.spec.ts` is the new real-API browser proof.

## Browser proof against the real API

`tests/e2e/conversations.spec.ts` runs with no `page.route` mocking. Playwright starts the API on port 3000 with a fresh database and starts Vite.

1. Clicking New channel, naming it `phase-three-mwgmbhz8`, and creating it opens the new conversation with `1 member` on `main`. Screenshot: [screenshots/channel-created.png](screenshots/channel-created.png)
2. Sending `git commit -m "phase three persists mwgmbhz8"` renders the commit and updates the sidebar preview. Screenshot: [screenshots/commit-in-new-channel.png](screenshots/commit-in-new-channel.png)
3. After `page.reload()`, the channel is still in the list. Selecting it shows the same commit. Screenshot: [screenshots/channel-and-commit-after-reload.png](screenshots/channel-and-commit-after-reload.png)
4. A second test creates a direct message with `maria`, which appears under Direct messages and shows `Direct conversation`. Screenshots: [screenshots/direct-message-created.png](screenshots/direct-message-created.png), [screenshots/direct-message-after-reload.png](screenshots/direct-message-after-reload.png)

The existing real-API tests still pass and now write here: [screenshots/commit-rendered.png](screenshots/commit-rendered.png), [screenshots/commit-reloaded-from-sqlite.png](screenshots/commit-reloaded-from-sqlite.png), [screenshots/api-rejection.png](screenshots/api-rejection.png).

## Database dump

[db-dump.txt](db-dump.txt) is the database left by the final `bun run check`. The new channel rows are:

```text
conversations
  { "id": "conv-channel-phase-three-mwgmbhz8", "name": "phase-three-mwgmbhz8", "kind": "channel" }

conversation members
  { "conversation": "phase-three-mwgmbhz8", "member": "grok08", "role": "owner" }

branches
  { "id": "branch-conv-channel-phase-three-mwgmbhz8-main",
    "conversation": "phase-three-mwgmbhz8", "branch": "main", "head": "61fb5c32" }

messages
  { "id": "61fb5c32-ca26-49fb-b4d9-6a803a7341f0",
    "author": "grok08", "conversation": "phase-three-mwgmbhz8",
    "branch": "main", "command": "commit", "text": "phase three persists mwgmbhz8" }
```

The branch head prefix `61fb5c32` matches the message id, so the head moved to the new commit. The direct message rows are `conv-direct-maria` with members `grok08` and `maria`, and branch `branch-conv-direct-maria-main`. The engineering commit from the other real-API test is `20465414-8d1c-41dc-88fa-24fd4d701d0a`.

## Visual parity

The Phase 1 baselines in `evidence/phase-1/parity/` were regenerated deliberately with `--update-snapshots`. Seven states changed; the branch-notice test has no baseline assertion and still passed.

| State | What changed | Why |
| --- | --- | --- |
| `desktop-light` | header `18 members` to `4 members`; sidebar previews become `Ready to ship?` and `No messages yet`; the engineering unread badge disappears | member count, preview, and unread now come from the four-row seed and the mock's one message |
| `desktop-dark` | same data changes | same |
| `sidebar-collapsed` | header `18 members` to `4 members` | same |
| `workspace-members-panel` | chat header and sidebar behind the panel show the same data changes | the workspace panel itself still uses local data |
| `settings-modal` | background shows the same data changes | same |
| `conversation-search` | background previews and member count change; result count stays `1 result` | same |
| `mobile-drawer` | sidebar previews come from the API | same |

Layout, spacing, colors, and interactions are unchanged. The engineering fixture message appears twice in the DOM after this phase, once as the sidebar preview and once as the message text; the mocked UI test now scopes its assertion to `main` because both occurrences are correct.

## Failures found and fixed

1. A fresh worktree failed `bun run typecheck` with `Cannot find type definition file for 'bun'`. `packages/command-engine` requested Bun types without declaring `@types/bun`; a stale hoisted install at the repo root had hidden it. Fixed by adding the devDependency and updating `bun.lock`.
2. The first mocked browser run failed on `getByText("Ready to ship?")` with a strict-mode violation. The server-computed preview duplicated the message text, which is intended. The test now scopes the assertion to the chat pane.
3. The seven visual parity failures before the baseline update were the deliberate data changes above, not regressions. The failure log is kept in [visual-parity-before-update.txt](visual-parity-before-update.txt).
4. The duplicate-name check originally compared names only. Two names that slugify the same (`a b` and `a-b`) could collide on the deterministic id and fail at the primary key. The service now also rejects an existing id, and a test covers it.

## Deferred and remaining risk

- Read state is not persisted. `last_read_at` stays `NULL`, so `unreadCount` counts messages the viewer has not marked read; the UI zeroes the badge locally for the conversation being opened. A read endpoint belongs with notifications in a later phase.
- Workspace-wide members stay on local data until Phase 8, as instructed.
- The branch selector reads real branches, but creating and switching branches as domain operations is Phase 5. Selecting a branch changes the local commit target and shows the existing notice.
- Direct conversations link the named user only when the handle already exists. Creating users is Phase 8 identity work.
- No authentication, WebSocket delivery, or GitHub integration, per the phase boundary.
- SQLite is still a single-writer local database. Conversation creation and message writes are synchronous transactions, which is safe for one API process but not a claim about concurrent servers.
