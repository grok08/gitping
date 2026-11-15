# Phase 6 evidence

Phase 6 is "command experience". The composer is the product: it now validates a command as it is typed, suggests the next word from the conversation's own branches and messages, recalls what was sent, previews what a command will do, and shows the server's rejection at the composer instead of in the message list. The server keeps authority. The browser parses locally, but a locally valid command can still fail on state, and that answer wins.

## Result

Complete. `bun run check` exits 0 with 230 unit and integration tests across 18 files and 34 browser tests. A typed command is read by one shared catalog in `packages/command-engine`, the server builds its rejection sentence from the same catalog, and the composer renders empty, incomplete, invalid, and complete states from pure functions. Seven new real-API browser tests prove the keyboard flow, the branch-aware suggestions, the history recall, the inline server rejection, the help panel, and the 390px layout.

## Commands and results

Every command was run from the repository root. Exit codes are the real ones.

| Command | Result |
| --- | --- |
| `cmd /c "bun run check > %TEMP%\check.log 2>&1"` | exit 0: 230 unit tests, 34 browser tests, build 279.01 kB JS and 33.18 kB CSS |
| `bun run typecheck` | exit 0 (4 projects: command-engine, api, web app, web node/tests) |
| `bun run lint` | exit 0 (oxlint over `apps` and `packages`, no warnings) |
| `bun run test` | exit 0: 230 passed, 0 failed, 18 files |
| `bun run build` | exit 0, `dist/assets/index-*.js` 279.01 kB, CSS 33.18 kB |
| `bun run --cwd apps/web test:e2e tests/e2e/command-experience.spec.ts` | first run 1 failed, 5 passed (recorded below); after the fix 6 passed, and after the review 7 passed |
| `bun run --cwd apps/web test:e2e tests/e2e/visual.spec.ts --update-snapshots` | exit 0, 8 passed, 5 baselines changed and 2 stayed byte-identical |
| `bun run test:e2e` | exit 0, 34 passed (20.5 s in the final run) |
| `bun run db:inspect apps/web/test-results/gitping-e2e.db` | exit 0, output in [db-dump.txt](db-dump.txt) |

Each slice ended with `bun run typecheck`, `bun run lint`, and `bun run test` green before the next one started:

| Slice | Unit tests | typecheck | lint | test |
| --- | --- | --- | --- | --- |
| 1. Catalog and server sentence | 195 | exit 0 | exit 0 | exit 0 |
| 2. Pure client helpers | 227 | exit 0 | exit 0 | exit 0 |
| 3. Composer, history, help | 227 | exit 0 | exit 0 | exit 0 |
| 4. Browser proof and parity | 227 | exit 0 | exit 0 | exit 0 |
| 5. Independent review fixes | 230 | exit 0 | exit 0 | exit 0 |

The 230 unit tests are the 187 from Phase 5 plus 43 new ones: 7 catalog invariants, 28 command-input tests, 7 history tests, and 1 API test that runs every supported command through the service.

The 34 browser tests are 6 mocked UI tests, 2 real-API domain tests, 2 real-API conversation tests, 8 visual parity tests, 4 real-API realtime tests, 1 real-API idempotency test, 4 real-API Git-native tests, and 7 real-API command-experience tests.

## The catalog

`packages/command-engine/src/catalog.ts` is one typed array. Each entry has:

```ts
type CommandCatalogEntry = {
  name: string;              // "switch"
  types: readonly CommandType[]; // parser types this entry owns
  syntax: string;            // "git switch <branch>"
  summary: string;
  example: string;
  support: "content" | "context" | "unsupported";
  args: readonly CommandArg[];
  forms: readonly CommandForm[];
};
```

`forms` is the input grammar the browser needs and `args` is the documented argument set. One entry covers every shape of a command. `git branch` has a bare form that lists and a form that takes a name; `git stash` has the plain, `push -m`, `list`, and `pop` forms. The entry order is deliberate: it is the fallback suggestion order and the order of the server's rejection sentence.

The invariants are tests, not prose ([catalog.test.ts](../../packages/command-engine/src/catalog.test.ts)):

- every entry's `example` parses with `parseCommand`;
- every parser type maps to exactly one entry, and the 17 parser types are all covered;
- every form is written for its own verb;
- content and context are the only accepted support levels, and their names are exactly `commit`, `revert`, `merge`, `branch`, `switch`, `stash`;
- `unsupportedCommandMessage()` is exactly the sentence the API has always returned.

`apps/api/src/services/command-service.ts` now builds its rejection from `unsupportedCommandMessage()`. The dispatch switch is unchanged. One service test sends every supported entry's example and asserts the answer is never `invalid_command`, so the catalog cannot claim a verb the server does not route.

## The four states

`apps/web/src/lib/command-input.ts` returns one reading of the composer text:

| State | Example | What the composer shows |
| --- | --- | --- |
| `empty` | `""` | nothing, so idle baselines are untouched |
| `incomplete` | `git switch`, `git commit`, `git sw` | the syntax and a hint, no error |
| `invalid` | `git log`, `git checkout main`, `git merge one two` | an inline error at the composer |
| `complete` | `git switch main`, `git commit -m "hi"` | the syntax, the summary, and a plain-language preview |

A partial verb is not an error. `git sw` is read as the prefix of `switch` and says `Commands: git switch`. An unsupported verb is read from the catalog as parsed but not enabled, so `git log` says `git log is not enabled yet.` before it is sent. The send button stays enabled for every non-empty value, because the server is the authority and Phase 3's `domain.spec.ts` still proves that `git log` reaches the API and its rejection is displayed. The server's text replaces the local one in the same `.command-error` element, which now sits under the composer.

## Suggestions

`suggestCommands(input, context)` is pure and returns at most six items. The stages are:

| Input | Offers |
| --- | --- |
| `git sw` | `git switch <branch>` |
| `git switch ` | every branch, with the current one marked |
| `git switch fe` | `feature-ui`, completing only the token under the caret |
| `git switch -c ` | nothing, with the hint `new branch name` |
| `git branch ` | nothing, with the hint `new branch name` |
| `git merge ` | every branch except the current one |
| `git revert ` | recent messages, newest first, labelled with the 8-character id and the message text |
| `git stash pop ` | stashed messages only |
| `git stash ` | `push -m`, `list`, and `pop` |

Completion inserts the whole command. `git commit` inserts `git commit -m ""` with the caret between the quotes. Text after the token under the caret survives, and a completion that lands next to a space does not double it. When the typed argument is already an exact branch name or id the popup closes, so Enter sends instead of accepting the same value again.

The context is the client state that already exists: the current branch, the branch names, and the messages, including the stashed ones. No fetch, no endpoint, no schema change.

## Keyboard and accessibility

| Surface | Keys |
| --- | --- |
| Popup open | ArrowDown and ArrowUp move the highlight, Enter accepts it instead of sending, Tab accepts, Escape closes |
| Popup closed | ArrowUp at the start of the line recalls the previous command, ArrowDown at the end moves forward |
| Always | Enter sends when the popup is closed, the empty send button is disabled, and the input keeps `autoFocus` |

The input is a `combobox` with `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`. The popup is a `listbox` with `option` children. The hint line is referenced by `aria-describedby`, not a live region, so it is not announced on every keystroke. The error is an alert.

## History

History is browser state, one `localStorage` key per conversation, the last 50 commands, with consecutive duplicates collapsed. It is written when a command is sent, not when the server accepts it, so a rejected command can still be recalled and edited. ArrowUp and ArrowDown use the same pure reducer as the tests ([command-history.ts](../../apps/web/src/lib/command-history.ts)). There is no history table, no migration, and no server feature.

## Help

The composer's existing help row has a small `?` button. It opens the existing `SidePanel` titled "Command help", subtitled "Git commands you can send", listing every supported entry with its syntax, summary, and one example. One line at the bottom names the parsed-but-disabled verbs. There is no new modal and no new dependency beyond `@gitping/command-engine`, which `apps/web` now depends on as a workspace package.

## Browser proof against the real API

`tests/e2e/command-experience.spec.ts` uses the real API on port 3000 with a fresh database. Each test creates its own channel so the proof does not depend on parallel tests. Screenshots are in [screenshots/](screenshots/).

### 1. Suggestions complete a switch without sending

1. A fresh channel, a base commit, then `git branch weekend`.
2. `git sw` shows one suggestion, `git switch <branch>`, and the hint `Commands: git switch`. [screenshots/suggestions-verb.png](screenshots/suggestions-verb.png)
3. ArrowDown then Enter changes the text to `git switch ` and the message count does not change. The popup now lists `main` and `weekend`. [screenshots/suggestions-branches.png](screenshots/suggestions-branches.png)
4. ArrowDown then Enter completes `git switch weekend`, and the popup closes because the argument is exact.
5. Enter sends. The header and `GET /branches` both say `weekend`, and the message count is still one. [screenshots/switch-through-suggestions.png](screenshots/switch-through-suggestions.png)

### 2. The keyboard surface

Typing `git sw` exposes the combobox state: `aria-expanded="true"`, `aria-controls="composer-suggestions"`, and `aria-activedescendant="composer-suggestions-option-0"`. Tab accepts the highlight without sending, so the text becomes `git switch ` and the branch suggestions open. Escape then closes the popup and leaves the text alone. [screenshots/keyboard-tab-accept.png](screenshots/keyboard-tab-accept.png)

### 3. History recall

A commit is sent, the composer clears, and ArrowUp recalls the exact command; ArrowDown returns the empty draft. Recalling it again and pressing Enter sends it, and ArrowDown afterwards stays empty because the parent clear reset the cursor. [screenshots/history-recall.png](screenshots/history-recall.png)

### 4. The server rejection replaces the local reading

`git log` shows the local `not enabled` error first. Enter sends it; the server's sentence replaces it in the same element, and no message row is added. Dismissing it and pressing Enter again shows the next server rejection, so a dismissal never swallows a retry. [screenshots/inline-error-local.png](screenshots/inline-error-local.png), [screenshots/inline-error-server.png](screenshots/inline-error-server.png)

### 5. Help

The `?` button opens the panel with the six supported syntaxes and the unsupported line. [screenshots/command-help.png](screenshots/command-help.png)

### 6. Preview

A complete commit shows `Commit to #<channel> on main`; a merge shows `Merge weekend into main`. [screenshots/command-preview.png](screenshots/command-preview.png)

### 7. 390 px

The composer, the popup, the hint, and the `?` fit a 390 px viewport; the popup's box is inside the viewport. [screenshots/composer-390.png](screenshots/composer-390.png)

## Visual parity

Seven baselines exist. Five changed and two are byte-identical.

| Baseline | Changed | Evidence |
| --- | --- | --- |
| `desktop-light.png` | yes | 446 px differ, box x 1153..1237, y 769..785 |
| `desktop-dark.png` | yes | 446 px differ, box x 1153..1237, y 769..785 |
| `conversation-search.png` | yes | 446 px differ, box x 1153..1237, y 769..785 |
| `sidebar-collapsed.png` | yes | 446 px differ, box x 1010..1094, y 769..785 |
| `mobile-drawer.png` | yes | 160 px differ: 153 are the new `?` circle, 7 are a one-level antialias shift on the drawer edge at y 172..174 |
| `workspace-members-panel.png` | no | 0 px differ |
| `settings-modal.png` | no | 0 px differ |

The changed box is the right end of the composer help row in every state with a visible composer. The new `?` occupies the last 17 px on desktop and 15 px on mobile, and "Enter to send" shifts left by that width plus the 10 px gap. Nothing else moved.

The first recording was not acceptable and was not kept. The 17 px button made the help row 3 px taller on desktop and 1 px taller at 390 px, which moved the whole composer and every idle baseline. The button now has a 17 px visual size with a `-1.5px` block margin on desktop and a 15 px size with the same margin at 390 px, so its outer height equals the row's line box at both sizes. The table above was measured on the final baselines with a small PNG pixel comparator against the committed images, not by eye.

## Database dump

[db-dump.txt](db-dump.txt) is the database left by the final `bun run check`, at schema version 3:

```text
messages: 22, commands: 22, message events: 26
  events: created (one per message), reverted, stashed, unstashed, merged
  conversations: 6 seeded + 14 created by the Phase 3, 4, 5, and 6 browser tests
  branches: 8 seeded + one main per created conversation (14) + release + feature + phase-six weekend + preview weekend
  conversation_members: 35
  command requests: 22, one per content command the browser sent
```

Phase 6 added four messages, four command requests, four conversations, six branches, and four members. The four messages are the base commit in the suggestions channel, the recalled commit in the history channel and its retry (the history test sends the recalled command again), and the preview commit. The error, keyboard, and 390 px tests send nothing. No migration ran and no seed row changed.

## Failures found and fixed

1. **The first run of `command-experience.spec.ts` was 1 failed, 5 passed.** The 390 px test tried to create a channel while the mobile sidebar is a drawer that starts closed, so `New channel` was not reachable and the test timed out. The test now uses the seeded channel, since it only proves the composer's width.
2. **The first screenshot run wrote `*.png.png`.** The call sites passed a file name that already ended in `.png` to a helper that appends `.png`. Fixed before the recorded run; the recorded screenshots have single extensions.
3. **The first baseline refresh moved the whole composer by 3 px on desktop and 1 px at 390 px.** The `?` button was taller than the help row's line box, so the tray grew and every idle state shifted. This was caught by comparing the old and new baselines and was fixed with the margin and mobile sizing described above. The second refresh confines the change to the help row's right end. This is why the phase did not ship the first refresh.
4. **Accepting the `git commit` suggestion produced an invalid command.** The skeleton `git commit -m ""` has an empty quoted token; the parser drops it and reports `Missing commit message`, so the composer showed an error right after its own completion. An empty quoted token now reads as the argument stage, so the hint asks for message text and no error is shown. The same fix covers `git stash push -m ""` and `git switch -c ""`.
5. **Completing before an existing token glued two words.** `git switch |main` completed to `weekend` produced `mainmain`, and `git stash |pop` produced `""pop`. Completion now adds a separator when it inserts before a non-space token.
6. **`git commit --amend -m "hi"` and `git commit --message=hi` were marked invalid** even though the parser and the server accept them. The catalog models the shapes the composer teaches, so when the grammar has no match but the parser succeeds, the command is complete.
7. **A dismissed error swallowed the next server rejection for the same text.** Dismissing `git log`'s error and pressing Enter again showed nothing on the retry. A server rejection is now always rendered; the dismissal only silences the local reading until the text changes.
8. **A same-value history step left a pending caret.** ArrowUp at the oldest history entry returns the same text, so the caret effect never ran and the pending position moved the next unrelated character mid-word. `apply` now handles the same-value case directly.
9. **A parent clear left the history cursor armed.** After sending a recalled command, ArrowDown could conjure the next history entry into the empty composer. The cursor now resets when the value changes from outside a completion.
10. **Pure caret movement left the completion position stale.** Home, End, ArrowLeft, and some mouse clicks did not update the caret state. Keyup and click now sync it.
11. **The first API acceptance test could not fail.** It only asserted `not invalid_command`, so a verb that was routed but always refused would pass. It now executes all six supported verbs (with a revert target, a side branch, a merge, and a stash) and asserts every result is `ok`.
12. **The keyboard surface and the empty skeleton had no test.** The review showed the commit completion was broken and untested. The unit suite now validates the empty quoted token and the parser-valid fallback, and a seventh browser test covers Tab, Escape, and the `aria-*` wiring.

Two review nits are deliberately not fixed: typing `gi` (before the full `git`) offers no suggestion, and a completion after extra whitespace keeps the gap. Both are cosmetic, neither changes a command or the server's answer.

## Independent review

An independent read-only review ran on the committed tree. It read the catalog, the three client helpers, the composer and its page wiring, the API service, the unit and browser tests, the visual spec, and the database dump, and traced failing strings through the pure helpers.

It found the seven behavioral defects recorded above as items 4 through 10, the weak API test as item 11, and the missing keyboard and empty-skeleton coverage as item 12. All twelve are fixed and re-run in the final `bun run check`. It found no security or boundary issue: all dynamic text is a React text node, history parsing is defensive, storage failures are tolerated, local validation never disables send, and the server stays authoritative.

What the reviewer could not verify without the same machine and a rerun were the pixel boxes and the bundle sizes in this file. Both come from the final local run recorded in the command table and the comparator described under visual parity.

## Remaining risk and limits

- **Unsupported verbs are not suggested.** The brief's illustration said `git sw` should offer `git switch` and `git status`. The normative rule in the same section says only content and context verbs are suggested and unsupported verbs appear in help only. The implementation follows the rule, so `git sw` offers only `switch`; `status` is listed in help and its rejection is still proven by the Phase 3 test.
- **The local preview describes syntax, not state.** `git switch nowhere` is a complete command and previews `Switch to nowhere`; the server answers `Unknown branch: nowhere`, and that error replaces the preview's promise in the error line. The preview never claims success.
- **Branch names and message ids come from the loaded conversation.** A branch created in another tab after this client loaded is not suggested until the next load or command response; the server still accepts it. Stash suggestions are not branch-filtered either, because the message payload carries no branch, so a stash made on another branch can be suggested and the server answers `Unknown stash`.
- **History is per browser and per conversation.** Clearing site data clears it. A browser that blocks storage gets no history; sending is unaffected.
- **Only Chromium is exercised.** The keyboard flow was tested on Playwright's Chromium at 1280x800 and 390x844, not on Safari, Firefox, or a physical phone.
