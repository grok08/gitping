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

The current implementation is an early product foundation rather than a production-ready messaging service.

The conversation list, member counts, last-message previews, branch lists, and per-conversation message history are read from SQLite. Creating a channel or direct message writes the conversation, its membership, and its `main` branch in one transaction. A commit is persisted before it is broadcast, so a client never sees a message SQLite does not have.

---

## Features

### Git-native messaging

The composer accepts Git commands such as:

```bash
git commit -m "hello"
git commit --amend
git log
git show
git branch
git switch
git switch -c feature-ui
git status
git fetch
git pull
git push
git revert
git stash
git stash list
git stash pop
git config user.name
git config user.email
```

The command parser lives in the `command-engine` workspace package.

### Messaging UI

The frontend currently provides:

- real-time delivery over one WebSocket per conversation
- a connection indicator (`Live`, `Connecting`, `Reconnecting`, `Offline`)
- reconnect catch-up from persisted history with no duplicates
- channels and direct conversations loaded from the API
- server-computed member counts and last-message previews
- message history per conversation
- command composer scoped to the selected conversation and branch
- branch selector driven by the conversation's branches
- conversation search
- global search
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
│   │       └── types/
│   │
│   └── web/
│       └── src/
│           ├── App.tsx           # composition root
│           ├── features/         # chat, conversations, branch, search, members, workspace
│           ├── components/ui/    # avatar, presence dot, side panel
│           ├── hooks/            # theme, sidebar, shortcuts, connection socket
│           ├── lib/              # API client, message merge, realtime parsing, formatting
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
  "schemaVersion": 1
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
  "branch": "main"
}
```

`branch` defaults to `main`. The response is the `POST /commands` message shape. An unknown branch or invalid command returns `400`; an unknown conversation returns `404`.

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

Returns `id`, `name`, and `headMessageId` per branch, with `main` first. Every unknown conversation id on a nested route returns `404` with `{ "error": "Unknown conversation: ..." }`.

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
    "created_at": "..."
  }
]
```

`seq` is the conversation-independent commit order. It is the ordering key clients use for realtime events.

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
  "branch": "main"
}
```

`conversation` and `branch` are optional and default to `engineering` on `main`. The browser now uses `POST /conversations/:id/commands`; this route remains for compatibility and direct API use. Response:

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
    "createdAt": "2026-11-15T12:48:50.664Z"
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
- The upgrade checks the `Origin` header against the same allowlist as CORS, because CORS does not apply to WebSocket upgrades.
- The client pings every 25 s and reconnects if no frame arrives within 10 s, so a silent socket cannot keep looking `Live`.
- A client that cannot drain its socket past 1 MiB is closed, so it reconnects and catches up instead of growing a buffer.
- `seq` is the ordering key; a client sorts by it and de-duplicates by message id.
- The client renders confirmed messages only, so it never shows a pending copy next to the real one.
- On reconnect the client refetches `GET /conversations/:id/messages` and merges it, which closes gaps without duplicates.

The implementation uses Hono's Bun WebSocket adapter: the route upgrades through `upgradeWebSocket`, `Bun.serve` receives the paired `websocket` handler, and `apps/api/src/realtime/hub.ts` holds the per-conversation registry.

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
├── conversation_id, user_id, joined_at, last_read_at

branches
├── id, conversation_id, name, head_message_id, created_from_branch_id, created_at

messages
├── seq (commit order), id, conversation_id, branch_id, author_id, text, created_at

git_commands
├── id, message_id, verb, raw, args (parsed command as JSON), parsed_at

message_events
├── id, message_id, type (created | reverted | stashed | merged), payload, created_at
```

A message is a human-visible line plus the Git command that produced it. The parser output is stored on `git_commands.args`, and every write also records a `created` event so the history can grow into revert, stash, and merge semantics without rewriting rows.

On first run the API creates the schema, seeds four users, six conversations, and eight branches, and backfills any rows from the pre-migration `messages` table into `engineering` on `main`. A conversation created later adds its membership and `main` branch inside one transaction, so a conversation never exists without a branch.

Phase 3 needed no schema change. `PRAGMA user_version` stays at 1.

Phase 4 needed no schema change either. Ordering uses the existing `messages.seq`, and `message_events` already records the `created` event per message, so `PRAGMA user_version` is still 1.

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
