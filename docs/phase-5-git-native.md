# Phase 5: Git-native conversation model

Status: approved for implementation. This document is the contract the implementation is reviewed against. PLAN.md says the semantics must be defined before implementation; this is that definition.

## Goal

Branches, revert, stash, and merge stop being UI decoration and become persisted domain operations. Each command either produces a conversation message or changes conversation context, and every state change survives a reload and reaches the other client.

## Two kinds of command

The parser already fixes most command shapes (`packages/command-engine/src/parser.ts`). Phase 5 splits commands by what they produce:

| Kind | Commands | Result |
| --- | --- | --- |
| Content | `commit`, `revert`, `merge` | a new message, broadcast to the conversation |
| Context | `branch`, `switch`, `stash`, `stash pop`, `stash list` | state, returned to the caller, no message |
| Rejected | `log`, `show`, `status`, `fetch`, `pull`, `push`, `config`, `init`, `clone` | `400`, unchanged |

A context command produces no message because it changes where work lands, not what the conversation says. Git behaves the same way: `git branch` and `git stash` add nothing to the log.

`git merge` is not in the parser today. Adding `{ type: "merge"; branch: string }` is part of this phase, with parser tests.

## Data model: migration 3

Migration 1 and 2 stay untouched. Migration 3 adds two things.

### Branch context belongs to the member

HEAD in Git belongs to a working copy. In GitPing, the working copy is the member's view of one conversation, so the column goes on `conversation_members`:

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

A member is always on exactly one branch of that conversation. `NULL` is treated as `main` on read, so a member created before the backfill still resolves.

### Message state comes from events, not columns

`message_events` exists for this. Add one event type, `unstashed`; the union becomes `created | reverted | stashed | unstashed | merged`. Message flags are derived in the message repository's SELECT, so a message row never carries a boolean that can drift:

```sql
EXISTS (SELECT 1 FROM message_events e
        WHERE e.message_id = m.id AND e.type = 'reverted') AS reverted,
EXISTS (SELECT 1 FROM message_events e
        WHERE e.message_id = m.id AND e.type = 'stashed')
  AND NOT EXISTS (SELECT 1 FROM message_events e
                  WHERE e.message_id = m.id AND e.type = 'unstashed') AS stashed
```

Order does not matter, so the derivation is a pure function of the event set rather than of event order.

`MessageRow` gains `reverted: boolean` and `stashed: boolean`; `MessageRecord` gains the same. Reads return every message with its flags; the client decides what to show.

### Event payloads

| Event | Payload | Written by |
| --- | --- | --- |
| `reverted` | `{ "byMessageId": "<revert message id>" }` on the reverted message | `git revert` |
| `stashed` | `{ "note": "..." \| null }` on the stashed message | `git stash` |
| `unstashed` | `{ "byMessageId": "<pop command>" }` on the restored message (id is generated, the command makes no message) | `git stash pop` |
| `merged` | `{ "sourceBranchId", "sourceBranchName", "targetBranchId", "sourceHeadMessageId", "targetHeadMessageId" }` on the merge message | `git merge` |

## Commands

### Branches

- `git branch` returns the branch list with the current branch marked. No write.
- `git branch <name>` creates a branch from the current branch's head. No message, no head move.
- `git switch <name>` requires an existing branch in this conversation, sets `current_branch_id`. No message.
- `git switch -c <name>` creates and switches, in one transaction.
- Name rule: `/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/`, not `HEAD`. Duplicate in the conversation is `409`; invalid name is `400`.
- Branches are case-sensitive, like Git.

`GET /conversations/:id/branches` gains `current: boolean` per branch and keeps `main` first. The client selects the `current` branch on load, so a reload no longer drops the user back on `main`.

### Revert

`git revert <target>` where `target` is a full message id or a unique prefix of at least 4 characters, resolved inside the conversation.

- Unknown prefix: `400 Unknown message: <target>`.
- Prefix matching more than one message: `400 Ambiguous message prefix: <target>`.
- Already reverted: `409 Message <prefix> is already reverted`.
- Success creates one message on the **current branch**: text `Revert "<original text>"`, verb `revert`, and writes a `reverted` event on the target with `byMessageId`. The branch head moves to the revert message, like a new commit.
- The target stays in history, flagged `reverted`. Nothing is deleted.
- Reverting a revert is allowed, as Git allows it.

### Merge

`git merge <branch>` merges the named source branch into the current branch.

- Source must exist and differ from the current branch: `400 Unknown branch: <name>` / `400 Cannot merge a branch into itself`.
- Only heads are compared. If the source head equals the current head, or the source head is `null`, the answer is `400 Already up to date`.
- Success creates one message on the current branch: text `Merge branch '<source>' into <current>`, verb `merge`, with a `merged` event carrying both heads, and moves the current branch head to the merge message.
- No messages are copied. The conversation view is already conversation-wide, so a merge records intent and ancestry, it does not partition history.

There is no ancestry graph in the schema, so a merge cannot detect a real common ancestor. This is the honest limit of the recorded-event model and is stated in the evidence.

### Stash

A stash sets conversation work aside without deleting it. Stash state is per conversation, not per member; per-member stashes need identity work and are out of scope.

- `git stash` and `git stash push [-m "note"]` stash the newest message on the current branch that is not already stashed, writing a `stashed` event with the note. Nothing to stash is `400 Nothing to stash on <branch>`.
- `git stash list` returns the stashed messages of the current branch, newest first: `{ id, text, note, createdAt }`. No write.
- `git stash pop [id]` restores the named message, or the newest stash on the current branch when no id is given, by writing an `unstashed` event. No stash to pop is `400 No stash to pop on <branch>`; an unknown id is `400 Unknown stash: <id>`.
- No message is created by any stash command.
- Stashed messages stay in `GET /conversations/:id/messages` with `stashed: true`. The client hides them from the main list; `git stash list` is how you see them.

## HTTP contract

`POST /conversations/:id/commands` and `POST /commands` return a union, not always `{ message }`:

```json
{ "message": { "id": "...", "seq": 12, "reverted": false, "stashed": false } }
{ "branches": [ { "id": "...", "name": "main", "headMessageId": "...", "current": true } ] }
{ "stashes": [ { "id": "...", "text": "...", "note": "wip", "createdAt": "..." } ] }
```

The union is untagged. The client checks `"message" in body`, then `"branches" in body`, then `"stashes" in body`. Branch create, switch, and `stash list` all answer with `branches` or `stashes`; `git stash` and `git stash pop` answer with `stashes` for the current branch so the caller always has the new list.

A new `GET /conversations/:id/stashes` returns the same `stashes` array for the current user's current branch, so the client can refresh without sending a command.

## Realtime

Phase 4 broadcasts `message.created`. State changes need one more frame:

```json
{ "type": "message.updated", "conversationId": "...", "seq": 12, "message": { "id": "...", "reverted": true, "stashed": false } }
```

- Written after the state transaction commits, like `message.created`.
- Sent by revert, stash, and stash pop, once per affected message.
- The client merges by id, so an update replaces the row in place. `mergeMessages` already does this; the frame parser learns the second type.
- Branch and switch broadcast nothing: branch context is per member, and the actor receives the new list in its response.

## UI

- The selector marks the persisted current branch on load and after every command response.
- A reverted message keeps its place, with a `reverted` pill and reduced emphasis.
- A stashed message disappears from the main list; `git stash list` shows a transient notice with the count, and `git stash pop` restores it, with a notice.
- `git switch -c <name>` and `git branch <name>` need no new UI: the composer is the interface, and the selector refreshes from the response.
- Errors keep using the existing error box.

## Slices, in order

Each slice ends with `bun run typecheck`, `bun run lint`, and `bun run test` green before the next starts.

1. **Migration 3 and branch context.** Column, backfill, branch/switch service, `current` flag, response union for branches, tests. No message or event changes.
2. **Revert.** Flag derivation, prefix resolution, revert service and event, `message.updated` broadcast, client parser, tests.
3. **Merge.** Parser command and tests, merge service and event, tests.
4. **Stash.** Events, stash/list/pop, `GET stashes`, tests.
5. **UI and evidence.** Response union wiring, current branch sync, reverted rendering, stash notices, `message.updated` handling, real-API browser tests, screenshots, README and evidence.

## Test plan

| Level | Test |
| --- | --- |
| migration | version 3 creates the column and table, backfills `main`, re-run is a no-op, a version 2 database upgrades in place |
| parser | `git merge <branch>` parses; malformed forms rejected |
| service | each command's success and every documented failure; ids resolved by prefix; ambiguous prefix; double revert; self-merge; up-to-date merge; stash nothing/list/pop; branch duplicate/invalid/unknown switch |
| HTTP | the union shape per command class, 409 for duplicate branch and double revert, 400 for the rest, `current` flag, `GET stashes` |
| realtime integration | `message.updated` reaches both clients after revert and stash, and only the conversation's clients |
| unit | message flag derivation from events (order-independent), prefix matching, `current` selection |
| browser | `git switch -c`, `git revert`, `git merge`, `git stash` then `pop`, each against the real API, with a reload proving persistence and a second client proving the update arrives live; screenshots in `evidence/phase-5/screenshots/` |
| visual parity | no baseline update expected: the reverted pill is new but no baseline shows a reverted message. A changed baseline is a finding, not a refresh |

## Non-goals

- Per-member stash state and per-member revert. Needs identity.
- Branch-filtered history. The conversation view stays conversation-wide, as in Phase 4.
- Ancestry graphs, three-way merge, or conflict resolution.
- Queries (`log`, `show`, `status`) as messages. They remain rejected until Phase 6/7.
- Authentication, GitHub integration, or a stash panel with more than a count.
