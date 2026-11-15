# Realtime catch-up: incremental refetch

Status: design only, not implemented. The current catch-up is correct but unbounded.

## What runs today

Every socket open, including the first one and every reconnect, runs:

```text
useConversationSocket onOpen
  → onCatchUp(conversationId)
      → GET /conversations/:id/messages        ← entire conversation
      → mergeMessages(current, history)        ← de-duplicate by id, sort by seq
```

`apps/web/src/App.tsx` guards it with the active conversation id, and `mergeMessages` makes the result exact: no gaps and no duplicates. The cost is the whole history on every reconnect, plus a sort of everything already on screen.

At the dataset this repository ships with (nine messages) that is free. It stops being free somewhere between a large channel and a long-running one: a laptop that sleeps ten times a day pulls the entire channel ten times, and every client does it at the same moment after a server restart.

## When to build this

Build it when any of these becomes true:

- one conversation's message list exceeds roughly 1 MB of JSON or 200 ms of fetch time;
- reconnects become frequent (mobile, roaming, sleep/wake) or a whole room reconnects at once;
- message rendering starts paginating, because then the client no longer holds the full list and a full refetch becomes wrong, not just slow.

## Design

### Server: one optional query parameter

```http
GET /conversations/:id/messages?after=<seq>
```

- `after` is optional. Absent means "the whole conversation", which is the current behaviour and stays the default.
- Parse it in the route (`apps/api/src/routes/conversations.ts`), not in SQL: a non-integer or negative value returns `400 {"error":"after must be a non-negative integer"}`.
- The service passes it to the repository; the repository owns the SQL:

```sql
${selectMessage}
WHERE m.conversation_id = $conversationId
  AND ($afterSeq IS NULL OR m.seq > $afterSeq)
ORDER BY m.seq ASC
```

- Response shape is unchanged: an array of the same message objects. Ordering is still `seq` ascending.

`messages.seq` is a global autoincrement, so per-conversation values are sparse (5, 9, 12, …). `>` is still exactly right, and gaps from rejected commands or other conversations never matter.

### Client: only ask for what is missing

The catch-up path has the merged list already, so it can ask for the tail:

```ts
const lastSeq = messages.length > 0 ? messages[messages.length - 1].seq : null;

getConversationMessages(conversationId, lastSeq ?? undefined);
```

Rules the client has to keep:

1. **Never send `after` with no baseline.** An empty list means either a fresh conversation or a conversation never loaded; asking for "newer than nothing" would skip history.
2. **The baseline belongs to the conversation, not the app.** The list is reset on switch, so a late request for the previous conversation must not contribute a seq. The existing `activeIdRef` guard and the id-based merge already make a late response harmless; the parameter must be computed from that conversation's list at request time.
3. **No change to merge semantics.** `mergeMessages` still de-duplicates by id and sorts by `seq`, so a response that overlaps what the client already has is safe. The parameter is an optimisation, not a new correctness rule.

### The one case `after` cannot see

If the database is restored from a backup, the client's highest `seq` can be larger than the server's newest, and `after` would return nothing forever while the client shows messages the server no longer has.

Options, in order of cost:

1. **Accept it.** Nothing in this repo restores a database in place, and the browser keeps its state for one session. Record the limit here and move on.
2. **Expose the server's newest seq** as an `X-Latest-Seq` response header and fall back to a full fetch when the client's baseline is higher. Cheap, but it is a second source of truth to keep honest.
3. **Version the conversation**, for example a `conversations.updated_at` that changes on every write, and refetch fully when it moves backwards. Belongs with a real sync protocol.

Do not pick option 3 without a reason to own a sync protocol. Option 1 is the default until a restore workflow exists.

## Why not now

The change adds a branch to the path that guarantees "no gaps on reconnect". That guarantee is worth more than the bytes it saves at this data size, and the branch has two failure modes that only appear when the parameter is wrong: a client with no baseline that sends `after`, and a restored database that is older than the client. Neither is worth carrying while the whole history is nine rows.

## Test plan

| Level | Test |
| --- | --- |
| repository | `list(id)` returns everything; `list(id, seq)` returns only newer rows, in order, with sparse seq values |
| HTTP | `?after=2` returns the tail; `?after=abc` and `?after=-1` return `400`; no parameter keeps the full list |
| client unit | the catch-up request omits `after` for an empty list and uses the last `seq` otherwise |
| browser | drop the socket, commit while away, restore, and assert the reconnect request carries `after=` and the message lands exactly once (extend `tests/e2e/realtime.spec.ts` with `page.waitForRequest`) |

No migration. No change to the event payload.

## Smallest first step

Repository parameter plus the HTTP test. That is useful on its own for scripts, and it makes the client change a two-line follow-up instead of a redesign.
