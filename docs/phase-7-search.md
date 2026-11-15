# Phase 7: Search

Status: planned, ready for implementation. This document is the contract the implementation is reviewed against. PLAN.md says Phase 7 turns the current UI into real backend search. This is the definition of what that search means.

## Goal

Search becomes how a member navigates a Git-native conversation instead of scrolling it. One server endpoint answers every query, the browser renders it in two places, and the answer accounts for branches, stashes, reverts, authors, commands, and dates.

The current state is client-side filtering. `Ctrl+K` focuses the sidebar input, which filters conversation names and previews in the browser. The chat search box filters the already-loaded message array by text, author, or id. Neither reaches the server, and neither knows about users, branches, or filters.

## The two surfaces

| Surface | Opened by | Shows | Scope |
| --- | --- | --- | --- |
| Search palette | `Ctrl+K` or `Cmd+K` | conversations, people, branches, message hits | every conversation the app lists |
| Conversation search | the header search button | message hits only | one conversation, every branch |

The sidebar input stays. It is a fast local filter over conversation names and previews, it already exists, and several visual baselines depend on it. It is not the palette, and it sends no request.

## What matches

Text matching is a case-insensitive substring, which is what both search boxes do today. `ogi` finds `login`. Nobody has to learn a tokenizer to find their own message.

| Group | Columns matched |
| --- | --- |
| conversations | `name`, `preview` |
| users | `handle`, `display_name` |
| branches | `name` |
| messages | `text` |

Filters narrow the messages group only. Names are matched against text alone, so `author:grok08` returns grok08's messages and no people. This keeps one rule to explain and one rule to test.

Message text is the only message column searched. Author, command, branch, and date are filters. Message ids are not searched, because the composer already resolves a revert target by id prefix and the footer shows the short id for copying.

Stashed and reverted messages are returned with their flags. Search is how a member finds what was set aside or undone. Hiding them would hide history the database still has.

## Ranking and limits

| Group | Order |
| --- | --- |
| conversations | name starts with the text, then name contains, then preview contains, then name ascending |
| users | handle starts with the text, then contains, then handle ascending |
| branches | name starts with the text, then contains, then conversation name ascending, then branch name ascending |
| messages | `seq` descending, newest first |

`limit` applies per group. Default 10, minimum 1, maximum 50. `totals` reports the full count per group before the limit, so the palette can say "23 messages" while showing 10, and `truncated` says whether the group was cut.

A message snippet is the message text when it is short. When it is long, the snippet is a window of about 200 characters around the first match with `…` marking a trimmed end. The snippet always contains the matched text, so the client can highlight by substring without a second server field.

## Query grammar

A query is split on whitespace, and double quotes group words. A token is a filter when its prefix before the first `:` is one of the five known filter names. Any other token is text, so `note:` and `http://x` search as text instead of failing.

| Filter | Value | Rule |
| --- | --- | --- |
| `author:` | a handle | case-insensitive equality against `users.handle` |
| `command:` | a verb | exact match against a supported verb, case-insensitive, without `git ` |
| `branch:` | a branch name | case-sensitive equality against `branches.name`, as Git is |
| `after:` | `YYYY-MM-DD` or an ISO timestamp | `created_at` on or after the start of that UTC day |
| `before:` | `YYYY-MM-DD` or an ISO timestamp | `created_at` before the start of that UTC day |

`after:` including the named day and `before:` excluding it matches how a member reads a date range.

An unknown author or branch is not an error. It returns no messages. A rejected query is, because a typo in a filter is worth naming.

At least one text token or filter is required. A blank query is a mistake, not an empty search.

### Rejections

| Case | Response |
| --- | --- |
| blank query | `400 Search query is required` |
| query over 200 characters | `400 Search query is too long (200 characters maximum)` |
| filter with no value | `400 author: needs a value` and the same for the others |
| date that does not parse | `400 after: expects YYYY-MM-DD or an ISO timestamp` |
| unknown command verb | `400 Unknown command: <value>. Supported: commit, revert, merge, branch, switch, stash.` |
| `limit` out of range or not a whole number | `400 limit must be a whole number from 1 to 50` |
| unknown conversation on the scoped route | `404 Unknown conversation: <id>` |

The supported verb list comes from `packages/command-engine`'s catalog, so the sentence cannot drift from what the server routes.

## HTTP contract

Two routes, one parser, one message query.

```text
GET /search?q=<query>&limit=<n>
GET /conversations/:id/search?q=<query>&limit=<n>
```

`q` is URL-encoded and required. The query string is echoed back parsed, so the UI can show the filters it understood instead of guessing.

### Global

```json
{
  "query": {
    "text": "login",
    "filters": {
      "author": "grok08",
      "command": null,
      "branch": null,
      "after": "2026-10-01",
      "before": null
    }
  },
  "groups": {
    "conversations": [
      {
        "id": "conv-engineering",
        "name": "engineering",
        "kind": "channel",
        "memberCount": 4,
        "preview": "Ready to ship?"
      }
    ],
    "users": [
      {
        "id": "user-rahul",
        "handle": "rahul",
        "displayName": "rahul",
        "avatar": "R",
        "role": "developer"
      }
    ],
    "branches": [
      {
        "id": "branch-conv-engineering-weekend",
        "name": "weekend",
        "conversationId": "conv-engineering",
        "conversationName": "engineering",
        "conversationKind": "channel",
        "current": false
      }
    ],
    "messages": [
      {
        "id": "8f14e45f-ceea-467f-a8b1-9f0c3b2d4e11",
        "seq": 12,
        "text": "Fix the login redirect",
        "snippet": "Fix the login redirect",
        "author": "rahul",
        "command": "git commit",
        "createdAt": "2026-10-03T08:43:00.000Z",
        "reverted": false,
        "stashed": false,
        "branch": { "id": "branch-conv-engineering-main", "name": "main" },
        "conversation": {
          "id": "conv-engineering",
          "name": "engineering",
          "kind": "channel"
        }
      }
    ]
  },
  "totals": { "conversations": 1, "users": 0, "branches": 1, "messages": 23 },
  "truncated": {
    "conversations": false,
    "users": false,
    "branches": false,
    "messages": true
  }
}
```

`branches[].current` means the branch is this viewer's current branch in that conversation, resolved the same way the selector resolves it.

### Conversation-scoped

```json
{
  "query": {
    "text": "login",
    "filters": {
      "author": null,
      "command": null,
      "branch": null,
      "after": null,
      "before": null
    }
  },
  "messages": [
    {
      "id": "8f14e45f-ceea-467f-a8b1-9f0c3b2d4e11",
      "seq": 12,
      "text": "Fix the login redirect",
      "snippet": "Fix the login redirect",
      "author": "rahul",
      "command": "git commit",
      "createdAt": "2026-10-03T08:43:00.000Z",
      "reverted": false,
      "stashed": false,
      "branch": { "id": "branch-conv-engineering-main", "name": "main" },
      "conversation": {
        "id": "conv-engineering",
        "name": "engineering",
        "kind": "channel"
      }
    }
  ],
  "total": 3,
  "truncated": false
}
```

A message hit has the same shape on both routes, so one client component renders both.

Every message in the conversation is in scope, including messages on other branches. The chat list is already conversation-wide, so a search that skipped another branch would hide a message the member can scroll to. Each hit names its branch, and `branch:` narrows the scope on request.

## Data access

No migration. The schema is already enough, and `PRAGMA user_version` stays at 3.

A new `apps/api/src/repositories/search-repository.ts` owns every search query. Routes map HTTP, the service validates and assembles, the repository writes SQL. Four queries, one per group, each with `LIMIT` and `COUNT(*) OVER () AS total` so a total never costs a second query.

Substring matching is `instr(lower(column), lower($text)) > 0`. The same `instr` gives the match position for ordering names. Dates compare `messages.created_at` as an ISO string, which sorts correctly because every write stores UTC ISO.

The message query reuses the stashed and reverted derivations from `message-repository.ts` rather than restating them, so a flag cannot mean one thing in the chat list and another in search. That means exporting those two SQL fragments from the module that owns them.

Search results are not filtered by conversation membership. `/conversations` returns every conversation today, and search returns hits in the same set, so search cannot show something the sidebar hides or hide something it shows. Enforcing membership belongs to the identity and authorization work in Phases 8 and 10, where the whole API gets the same rule.

## UI

### The palette

A centered overlay above the app shell, with its own input, grouped results, and a filter legend when idle. It is not a new dependency and not a new route.

| State | Shows |
| --- | --- |
| idle | what can be searched, the five filters, and the `Ctrl K` hint |
| loading | the previous results with a subtle busy state, never an empty flash |
| results | groups in the order Messages, Conversations, People, Branches, each with its total |
| empty | `No matches for "<query>"` |
| error | the server's sentence in the existing error style, with the query intact |

Recognized filters render as read-only chips under the input, built from the echoed `query.filters`. The member sees how the query was read without a second client-side parser.

| Key | Does |
| --- | --- |
| `Ctrl+K` / `Cmd+K` | opens the palette, focuses the input, selects any existing text |
| ArrowDown, ArrowUp | moves the active hit across groups as one list |
| Enter | opens the active hit |
| Escape | closes the palette and restores focus to where it was |
| Tab, Shift+Tab | stays inside the dialog |

The dialog is `role="dialog"` with an accessible name. The input is a `combobox` with `aria-expanded`, `aria-controls`, and `aria-activedescendant`. Results are a `listbox` of `option` children, one flat index over all groups so arrow keys never fall into a dead group.

### Opening a hit

| Hit | Result |
| --- | --- |
| conversation | selects it, closes the palette |
| person | opens the existing new direct message modal with the handle filled in, so nothing is created until the member confirms |
| branch | selects that conversation and sets the visible branch, the same client-side change the branch selector makes |
| message | selects the conversation, focuses that message, closes the palette |

Focusing a message renders all of the conversation's messages, including stashed ones with their pills, scrolls the row into view, and highlights it for about 1.6 seconds. The focus clears on the next send, a conversation change, a branch change, or Escape. Stashed messages are part of that view because a jump to a known row should land on the row, not refuse because the message is set aside.

### Conversation search

The header box starts sending requests. While a query is active the list renders the hits, newest first, and the search bar shows the total instead of the old local count. Each hit from another branch carries its branch name, so a conversation-wide result never looks like it came from the current branch.

Clearing the query returns to normal history. A rejected filter shows the server's sentence in the search bar and leaves the last results on screen.

### Mobile

At 760 px and below the palette fills the viewport, like the sidebar drawer. The 390 px layout is part of the evidence.

### Visual parity

Idle baselines must stay byte-identical. The palette only paints when open, and the focus highlight is transient. New baselines cover the palette idle and the palette with results, in light and dark, plus the mobile layout. A changed idle baseline is a finding, not a refresh.

## Freshness

Search results are a snapshot of the moment the request resolved. A message that arrives over the socket while results are on screen does not change them until the query changes. Merging live frames into search results would need a per-group ordering rule that the phase does not need.

## Slices

Each slice ends with `bun run typecheck`, `bun run lint`, and `bun run test` green before the next one starts.

1. **Contract and plan.** This document, the PLAN.md status repair for Phase 6, and the Phase 7 plan. No code.
2. **Query parser and global text search.** `apps/api/src/search/query.ts` with tests, `search-repository.ts` with text search over all four groups, `search-service.ts`, `GET /search`, HTTP tests. No filters yet.
3. **Filters and the scoped route.** Five filters with rejections, date handling, `GET /conversations/:id/search`, totals and limits, tests.
4. **The palette.** Client fetch with debounce and cancellation, flat-index keyboard reducer, highlight helper, the overlay, chips, states, all four hit behaviors, and `/search` handlers in the mocked e2e API.
5. **Conversation search on the server.** Replace the local filter, add branch labels, the total line, the focus view, and the scroll-and-highlight behavior without fighting the existing scroll-to-bottom effect.
6. **Evidence.** A real-API browser spec, screenshots, a database dump, the visual baselines, and `evidence/phase-7/README.md`.

## Test plan

| Level | Test |
| --- | --- |
| parser | quotes, whitespace, all five filters, empty filter value, bad date, unknown verb, unknown prefix stays text, blank query, over-length query |
| repository | case-insensitive substring, name ordering, newest-first messages, each filter, date boundaries, conversation scope, totals with a limit, snippet windowing, stashed and reverted flags |
| service | each rejection sentence, default and maximum limits, unknown author and branch return no messages, conversation-scoped ordering |
| HTTP | both routes, status codes, payload shape, a filter echoed back parsed, a 404 for an unknown conversation |
| unit client | flat index across groups, wrap behavior, empty and single-group lists, keyboard reducer, highlight segmentation with zero, one, and many matches |
| browser, real API | `Ctrl+K` across all four groups, each filter, a rejected filter sentence, conversation search with a branch label, jump to a message with scroll and highlight, keyboard-only navigation, Escape restoring focus, 390 px |
| visual parity | idle baselines byte-identical, new palette baselines in light and dark, mobile palette |
| migration | none, schema stays at version 3 |

## Non-goals

- FTS5, bm25, or relevance ranking beyond prefix-then-substring and newest-first.
- Searching message ids, command arguments, or the `args` JSON.
- Membership-scoped results, which are Phase 8 and Phase 10.
- Saved searches, recent searches, or search history.
- Live-updating results while a query is open.
- `git log`, `git show`, or `git grep` as commands. Search is a UI surface, not a query verb.
- A result preview panel. A hit opens the thing it names.

## Known limits and risks

- Case folding is SQLite's `lower()`, which is ASCII only. A non-ASCII query matches its own case and not the other.
- Substring search scans. That is honest at the current volume, and FTS5 is the swap point when the corpus outgrows a scan, because the repository is the only place that matches.
- Filters apply to messages only, by design.
- A search hit can name a message that arriving frames would have changed, because results are a snapshot.
- The message list currently scrolls to the bottom whenever messages change. A jump must suppress that once, or the row it targets scrolls away.
- The mocked e2e API needs `/search` and `/conversations/:id/search`. `visual.spec.ts` opens the conversation search with the query `Ready` and asserts `1 result`, so that baseline is the first candidate to change. A change there is a finding to record, not a silent refresh.
- Membership is not enforced anywhere yet, so search is exactly as private as the sidebar is today. The evidence must say so in plain words.
