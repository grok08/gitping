# Realtime idempotency: client-named commands

Status: approved for implementation. This is the design the implementation is reviewed against.

## The gap this closes

`POST /conversations/:id/commands` commits the message, then returns it. If the response never reaches the browser, the sender sees a failure although the commit happened. Pressing send again creates a second message with a second id, and both are legitimately real, so the client's id-based merge cannot collapse them:

```text
POST (request 1) → commit → response lost ─╳→ browser shows error
POST (retry)     → commit → response ok   → browser shows a second message
```

The composer keeps the text on failure and never retries on its own, so a human decides. That is the right default, and it is exactly why the retry needs a name the server can recognise.

## When to build this

Before any automatic retry, queue, or offline send, and before the API is used over a network where a response can be lost. That is now; the change is small enough that carrying the gap is not worth it.

## Design

### Contract

`POST /conversations/:id/commands` and `POST /commands` accept an optional `requestId`:

```json
{
  "input": "git commit -m \"hello\"",
  "branch": "main",
  "requestId": "6f1f0b0e-5c3e-4b7e-9a51-2f0a3a1f0c11"
}
```

- Valid: `/^[A-Za-z0-9_-]{8,64}$/`. Anything else is `400 {"error":"requestId must be 8 to 64 characters of A-Z, a-z, 0-9, _ or -"}`.
- Omitted: current behaviour, one commit per request.
- The id identifies one *intent*, not one body. If the text changes but the id is reused, the first message wins; the client must generate a new id for new text.

### Schema: migration 2

Migration 1 stays untouched. Migration 2 adds:

```sql
CREATE TABLE command_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
```

`UNIQUE (message_id)` keeps the mapping 1:1. `author_id` is stored now so the replay check does not need a second migration when identity lands.

### Service flow

In `createCommandService` (`apps/api/src/services/command-service.ts`), before parsing:

```text
resolve the conversation by id or name        → 404 if unknown
validate requestId if present                 → 400 if malformed   (route does this)
look up the author                            → users.findByHandle(author)
replay lookup when a requestId and an author exist:
  row exists, same conversation, same author  → return that message, 201, no publish
  row exists, different conversation or author → 409 {"error":"Request id already used for another command"}
  no row                                      → continue
parse and validate the command                → 400 if invalid
resolve the branch                            → 400 if unknown
db.transaction: insert message + command + event, move head, insert command_requests row
publish after the transaction commits
```

The replay lookup runs before parsing because a replay does not need the command to be valid again; the stored message is the answer.

The publish stays where it is today, after the transaction, and runs only on the insert path. A replay must not broadcast, or one retry becomes two events.

### Concurrency

The replay lookup and the insert cannot both be outside a transaction. Two identical requests can pass the lookup before either writes, and then serialise on the write: the second insert hits the `command_requests` primary key.

Handling: catch the constraint failure from the request-row insert, re-read the row, and return the same replay response. A `UNIQUE` violation here is a successful idempotent replay, not a 500.

The response to a replay is `201` with the same `{ message }` body and an `Idempotent-Replay: true` header. The header is for tests and debugging; the client ignores it.

### Client

Two pieces, the second is what makes the first work:

1. `sendConversationCommand(conversationId, input, branch, requestId)` sends the field.
2. The composer reuses the id across retries of the same text. A pure helper keeps the rule testable:

```ts
commandRequestId(previous: { id: string; text: string } | null, text: string):
  { id: string; text: string }
```

Returns `previous` when `previous.text === text`, otherwise `{ id: crypto.randomUUID(), text }`. `App.tsx` keeps the last failed request in state, clears it on success, and passes the id through. A fresh id per click would make the key decorative.

## Rejected alternatives

- **Hash of the body as the key.** Two intentional "ping" messages collapse into one.
- **Deduplicate on the client only.** The client cannot tell two real commits apart.
- **Server-generated id echoed to the client.** The client needs the id *before* the first attempt for a retry to reuse it.
- **Deduplicate on `(conversation, author, text)`.** Legitimate repeats are normal in a chat.

## Test plan

| Level | Test |
| --- | --- |
| migration | version 2 creates `command_requests`; run twice is a no-op; a version 1 database upgrades in place |
| repository | insert then find by id; find returns null for an unknown id |
| service | same id twice returns the same message, one message row, one event, one publish; a different conversation with the same id is rejected; a different id creates a second message; no id keeps today's behaviour |
| HTTP | two POSTs with one id return 201/201, the same message id, `Idempotent-Replay: true` on the second, and one row in `messages`; a malformed id is 400 |
| client unit | `commandRequestId` reuses for the same text and generates for changed text |
| browser | intercept the command POST, let it reach the server with `route.fetch()`, abort the response, confirm the UI shows the failure and keeps the text, click send again, assert one message row and the same commit id |

The browser test is the proof for the actual failure: the server committed, the response was lost, the user retried.

## Compatibility

- Additive request field and table; no existing request changes behaviour.
- `GET` shapes unchanged; broadcasts unchanged.
- No UI change, so no visual baseline update is expected.

## Open questions

- Should a replay also return the original `createdAt`, or the time of the retry? Return the stored message unchanged; a retry is not a new fact.
- Should the request row expire? Not now. It is one row per command and it is the audit trail for a replay.
