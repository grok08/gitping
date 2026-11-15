# GitPing

GitPing is a developer messaging application where **Git commands are the communication protocol**.

Instead of sending:

```text
what are you doing?
```

a user sends:

```bash
git commit -m "what are you doing?"
```

GitPing turns that command into a normal conversation message while preserving the Git operation as part of the message metadata.

The goal is to make Git concepts useful for communication without making the application feel like a terminal.

---

## Current Status

GitPing currently has a working end-to-end vertical slice, backed by a Git-native domain model, persistent conversations, and real-time delivery:

```text
React
  │
  │ POST /conversations/:id/commands
  ▼
Hono
  │
  │ validate command
  ▼
command-engine
  │
  │ INSERT (one transaction)
  ▼
SQLite
  │
  ├──► HTTP 201 with the confirmed message
  │
  └──► broadcast message.created
          │
          ▼
     WebSocket /conversations/:id/events
          │
          ▼
     every connected client in that conversation
```

A command answers with one untagged body. `git commit`, `git revert`, and `git merge` answer with `{ message }`; `git branch` and `git switch` answer with `{ branches }`; `git stash` commands answer with `{ stashes }`.

The current implementation is an early product foundation rather than a production-ready messaging service.

The conversation list, member counts, last-message previews, branch lists, and per-conversation message history are read from SQLite. Creating a channel or direct message writes the conversation, its membership, and its `main` branch in one transaction. A commit is persisted before it is broadcast, so a client never sees a message SQLite does not have.

---

## Features

### Git-native messaging

The composer accepts Git commands such as:

```bash
git commit -m "hello"
git commit --amend
git revert <message-id-or-prefix>
git merge <branch>
git branch
git branch <name>
git switch <name>
git switch -c <name>
git stash
git stash push -m "note"
git stash list
git stash pop [id]
git log
git show
git status
git fetch
git pull
git push
git config user.name
git config user.email
```

The parser lives in the `command-engine` workspace package. The commands GitPing acts on are:

| Kind | Commands | Result |
| --- | --- | --- |
| Content | `commit`, `revert`, `merge` | a new message, broadcast to the conversation |
| Context | `branch`, `switch`, `stash`, `stash pop`, `stash list` | state, returned to the caller, no message |
| Rejected | `log`, `show`, `status`, `fetch`, `pull`, `push`, `config`, `init`, `clone` | `400`, unchanged |

A context command produces no message because it changes where work lands, not what the conversation says.

### Messaging UI

The frontend currently provides:

- real-time delivery over one WebSocket per conversation
- a connection indicator (`Live`, `Connecting`, `Reconnecting`, `Offline`)
- reconnect catch-up from persisted history with no duplicates
- retry-safe sends: a retried command reuses its `requestId` and resolves to the stored message
- channels and direct conversations loaded from the API
- server-computed member counts and last-message previews
- message history per conversation
- command composer scoped to the selected conversation and branch
- branch selector driven by the conversation's branches, restored from the member's persisted branch on load
- `git branch`, `git switch`, and `git switch -c` as the branch commands
- `git revert` with a reverted pill, reduced emphasis, and the original row kept in history
- `git merge` that records both heads as a merge message
- `git stash`, `git stash list`, and `git stash pop` with a transient count notice
- conversation search served by the API, across every branch, with a branch label on hits from another branch
- a `Ctrl+K` palette that searches messages, conversations, people, and branches, with `author:`, `command:`, `branch:`, `after:`, and `before:`
- opening a search hit selects its conversation, person, branch, or message, and a message jump scrolls to the row and highlights it
- workspace members (local data until Phase 8)
- conversation members loaded from the API
- notifications panel
- light/dark themes
- collapsible conversation sidebar
- focused/centered chat layout
- transient branch-switch notifications

---

## Architecture

GitPing is a Bun workspace containing a React frontend, Hono backend and reusable command-engine package.

```text
gitping/
│
├── apps/
│   ├── api/
│   │   ├── scripts/              # test server and database inspector
│   │   └── src/
│   │       ├── index.ts          # server bootstrap
│   │       ├── app.ts            # route assembly
│   │       ├── db.ts             # SQLite connection
│   │       ├── migrations.ts     # versioned schema
│   │       ├── seed.ts           # workspace seed data
│   │       ├── routes/           # HTTP and WebSocket mapping only
│   │       ├── services/         # business logic
│   │       ├── repositories/     # SQL
│   │       ├── realtime/         # connection hub, frames, WebSocket route
│   │       ├── search/           # query parser and message snippets
│   │       └── types/
│   │
│   └── web/
│       └── src/
│           ├── App.tsx           # composition root
│           ├── features/         # chat, conversations, branch, search, members, workspace
│           ├── components/ui/    # avatar, presence dot, side panel
│           ├── hooks/            # theme, sidebar, shortcuts, search requests, connection socket
│           ├── lib/              # API client, message merge, realtime parsing, search helpers, formatting
│           ├── data/             # workspace members (local until Phase 8)
│           ├── styles/           # tokens, globals, responsive, import order
│           └── types/
│
├── packages/
│   └── command-engine/
│       └── src/
│           ├── parser.ts
│           └── parser.test.ts
│
├── evidence/                     # per-phase browser evidence
├── docs/                         # designs for work not implemented yet
├── package.json
└── bun.lock
```

### Frontend

```text
React
TypeScript
Vite
Lucide React
```

### Backend

```text
Bun
Hono
```

### Database

```text
SQLite
bun:sqlite
```

### Workspace

```text
Bun workspaces
```

---

## Message Flow

A message follows this path:

```text
User types:

git commit -m "hello"

        │
        ▼

React composer

        │
        │ POST /conversations/:id/commands
        ▼

Hono API

        │
        ▲
        │ command-engine validate
        │
        ▼

SQLite

        │
        │ INSERT message + command + event, move branch head
        │ inside one transaction
        ▼

committed row

        │
        ├──────────────► HTTP 201 { message }
        │                        │
        │                        ▼
        │                sender merges the confirmed message
        │
        └──────────────► broadcast message.created
                                 │
                                 ▼
                    every WebSocket client in that conversation
                                 │
                                 ▼
                    merge by id + order by seq, render once
```

SQLite is the persistence source of truth. A message is broadcast only after its transaction commits.

The browser renders only confirmed messages. There is no optimistic copy to reconcile: the broadcast is the primary path, the HTTP response is the fallback when the socket is down, and both carry the same server id, so the same commit can never appear twice.

---

## API

### Health

```http
GET /health
```

Example:

```json
{
  "status": "ok",
  "database": true,
  "schemaVersion": 3
}
```

### Conversations

```http
GET /conversations
```

Returns the conversation list with counts and previews computed by SQLite:

```json
[
  {
    "id": "conv-engineering",
    "name": "engineering",
    "kind": "channel",
    "memberCount": 4,
    "preview": "hello from GitPing",
    "unreadCount": 0
  }
]
```

`preview` is the last message text or `null`. `unreadCount` counts messages newer than the current user's `last_read_at`. Read state is not persisted yet, so the count reflects the seeded `NULL` value.

```http
POST /conversations
```

Request:

```json
{
  "name": "architecture",
  "kind": "channel"
}
```

`kind` is `channel` or `direct`. The write creates the conversation, the creator's membership (and the named developer for a direct conversation when that handle exists), and a `main` branch in one transaction. Response is `201`:

```json
{
  "conversation": {
    "id": "conv-channel-architecture",
    "name": "architecture",
    "kind": "channel",
    "memberCount": 1,
    "preview": null,
    "unreadCount": 0
  }
}
```

A duplicate or invalid body returns `400` with `{ "error": "..." }`.

```http
GET /conversations/:id/messages
```

Returns the conversation's messages ordered by `seq`, in the same shape as `GET /messages`, including `seq`.

```http
POST /conversations/:id/commands
```

Request (same body as `POST /commands`, with the conversation taken from the path):

```json
{
  "input": "git commit -m \"hello from GitPing\"",
  "branch": "main",
  "requestId": "6f1f0b0e-5c3e-4b7e-9a51-2f0a3a1f0c11"
}
```

`branch` is the branch the caller's selector shows; when it is omitted the server uses the member's persisted branch. `requestId` is optional.

The response is an untagged union of three bodies, one per command kind:

```json
{ "message": { "id": "...", "seq": 12, "reverted": false, "stashed": false, "command": "git commit", "text": "hello", "author": "grok08", "createdAt": "..." } }
```

```json
{ "branches": [ { "id": "...", "name": "main", "headMessageId": "...", "current": true } ] }
```

```json
{ "stashes": [ { "id": "...", "text": "...", "note": "wip", "createdAt": "..." } ] }
```

A client checks `"message" in body`, then `"branches" in body`, then `"stashes" in body`. A `message` body is `201`; a context body is `200`. A rejected command returns `400`, a duplicate branch or an already reverted message returns `409`, and an unknown conversation returns `404` on this route.

```http
GET /conversations/:id/stashes
```

Returns the same `stashes` array for the current user's current branch, so the client can refresh without sending a command.

```http
GET /conversations/:id/members
```

Returns members with their user fields:

```json
[
  {
    "id": "user-grok08",
    "handle": "grok08",
    "displayName": "grok08",
    "avatar": "G",
    "role": "owner"
  }
]
```

```http
GET /conversations/:id/branches
```

Returns `id`, `name`, and `headMessageId` per branch, with `main` first. `current` marks the branch the requesting member is on, which is what a reload restores. Every unknown conversation id on a nested route returns `404` with `{ "error": "Unknown conversation: ..." }`.

### Messages

```http
GET /messages
```

Returns persisted messages ordered by commit order. Each message is joined with its author and Git command, so the response keeps the original shape:

```json
[
  {
    "seq": 1,
    "id": "...",
    "author": "grok08",
    "text": "hello from GitPing",
    "command": "git commit",
    "created_at": "...",
    "reverted": false,
    "stashed": false
  }
]
```

`seq` is the conversation-independent commit order. It is the ordering key clients use for realtime events. `reverted` and `stashed` are derived by the message repository from the message's events, so a row never carries a boolean that can drift.

`GET /messages` returns every conversation's messages and remains for compatibility and simple scripts. The browser reads `GET /conversations/:id/messages` instead.

### Commands

```http
POST /commands
```

Request:

```json
{
  "input": "git commit -m \"hello from GitPing\"",
  "author": "grok08",
  "conversation": "engineering",
  "branch": "main",
  "requestId": "6f1f0b0e-5c3e-4b7e-9a51-2f0a3a1f0c11"
}
```

`conversation` and `branch` are optional. `conversation` defaults to `engineering`; `branch` defaults to the member's persisted branch. `requestId` is optional too; both command endpoints accept it. The browser now uses `POST /conversations/:id/commands`; this route remains for compatibility and direct API use. Response:

```json
{
  "message": {
    "seq": 2,
    "id": "...",
    "author": "grok08",
    "text": "hello from GitPing",
    "command": "git commit",
    "createdAt": "..."
  }
}
```

The id is generated by the server. A client never invents the id of a confirmed message.

#### Idempotent commands (`requestId`)

A lost response used to leave the sender with a visible failure and a commit that exists. `requestId` closes that: the client names one intent before the first attempt, and a retry of the same text reuses the name.

```http
POST /conversations/:id/commands
POST /commands
```

- `requestId` is optional. Valid ids match `/^[A-Za-z0-9_-]{8,64}$/`. Anything else is `400 {"error":"requestId must be 8 to 64 characters of A-Z, a-z, 0-9, _ or -"}`.
- Omitted: current behaviour, one commit per request.
- Same id, same conversation, same author: `201` with the message that already exists, plus `Idempotent-Replay: true`. Nothing is parsed, written, or broadcast, so one retry stays one event.
- Same id in a different conversation, or from a different author: `409 {"error":"Request id already used for another command"}`.
- A duplicate that loses a race on the insert is rolled back whole and answered the same way, so a concurrent retry is a replay, never a `500`.

The id names an intent, not a body. If the text changes, the client generates a new id; the `commandRequestId` helper in `apps/web/src/lib/commands.ts` keeps the id only for a retry of the same text. The mapping lives in `command_requests` (migration 2), one row per command with `UNIQUE (message_id)`.

### Real-time events

```http
GET /conversations/:id/events
```

This is a WebSocket upgrade scoped to one conversation. An unknown conversation is rejected with `404 {"error":"Unknown conversation: ..."}` before the upgrade.

Server frames:

```json
{ "type": "ready", "conversationId": "conv-engineering" }
```

```json
{
  "type": "message.created",
  "conversationId": "conv-engineering",
  "seq": 3,
  "message": {
    "seq": 3,
    "id": "0ad68472-56c9-4da6-92ac-6c255d5fa337",
    "author": "grok08",
    "text": "hello from GitPing",
    "command": "git commit",
    "createdAt": "2026-11-15T12:48:50.664Z",
    "reverted": false,
    "stashed": false
  }
}
```

```json
{
  "type": "message.updated",
  "conversationId": "conv-engineering",
  "seq": 3,
  "message": {
    "seq": 3,
    "id": "0ad68472-56c9-4da6-92ac-6c255d5fa337",
    "reverted": true,
    "stashed": false
  }
}
```

```json
{ "type": "pong" }
{ "type": "error", "error": "Malformed frame: expected JSON" }
```

Client frames are limited to a keepalive:

```json
{ "type": "ping" }
```

Rules the server and client rely on:

- The event is sent only after the message transaction commits. A rolled-back write is never broadcast.
- Both `POST /conversations/:id/commands` and `POST /commands` broadcast.
- The event goes only to clients subscribed to that conversation.
- `message.updated` is sent after a state transaction commits, once per affected message, by `git revert`, `git stash`, and `git stash pop`. The client merges by id, so the row is replaced in place and keeps its `seq`.
- Branch and switch broadcast nothing: branch context is per member, and the actor receives the new list in its response.
- The upgrade checks the `Origin` header against the same allowlist as CORS, because CORS does not apply to WebSocket upgrades.
- The client pings every 25 s and reconnects if no frame arrives within 10 s, so a silent socket cannot keep looking `Live`.
- A client that cannot drain its socket past 1 MiB is closed, so it reconnects and catches up instead of growing a buffer.
- `seq` is the ordering key; a client sorts by it and de-duplicates by message id.
- The client renders confirmed messages only, so it never shows a pending copy next to the real one.
- On reconnect the client refetches `GET /conversations/:id/messages` and merges it, which closes gaps without duplicates.
- A replayed command publishes nothing: a retried send is one event, not two.

The implementation uses Hono's Bun WebSocket adapter: the route upgrades through `upgradeWebSocket`, `Bun.serve` receives the paired `websocket` handler, and `apps/api/src/realtime/hub.ts` holds the per-conversation registry.

Two designs are written down but not implemented, because this deployment does not need them yet:

- [docs/realtime-outbox.md](docs/realtime-outbox.md): a transactional outbox, so a crash between the commit and the broadcast cannot leave a pushed message behind.
- [docs/realtime-catch-up.md](docs/realtime-catch-up.md): an `after=<seq>` catch-up, so a reconnect does not refetch the whole conversation.

One design is implemented: [docs/realtime-idempotency.md](docs/realtime-idempotency.md). A client-named `requestId` lets a retry after a lost response resolve to the message that already exists instead of creating a second one.

---

## Database

The development SQLite database is stored under:

```text
apps/api/data/gitping.db
```

The database uses a versioned migration runner (`PRAGMA user_version`). Schema version 1 is the Git-native domain model:

```text
users
├── id, handle, display_name, avatar, role, created_at

conversations
├── id, name, kind (channel | direct), created_by, created_at

conversation_members
├── conversation_id, user_id, joined_at, last_read_at, current_branch_id

branches
├── id, conversation_id, name, head_message_id, created_from_branch_id, created_at

messages
├── seq (commit order), id, conversation_id, branch_id, author_id, text, created_at

git_commands
├── id, message_id, verb, raw, args (parsed command as JSON), parsed_at

message_events
├── id, message_id, type (created | reverted | stashed | unstashed | merged), payload, created_at
```

Schema version 2 adds one table, for client-named commands:

```text
command_requests
├── id (the client's requestId), conversation_id, message_id (UNIQUE), author_id, created_at
```

Schema version 3 adds branch context to membership and backfills it to `main`:

```sql
ALTER TABLE conversation_members
  ADD COLUMN current_branch_id TEXT REFERENCES branches(id);
```

A member is always on exactly one branch of the conversation. `NULL` is treated as `main` on read, so a member created before the backfill still resolves. Message state is not stored in a column: `reverted` and `stashed` are derived in the message repository's `SELECT` from `message_events`, which makes the answer a pure function of the event set rather than of event order.

A message is a human-visible line plus the Git command that produced it. The parser output is stored on `git_commands.args`, and every write also records a `created` event so the history can grow into revert, stash, and merge semantics without rewriting rows. `command_requests` maps a request id to the message it produced, so a retry resolves to that row instead of writing a second message.

On first run the API creates the schema, seeds four users, six conversations, and eight branches, and backfills any rows from the pre-migration `messages` table into `engineering` on `main`. A conversation created later adds its membership and `main` branch inside one transaction, so a conversation never exists without a branch.

Phase 3 needed no schema change.

Phase 4 added migration 2 for idempotent commands. Ordering still uses the existing `messages.seq`, and `message_events` already records the `created` event per message.

Phase 5 added migration 3 for branch context. `PRAGMA user_version` is now 3.

Inspect a database file:

```bash
bun run db:inspect apps/api/data/gitping.db
```

---

## Development

Install dependencies from the repository root:

```bash
bun install
```

Start the API:

```bash
bun run dev:api
```

The API runs on:

```text
http://localhost:3000
```

Start the frontend in another terminal:

```bash
bun run dev:web
```

The frontend runs on:

```text
http://localhost:5173
```

---

## Verification

One command runs every check (typecheck, lint, unit tests, build, browser tests):

```bash
bun run check
```

Individual checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:e2e
```

The browser suite needs Chromium once per machine:

```bash
cd apps/web
bun x playwright install chromium
```

Check the API:

```bash
curl http://localhost:3000/health
```

Send a test message:

```bash
curl -X POST http://localhost:3000/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git commit -m \"hello from GitPing\"","author":"grok08"}'
```

Read persisted messages:

```bash
curl http://localhost:3000/messages
```

Read conversations, members, and branches:

```bash
curl http://localhost:3000/conversations
curl http://localhost:3000/conversations/conv-engineering/members
curl http://localhost:3000/conversations/conv-engineering/branches
```

Create a conversation and commit into it:

```bash
curl -X POST http://localhost:3000/conversations \
  -H "Content-Type: application/json" \
  -d '{"name":"architecture","kind":"channel"}'

curl -X POST http://localhost:3000/conversations/conv-channel-architecture/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git commit -m \"first note\"","branch":"main"}'
```

Send the same command twice with one `requestId`, and the second response repeats the first message with an `Idempotent-Replay: true` header instead of creating a second commit:

```bash
curl -i -X POST http://localhost:3000/conversations/conv-channel-architecture/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git commit -m \"retry me\"","branch":"main","requestId":"6f1f0b0e-5c3e-4b7e-9a51-2f0a3a1f0c11"}'
```

Work with branches, reverts, merges, and stashes through the same endpoint:

```bash
curl -X POST http://localhost:3000/conversations/conv-channel-architecture/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git switch -c release","branch":"main"}'

curl -X POST http://localhost:3000/conversations/conv-channel-architecture/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git revert 0ad68472","branch":"release"}'

curl -X POST http://localhost:3000/conversations/conv-channel-architecture/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git merge main","branch":"release"}'

curl -X POST http://localhost:3000/conversations/conv-channel-architecture/commands \
  -H "Content-Type: application/json" \
  -d '{"input":"git stash","branch":"release"}'

curl http://localhost:3000/conversations/conv-channel-architecture/stashes
```

Every phase keeps browser evidence under `evidence/`. See `AGENTS.md` for the rule.

---

## Design Principles

### Chat first

GitPing should look like a modern messaging application.

Git syntax is the interaction model, not the entire visual language.

### Git-native context

Branches, commits and other Git concepts should become meaningful conversation primitives.

### Server-authoritative persistence

A message is not considered persisted until SQLite confirms the write through the API. The browser renders only confirmed messages and merges them by server id, so realtime delivery can never invent or duplicate one.

### Small vertical slices

New functionality should be built in complete, testable flows:

```text
UI
→ API
→ domain logic
→ database
→ API
→ UI
```

### Avoid premature infrastructure

Do not introduce distributed infrastructure until the product actually requires it.

---

## Roadmap

The current implementation is the first vertical slice.

Planned development:

```text
Foundation
    ↓
Persistent conversations
    ↓
Persistent branches
    ↓
Real-time messaging
    ↓
Command autocomplete/history
    ↓
Real search
    ↓
Authentication
    ↓
GitHub integration
    ↓
Security & reliability
    ↓
Production deployment
```

See [`PLAN.md`](./PLAN.md) for the detailed roadmap.

---

## Long-term Vision

GitPing is exploring a different messaging model:

```text
Traditional chat

message → conversation


GitPing

command
   ↓
Git operation
   ↓
conversation event
   ↓
message
   ↓
branch/history
```

The long-term goal is to make version-control concepts useful for human communication:

```text
commit
branch
switch
revert
stash
merge
show
log
```

The challenge is to make those concepts genuinely useful rather than turning normal conversation into a collection of Git gimmicks.

---

## Project Structure

```text
gitping/
│
├── apps/
│   ├── api/                 # Hono/Bun backend
│   └── web/                 # React/Vite frontend
│
├── packages/
│   └── command-engine/      # Git command parser and tests
│
├── data/                    # Development data when applicable
├── package.json             # Root workspace configuration
└── bun.lock                 # Bun lockfile
```

---
