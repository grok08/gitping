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

GitPing currently has a working first end-to-end vertical slice:

```text
React
  │
  │ POST /commands
  ▼
Hono
  │
  │ validate command
  ▼
command-engine
  │
  │ INSERT
  ▼
SQLite
  │
  │ created message
  ▼
Hono response
  │
  ▼
React conversation
```

The current implementation is an early product foundation rather than a production-ready messaging service.

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

- channels
- direct conversations
- message history
- command composer
- branch selector
- conversation search
- global search
- workspace members
- conversation members
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
│   │   ├── src/
│   │   │   ├── db.ts
│   │   │   └── index.ts
│   │   └── data/
│   │       └── gitping.db
│   │
│   └── web/
│       └── src/
│           ├── App.tsx
│           ├── App.css
│           └── lib/
│               └── api.ts
│
├── packages/
│   └── command-engine/
│       └── src/
│           ├── parser.ts
│           └── parser.test.ts
│
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

A message currently follows this path:

```text
User types:

git commit -m "hello"

        │
        ▼

React composer

        │
        │ POST /commands
        ▼

Hono API

        │
        ▼

command-engine

        │
        │ validate
        ▼

SQLite

        │
        │ INSERT
        ▼

created message

        │
        ▼

Hono response

        │
        ▼

React state

        │
        ▼

message appears in conversation
```

SQLite is the persistence source of truth.

The frontend should only treat a message as persisted after the backend successfully creates it.

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
  "database": true
}
```

### Messages

```http
GET /messages
```

Returns persisted messages ordered chronologically.

### Commands

```http
POST /commands
```

Request:

```json
{
  "input": "git commit -m \"hello from GitPing\"",
  "author": "grok08"
}
```

Response:

```json
{
  "message": {
    "id": "...",
    "author": "grok08",
    "text": "hello from GitPing",
    "command": "git commit",
    "createdAt": "..."
  }
}
```

---

## Database

The development SQLite database is stored under:

```text
apps/api/data/gitping.db
```

The initial message model contains:

```text
messages
├── id
├── author
├── text
├── command
└── created_at
```

The database is created automatically by the API when necessary.

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
bun run --cwd apps/web dev
```

The frontend runs on:

```text
http://localhost:5173
```

---

## Verification

Run the command-engine tests:

```bash
bun --filter @gitping/command-engine test
```

Build the frontend:

```bash
bun run --cwd apps/web build
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

---

## Design Principles

### Chat first

GitPing should look like a modern messaging application.

Git syntax is the interaction model, not the entire visual language.

### Git-native context

Branches, commits and other Git concepts should become meaningful conversation primitives.

### Server-authoritative persistence

A message is not considered persisted until SQLite confirms the write through the API.

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
