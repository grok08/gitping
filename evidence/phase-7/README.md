# Phase 7 evidence

Phase 7 is "search". Two client-side filters became one server-side search. `Ctrl+K` opens a palette that answers across messages, conversations, people, and branches, the chat search box asks the same server for one conversation, and both understand `author:`, `command:`, `branch:`, `after:`, and `before:`. Opening a hit lands the member on the thing it names.

## Result

Complete. `bun run check` exits 0 with 275 unit and integration tests across 23 files and 42 browser tests. `GET /search` and `GET /conversations/:id/search` share one parser, one message query, and one message-hit shape. Six new browser tests against the real API prove the grouped palette, a filter and its rejection, a conversation search that labels another branch, all four hit behaviors, keyboard movement, and the 390 px layout. No migration ran, so the schema stays at version 3.

## Commands and results

Every command ran from the repository root. Exit codes are the real ones.

| Command | Result |
| --- | --- |
| `bun run check` | exit 0: 275 unit tests, 42 browser tests, build 288.16 kB JS and 37.17 kB CSS |
| `bun run typecheck` | exit 0 (4 projects: command-engine, api, web app, web node/tests) |
| `bun run lint` | exit 0 (oxlint over `apps` and `packages`, no warnings) |
| `bun run test` | exit 0: 275 passed, 0 failed, 23 files |
| `bun run build` | exit 0, `dist/assets/index-*.js` 288.16 kB, CSS 37.17 kB |
| `bun run --cwd apps/web test:e2e tests/e2e/search.spec.ts` | 6 passed |
| `bun run --cwd apps/web test:e2e tests/e2e/visual.spec.ts --update-snapshots` | 10 passed, 2 baselines added |
| `bun run test:e2e` | exit 0, 42 passed (31.5 s) |
| `bun run db:inspect apps/web/test-results/gitping-e2e.db` | exit 0, output in [db-dump.txt](db-dump.txt) |

The 275 unit tests are the 230 from Phase 6 plus 45 new ones: 15 parser tests, 4 snippet tests, 11 search-repository tests, 7 HTTP tests for the two routes, and 8 tests for the client palette list, highlighting, and navigation. The 42 browser tests are 6 mocked UI tests, 2 real-API domain tests, 2 real-API conversation tests, 10 visual parity tests, 4 real-API realtime tests, 1 real-API idempotency test, 4 real-API Git-native tests, 7 real-API command-experience tests, and 6 real-API search tests.

## The parser

`apps/api/src/search/query.ts` is pure and total. It turns a query into terms and five filters, or into one sentence explaining why not.

- Terms are split on whitespace, quotes keep a phrase together, and every term has to appear in the matched column. `login flow` finds "flow of login"; `"login flow"` finds only the phrase.
- A word is a filter only when its prefix before `:` is one of the five names. `note:` and `http://x` stay text.
- `author:` and `command:` compare case-insensitively. `branch:` is case-sensitive, as Git is. `after:` and `before:` accept `YYYY-MM-DD` or an ISO timestamp, with `after` inclusive and `before` exclusive.
- The response echoes the filter values the member typed, not the normalized timestamp. The repository gets the normalized bound through `searchCriteria`.
- The supported-verb list in the rejection sentence comes from `packages/command-engine`, so it cannot drift from the commands the server routes.

The 15 parser tests cover quotes, every filter, an empty value, a bad date, an unknown verb, an unknown prefix, a blank query, the length limit, and the limit bounds.

## The queries

`apps/api/src/repositories/search-repository.ts` owns every search query. Four queries, one per group, each with `LIMIT` and `COUNT(*) OVER () AS total`, so a total never costs a second query.

- Matching is `instr(lower(column), lower($term)) > 0`. Names rank by whether the first term starts the name, then by whether it appears inside.
- Messages rank by `seq` descending. Filters narrow messages only; names match text alone.
- Message state reuses the stashed and reverted expressions from the message repository, so a flag cannot mean one thing in the chat and another in search.
- No membership filter is applied. `/conversations` returns every conversation today, and search returns hits in the same set. Enforcing membership is Phase 8 and Phase 10 work.

The repository tests prove case-insensitive matching, all five filters, date boundaries, conversation scope, totals before the limit, the derived flags, name ranking, the preview match, and the viewer's current branch.

## The two routes

```text
GET /search?q=<query>&limit=<n>
GET /conversations/:id/search?q=<query>&limit=<n>
```

A successful answer echoes `query: { text, terms, filters }`. The global route returns four groups with `totals` and `truncated`; the scoped route returns the message hits, a total, and a truncated flag.

Rejections are specific. `400 Search query is required`, `400 after: expects YYYY-MM-DD or an ISO timestamp`, `400 Unknown command: log. Supported: commit, revert, merge, branch, switch, or stash.`, `400 limit must be a whole number from 1 to 50`, and `404 Unknown conversation: <id>` on the scoped route. An unknown author or branch returns no messages rather than an error.

## The palette

`Ctrl+K` opens a centered overlay. It has one input, chips for the filters the server understood, and groups in the order Messages, Conversations, People, Branches, each labelled with its total.

- Arrow keys move one flat index across every group and wrap at both ends. Enter opens the active hit, Escape closes and restores focus, and Tab stays inside the dialog.
- The input is a combobox with `aria-expanded`, `aria-controls`, and `aria-activedescendant`. Results are options inside labelled groups.
- Message titles are the server's snippet with every matched term marked. Names are plain.
- Opening a conversation selects it. Opening a person opens the existing new direct message modal with the handle filled in. Opening a branch selects the conversation and the visible branch. Opening a message selects the conversation, shows the whole conversation including stashed rows, scrolls the row into view, and highlights it for 1.6 seconds.
- Requests are debounced by 150 ms and cancelled on every keystroke, so a slow answer for an old query cannot replace a newer one.

The conversation search bar now asks the server as well. While a query is active the list shows the hits, newest first, with the total in the bar. A hit on another branch carries a branch pill; a hit on the current branch does not, because a label on every row is noise. A rejected filter shows the server's sentence in the bar and leaves the last results in place.

## Browser proof against the real API

`tests/e2e/search.spec.ts` uses the real API on port 3000 with a fresh database. Each test creates its own channel, so the proof does not depend on parallel tests.

### 1. The palette finds a message and opens it

A channel is created, a commit is sent, `Ctrl+K` is pressed, and `palette search` is typed. The first result is the message, labelled with its channel. [screenshots/palette-results.png](screenshots/palette-results.png) Enter opens it, the palette closes, the conversation is selected, and the row is highlighted. [screenshots/message-jump-highlight.png](screenshots/message-jump-highlight.png)

### 2. Filters

`author:grok08 deploy` produces one chip and one message hit. [screenshots/palette-filters.png](screenshots/palette-filters.png) `after:soon` produces the server's sentence in an alert. [screenshots/palette-error.png](screenshots/palette-error.png) `author:nobody zzz` produces `No matches for "zzz"`.

### 3. Conversation search labels the other branch

A channel commits on `main`, creates `weekend`, switches to it, commits there, and switches back. Searching the conversation for `login` reports 2 results, and the weekend row carries a `weekend` pill. [screenshots/conversation-search-branch.png](screenshots/conversation-search-branch.png)

### 4. All four hit behaviors

A conversation hit selects its conversation. A person hit opens the direct message modal with `rahul` filled in. A branch hit selects the conversation and switches the visible branch to `release`. [screenshots/branch-hit.png](screenshots/branch-hit.png)

### 5. Keyboard movement

Typing `weekend` yields at least two hits. ArrowDown moves `aria-activedescendant` to the next option, and Escape closes the palette.

### 6. 390 px

On a 390 px viewport the palette is 390 px wide and fills the screen. [screenshots/palette-390.png](screenshots/palette-390.png)

## Visual parity

The eight existing baselines are byte-identical. Two new baselines cover the new surface:

| Baseline | State |
| --- | --- |
| `search-palette-idle.png` | palette open, no query, hint and filter legend |
| `search-palette-results.png` | palette open, `Ready` typed, one message hit |

The first run of the parity suite found a real regression. `conversation-search.png` changed because every search hit carried a `main` branch pill. The pill is now rendered only when the hit's branch differs from the visible branch, and the baseline returned to byte-identical without a refresh. That is why the phase kept all eight old baselines and added only the two new ones.

## Database dump

[db-dump.txt](db-dump.txt) is the database left by the final `bun run check`, at schema version 3:

```text
messages: 27, commands: 27, message events: 31
  events: created (one per message), reverted, stashed, unstashed, merged
  conversations: 6 seeded + 18 created by the Phase 3 through 7 browser tests
  branches: 8 seeded + one main per created conversation + the branch-test weekend
  conversation_members: 39
  command requests: 27, one per content command the browser sent
```

Phase 7 added five messages, five command requests, four conversations, six branches, and four members. The messages are the palette commit, the filter commit, the main and weekend commits in the branch search channel, and the branch-hit seed. No migration ran and no seed row changed.

## Failures found and fixed

1. **The first parity run changed the conversation-search baseline.** Every search hit rendered a `main` branch pill, because the client mapped the hit's branch unconditionally. The client now suppresses the label when the hit is on the visible branch. The baseline is byte-identical again, and the branch test still proves the label appears for a hit from another branch.
2. **The date filters echoed a normalized timestamp.** `after:2026-10-01` answered with `2026-10-01T00:00:00.000Z`, which is not what the member typed and not what the contract's example showed. The parsed filters now keep the typed value and `searchCriteria` converts it to the bound the repository compares.
3. **The first real-API filter test searched a message that only exists in the mocked fixture.** The E2E database seeds conversations and branches, not messages. The test now creates its own channel and commit before searching.
4. **The keyboard test could not move.** A query with one hit wrapped ArrowDown back to the same index. The test now searches `weekend`, which matches a conversation and a branch in the seeded workspace.
5. **The contract said one contiguous substring for multi-word text.** The implementation matches every term, in any order, which is a superset of the old client filter and what a chat user expects. `docs/phase-7-search.md` records the rule, and the response carries `terms` so highlighting uses the same words.

## Remaining risk and limits

- **Case folding is ASCII only.** SQLite's `lower()` does not fold non-ASCII letters, so a non-ASCII query matches its own case only.
- **Substring search scans.** That is honest at this volume. FTS5 is the swap point, and the repository is the only place that matches.
- **Results are a snapshot.** A message that arrives while the palette is open does not change the answer until the query changes.
- **Filters narrow messages only.** Names match the text alone, by design, so `author:grok08` returns messages and no people.
- **Membership is not enforced.** Search sees every conversation the sidebar shows. It is exactly as private as the rest of the API today; Phase 8 and Phase 10 own that rule.
- **Only Chromium is exercised.** The keyboard flow and the 390 px layout were tested on Playwright's Chromium, not on Safari, Firefox, or a physical phone.
- **The palette is not a preview panel.** A hit opens the thing it names, and there is no result detail view.
