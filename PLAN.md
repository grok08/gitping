# GitPing — Project Plan

## Current State

GitPing has completed the first end-to-end vertical slice:

```text
React UI
   ↓
POST /commands
   ↓
Hono API
   ↓
command-engine validation
   ↓
SQLite
   ↓
API response
   ↓
React conversation
```

Current foundation includes:

- Bun workspace/monorepo setup
- React + TypeScript + Vite frontend
- Bun + Hono API
- Bun SQLite persistence
- `command-engine` package with parser and tests
- `/health`
- `/messages`
- `/commands`
- `/conversations` and per-conversation messages, members, and branches
- Git command based message composer
- Persistent channels and direct messages, created through the UI
- Light/dark themes
- Collapsible conversation sidebar
- Focus-mode chat layout
- Global and conversation-scoped search UI
- Workspace and conversation member panels
- Branch selector with transient top-center notification

The next work should move from "single local vertical slice" to "real multi-user Git-native messaging."

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| 1. Stabilize the foundation | Complete | `evidence/phase-1/README.md` |
| 2. Model GitPing properly | Complete | `evidence/phase-2/README.md` |
| 3. Real conversation persistence | Complete | `evidence/phase-3/README.md` |
| 4. Real-time messaging | Complete | `evidence/phase-4/README.md` |
| 5. Git-native conversation model | Complete | `evidence/phase-5/README.md` |
| 6 through 12 | Not started | |

---

# Phase 1 — Stabilize the Foundation

## 1. Clean the monorepo

- Remove accidental/duplicated root application files if they are no longer used.
- Keep package boundaries clear.
- Ensure only the root owns the workspace configuration.
- Ensure `packages/command-engine` is a real workspace package.
- Remove unnecessary nested `node_modules` where Bun workspace installation allows.
- Standardize TypeScript configuration.
- Add root-level scripts for build, test, lint and development.

## 2. Establish a reliable validation pipeline

Add:

```text
bun run build
bun run test
bun run lint
bun run check
```

The goal is a clean install followed by one predictable validation command.

## 3. Improve API structure

Move beyond a single large API file.

Suggested structure:

```text
apps/api/src/
├── index.ts
├── db.ts
├── routes/
├── services/
├── repositories/
└── types/
```

Keep HTTP handling, business logic and persistence separated.

## 4. Break the React UI into feature modules

The current React UI should be split from a large `App.tsx` into feature-based modules. React does not have a direct equivalent of Angular `NgModule`; the intended structure is components + hooks + services + feature folders.

Target structure:

```text
apps/web/src/
├── App.tsx
├── main.tsx
├── features/
│   ├── chat/
│   │   ├── ChatPage.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   ├── Composer.tsx
│   │   └── chat.css
│   ├── conversations/
│   │   ├── ConversationSidebar.tsx
│   │   ├── ConversationItem.tsx
│   │   └── conversations.css
│   ├── branch/
│   │   ├── BranchSelector.tsx
│   │   └── BranchNotification.tsx
│   ├── search/
│   │   ├── GlobalSearch.tsx
│   │   └── ConversationSearch.tsx
│   ├── members/
│   │   ├── WorkspaceMembers.tsx
│   │   └── ConversationMembers.tsx
│   └── workspace/
│       ├── Sidebar.tsx
│       └── WorkspaceHeader.tsx
├── components/
│   └── ui/
│       ├── Avatar.tsx
│       ├── Button.tsx
│       ├── IconButton.tsx
│       └── Modal.tsx
├── hooks/
│   ├── useTheme.ts
│   ├── useSidebar.ts
│   └── useKeyboardShortcuts.ts
├── lib/
│   └── api.ts
├── types/
│   ├── message.ts
│   ├── conversation.ts
│   └── workspace.ts
└── styles/
    ├── tokens.css
    └── globals.css
```

Refactor goals:

- Make `App.tsx` an application composition/root shell rather than the place for feature logic.
- Group code by product capability rather than by file type alone.
- Keep shared UI primitives in `components/ui`.
- Move reusable stateful behavior into hooks.
- Keep API calls and external interactions in `lib`/services.
- Define shared domain types separately from components.
- Break the large stylesheet into global tokens plus feature-level styles.
- Keep feature boundaries clear so future work can be added without growing another UI monolith.

A useful mapping from Angular concepts is:

```text
Angular NgModule    → React feature folder
Angular Component   → React component
Angular Service     → React hook / service / utility
Angular Directive   → React hook / component behavior
Angular Pipe        → React utility / formatter
SharedModule        → shared UI components
```

Do not split every small JSX fragment into its own file. Split around meaningful product concepts such as chat, conversations, search, branches, members and workspace navigation.

The refactor should preserve the current UI and behavior; this phase is primarily architectural restructuring, not a visual redesign.

---

# Phase 2 — Model GitPing Properly

The current `messages` table is enough for the first slice, but GitPing eventually needs explicit domain concepts.

Define:

```text
User
Conversation
ConversationMember
Message
GitCommand
Branch
MessageEvent
```

A message should eventually represent both:

```text
human-visible message
+
Git operation that produced it
```

This allows GitPing to understand commands instead of storing them only as strings.

Potential relationship:

```text
Conversation
   │
   ├── Branch
   │      │
   │      └── Message
   │
   └── Members
```

---

# Phase 3 — Real Conversation Persistence

Currently the UI can display messages, but the conversation model is still largely local/mock state.

Build persistent:

- channels
- direct messages
- members
- conversation metadata
- branches

The UI should request conversations from the backend instead of keeping the conversation list hard-coded.

Endpoints could evolve toward:

```text
GET    /conversations
POST   /conversations

GET    /conversations/:id/messages
POST   /conversations/:id/commands

GET    /conversations/:id/members
GET    /conversations/:id/branches
```

---

# Phase 4 — Real-Time Messaging

Once persistence is solid, add real-time delivery.

Preferred first option:

```text
WebSocket
```

Flow:

```text
Client A
   ↓
Hono
   ↓
SQLite
   ↓
broadcast
   ↓
Client B
```

Requirements:

- reconnect handling
- connection lifecycle
- duplicate-event protection
- ordering guarantees
- offline/reconnect behavior
- optimistic vs confirmed messages
- server-authoritative message IDs

Do this only after the HTTP persistence model is stable.

## Phase 4 result

Complete. `GET /conversations/:id/events` upgrades to a WebSocket scoped to one conversation. A commit is written inside its transaction and broadcast only after it commits, from both `POST /conversations/:id/commands` and the compatibility `POST /commands`. The browser keeps SQLite as the source of truth: no optimistic message is rendered, broadcasts and HTTP responses merge by server id, order comes from `messages.seq`, and every reconnect refetches persisted history and merges it. The chat header shows `Live`, `Connecting`, `Reconnecting`, or `Offline`, with bounded exponential backoff.

No schema change was needed. `messages.seq` and `message_events` already covered ordering and the event hook, so `PRAGMA user_version` stays at 1. A hardening pass added a client heartbeat, an origin check on the upgrade, buffer-overflow eviction, a frame-to-conversation guard, monotonic previews, jittered reconnects, and per-test conversation isolation. Evidence, including the deliberate visual parity update, is in `evidence/phase-4/README.md`.

---

# Phase 5 — Git-Native Conversation Model

This is where GitPing becomes differentiated.

## Branches

A conversation can have branches:

```text
main
 ├── feature-ui
 ├── experiment-auth
 └── weekend
```

Users can:

```text
git branch
git switch feature-ui
git switch -c experiment-auth
```

The UI should treat branch context as first-class state.

## Revert

Explore:

```text
git revert <message>
```

as a safe way to represent a reverted message/event.

Do not actually delete history.

## Stash

Explore a conversation-level equivalent of:

```text
git stash
git stash pop
```

for temporarily hiding or saving conversational work.

## Merge

Explore:

```text
git merge <branch>
```

for combining branches of a conversation.

The semantics must be clearly defined before implementation.

## Phase 5 result

Complete. Branches, revert, merge, and stash are persisted operations, defined in `docs/phase-5-git-native.md` and implemented against it. Content commands (`commit`, `revert`, `merge`) produce messages; context commands (`branch`, `switch`, `stash`) return state and produce none. A member's branch lives on `conversation_members.current_branch_id`, message state is derived from `message_events`, and a `message.updated` frame carries revert and stash changes to every connected client. Migration 3 adds the branch column and its backfill; migrations 1 and 2 are untouched. Evidence, including the review's negative control, is in `evidence/phase-5/README.md`.

---

# Phase 6 — Command Experience

The composer is the central GitPing interaction.

Build:

- command autocomplete
- command validation
- command suggestions
- command history
- keyboard navigation
- argument hints
- inline errors
- command preview
- branch-aware suggestions
- command documentation/help

Example:

```text
$ git sw
  git switch main
  git switch weekend
  git switch feature-ui
```

The command experience should feel like an excellent developer tool while the conversation itself still feels like a chat application.

---

# Phase 7 — Search

Turn the current UI into real backend search.

Global:

```text
Ctrl+K / Cmd+K
```

should search:

- conversations
- users
- branches
- message content

Conversation search should search only:

```text
current conversation
+
current branch/context when applicable
```

Eventually support filters such as:

```text
author:grok08
command:commit
branch:feature-ui
after:2026-10-01
```

---

# Phase 8 — Identity and Authentication

Introduce real users.

Potential direction:

```text
GitHub OAuth
```

because GitPing is Git-native and developer-oriented.

After authentication:

- associate messages with users
- persist profile data
- manage conversation membership
- support user presence
- enforce authorization

Do not implement authentication until the core domain and APIs are stable.

---

# Phase 9 — GitHub Integration

After the core messaging product works, investigate GitHub integration.

Potential capabilities:

- GitHub identity/profile
- repository context
- branch synchronization
- commit linking
- pull request linking
- issue references
- repository activity
- GitHub App integration

Possible future interaction:

```text
git commit -m "Fix login flow"
```

could optionally reference repository/branch context.

---

# Phase 10 — Reliability and Security

Before calling the application production-ready:

## Backend

- input validation
- authorization
- rate limiting
- request size limits
- structured logging
- error classification
- graceful shutdown
- database backup strategy

## Database

- migrations
- indexes
- foreign keys
- transaction boundaries
- concurrency behavior
- retention strategy

## Frontend

- error recovery
- reconnect state
- loading states
- accessibility
- keyboard navigation
- mobile behavior
- state synchronization

## Security

- authentication
- authorization
- CSRF strategy where relevant
- CORS restrictions
- injection protection
- command parsing hardening
- abuse/rate limiting

---

# Phase 11 — Production Architecture

Only after the local product is complete should we decide deployment architecture.

Possible target:

```text
Browser
   │
   ▼
Frontend
   │
   ▼
API
   │
   ├── SQLite/local deployment initially
   │
   └── scalable database later if required
```

Deployment decisions should be driven by actual requirements rather than introducing infrastructure early.

---

# Phase 12 — Product Polish

Final UX pass:

- message grouping
- timestamps
- presence
- unread state
- notifications
- branch transitions
- command animations
- empty states
- error states
- keyboard shortcuts
- responsive layout
- accessibility
- performance

The visual language should remain:

```text
layered neutrals
+
restrained ice-blue accent
+
Git-native details
```

without turning the application into a terminal.

---

# Recommended Build Order

The safest sequence is:

```text
1. Stabilize monorepo
2. API/domain separation
3. React feature modularization
4. Persistent conversations
5. Persistent branches
6. Real-time messaging
7. Command autocomplete/history
8. Real search
9. Authentication
10. GitHub integration
11. Security/reliability hardening
12. Production deployment
13. Final UX polish
```

The most important architectural rule is:

> Build one verifiable vertical slice at a time.

For every major phase:

```text
implement
→ test
→ verify
→ commit
→ continue
```
