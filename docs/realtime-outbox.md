# Realtime durability: transactional outbox

Status: design only, not implemented. Written after Phase 4, when the crash window below was accepted knowingly.

## The gap this closes

A commit is durable before anyone is told about it, which is the important half:

```text
POST /conversations/:id/commands
  → createCommandService.send
      → db.transaction: insert message, git command, event, move branch head
      → events.publish({ type: "message.created", ... })   ← in-process, after commit
  → HTTP 201
```

`apps/api/src/services/command-service.ts` calls `publish` after `write()` returns, so a rolled-back write is never broadcast. The remaining hole is a process death between the two:

```text
SQLite commit  ──✕──  publish  →  client
        │
        └── row exists, nobody was told
```

What the user sees depends on where the process died:

| Death point | Row | Push | HTTP response | What the sender sees |
| --- | --- | --- | --- | --- |
| during the transaction | rolled back | none | connection error | command failed, nothing stored |
| after commit, before publish | committed | none | connection error | command failed, but it is stored |
| after publish, before response | committed | delivered | connection error | command failed, but it is stored and others saw it |

The last two also create the retry-duplicate risk that client-side idempotency would address.

Today the symptom heals on the next socket open: catch-up refetches `GET /conversations/:id/messages` and merges. A client that stays connected never learns, and a sender who retries creates a second message with a second id.

## When to build this

Build it when any of these becomes true:

- more than one API process serves the same database;
- the hub stops being in-process (a broker, a second server, a worker);
- a committed message is ever observed to be missing from a connected client without a reconnect.

Until then the window is a few microseconds of process death in a single-process local app, and the dispatcher below is another component that can fail quietly.

## Design

### Schema: migration 2

Migration 1 stays untouched. Add migration 2 with its own version and a migration test.

```sql
CREATE TABLE realtime_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dispatched_at TEXT
);

CREATE INDEX idx_realtime_outbox_pending
  ON realtime_outbox(id)
  WHERE dispatched_at IS NULL;
```

`UNIQUE (message_id)` makes a second enqueue for the same message impossible, which matters if the dispatcher is ever retried around a transaction. The partial index keeps the pending scan proportional to the backlog, not to history.

`payload` holds the serialized `message.created` event exactly as the writer intended it. Rebuilding the event at dispatch time from `messages` plus `git_commands` is possible and saves a few hundred bytes per row, but it moves the event's shape into the dispatcher and makes a future payload change a schema-compatibility question. Store it.

### Write path

The enqueue goes inside the existing transaction, in `apps/api/src/repositories/outbox-repository.ts` (SQL stays in repositories):

```ts
const write = db.transaction((): MessageRow => {
  const row = messages.insert({ ... });
  branches.setHead(branch.id, row.id);

  outbox.enqueue({
    messageId: row.id,
    conversationId: conversation.id,
    payload: JSON.stringify({
      type: "message.created",
      conversationId: conversation.id,
      seq: row.seq,
      message: toRecord(row),
    }),
    createdAt: row.created_at,
  });

  return row;
});
```

The command service no longer receives a `RealtimePublisher`. It writes the outbox row and returns; delivery becomes the dispatcher's job.

### Dispatcher

`apps/api/src/realtime/outbox-dispatcher.ts`:

```ts
createOutboxDispatcher({ db, hub, batchSize = 100, intervalMs = 1000 })
```

- `drain()` claims the oldest `batchSize` pending rows with `dispatched_at IS NULL ORDER BY id`, publishes each to the hub, then sets `dispatched_at`.
- `start(intervalMs)` runs `drain` on a timer as a safety net.
- One `drain` at startup recovers anything a previous process left pending.
- The fast path stays as it is today: call `drain()` right after a successful commit so delivery latency does not wait for the timer.
- `stop()` clears the timer on shutdown, before `hub.closeAll()`.

Order is `id` order, which is commit order, because the row is inserted in the same transaction that assigns `messages.seq`.

### Delivery guarantee

At-least-once. Marking after publish means a crash between publish and mark republishes one event. That is the right trade: a duplicate is invisible (the client de-duplicates by message id), a drop is not.

Marking before publish would be at-most-once and would silently lose the push on the same crash, which is the failure this table exists to prevent.

The client already sorts by `seq`, so a retry that delivers an older event after a newer one lands in the right place rather than at the bottom.

### Retention

Dispatched rows are not useful once published, but they are cheap and they are evidence. Either keep them or sweep on a timer:

```sql
DELETE FROM realtime_outbox
WHERE dispatched_at IS NOT NULL
  AND dispatched_at < $cutoff;
```

Pick the cutoff with the same policy as any future message retention work; do not invent a second policy here.

### Rejected alternatives

- **Publish inside the transaction.** A rollback would broadcast a message that never existed, which Phase 4 explicitly forbids, and a slow socket would hold the write lock.
- **Publish in `db.transaction`'s `afterCommit`-style hook.** SQLite through `bun:sqlite` has no such hook; emulating it is this design with extra steps.
- **Publish before responding and accept the loss.** That is today's behaviour.
- **A queue service.** Correct, but it is infrastructure the product does not need while one process serves one file.

## Test plan

| Level | Test |
| --- | --- |
| migration | version 2 creates the table and index; running it twice is a no-op; migration 1's database upgrades in place |
| repository | enqueue writes one row; pending reads exclude dispatched rows; mark sets `dispatched_at` once |
| service | an accepted command writes exactly one outbox row; a rejected command writes none |
| integration | a publisher that throws leaves the row pending; the next `drain` delivers it exactly once and marks it |
| integration | a row inserted with no publish (simulating a crash after commit) is delivered by the startup drain to a connected client |
| integration | `drain` twice republishes; assert the payload is identical so the client merge collapses it |
| browser | no new browser test; the reconnect catch-up test already covers the observable recovery |

## Smallest first step

Migration 2 plus `outbox-repository.ts` plus the service change, with the dispatcher called from the same place `publish` is called today. That is already strictly better than the current code: the write and the intent to publish become atomic. The timer and startup drain can follow once there is a second process.
