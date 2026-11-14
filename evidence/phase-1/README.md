# Phase 1 evidence

Phase 1 is "Stabilize the Foundation": clean the monorepo, establish one validation pipeline, separate the API into layers, and break the React UI into feature modules. The refactor must not change what the user sees.

## Result

Complete. `bun run check` exits 0, and all eight captured UI states render pixel-identically to the pre-refactor baselines.

## Commands and results

| Command | Result |
| --- | --- |
| `bun install` (root) | 19 packages installed, workspace links repaired |
| `cd apps/web && bun x playwright install chromium` | Chromium 1243 available |
| `bun run typecheck` | exit 0 (4 projects: command-engine, api, web app, web node/tests) |
| `bun run lint` | exit 0 (oxlint over `apps` and `packages`) |
| `bun run test` | 38 passed, 0 failed (30 parser, 4 command service, 4 HTTP API) |
| `bun run build` | exit 0, `dist/assets/index-*.js` 250.14 kB, CSS 29.23 kB |
| `bun run test:e2e` | 14 passed, including 8 visual parity comparisons |
| `bun run check` | exit 0 |

## What changed

### 1. Monorepo cleanup

Deleted `apps/api/index.ts` and `packages/index.ts` (both were `console.log("Hello via Bun!")`), the unused `apps/api/src/command-executor.ts`, the root `tsconfig.json`, the duplicated per-package `.gitignore` files, and `apps/web/.oxlintrc.json`. The API now imports the workspace package by name instead of reaching across folders:

```ts
import { parseCommand } from "@gitping/command-engine";
```

One shared `tsconfig.base.json` now feeds four project configs. Root `package.json` owns TypeScript and oxlint. `PLAN.md` is no longer gitignored, so the roadmap the README links to is actually versioned.

### 2. Validation pipeline

Root scripts `dev:api`, `dev:web`, `typecheck`, `lint`, `test`, `build`, `test:e2e`, and `check`. `bun run check` runs typecheck, lint, unit tests, the frontend build, and the Playwright suite in order, and stops on the first failure. `.github/workflows/check.yml` runs the same command on push and pull request.

### 3. API structure

`apps/api/src/index.ts` is now a bootstrap that opens the database and serves one app. Routes only map HTTP:

```text
src/app.ts                       cors, route assembly, dependency wiring
src/routes/health.ts             GET /health
src/routes/messages.ts           GET /messages
src/routes/commands.ts           POST /commands
src/services/command-service.ts  parse, validate, build the message
src/repositories/message-repository.ts  SQL
src/types/http.ts                request and response shapes
```

The command service returns a result union (`{ ok: true } | { ok: false }`) instead of throwing, so the route owns the status code.

### 4. React feature modules

`App.tsx` went from 1605 lines to 492 lines of state and wiring. The JSX moved into feature folders, and the composer, search bar, and side panels became reusable pieces:

```text
src/App.tsx                          composition root, state, handlers
src/features/chat/ChatPage.tsx       chat layout, panels
src/features/chat/ChatHeader.tsx     title, branch selector, actions
src/features/chat/MessageList.tsx    list, loading, empty, error states
src/features/chat/MessageItem.tsx    one message
src/features/chat/Composer.tsx       Git command input
src/features/conversations/…         sidebar and conversation rows
src/features/branch/…                branch selector and notification island
src/features/search/…                workspace search and conversation search
src/features/members/…               member rows and notifications
src/features/workspace/…             icon rail, profile menu, modal
src/components/ui/…                  avatar, presence dot, side panel
src/hooks/…                          theme, sidebar, shortcuts, transient message
src/lib/…                            API client, time formatting
src/data/seed.ts                     local slice data
src/styles/…                         tokens, globals, responsive
```

The 1634-line `chat.css` became nine feature files plus `styles/index.css`. All 235 rule blocks are preserved, and the import-order file fixes the cascade so it is unchanged:

```css
@import "./tokens.css";
@import "./globals.css";
@import "../features/workspace/workspace.css";
@import "../features/conversations/conversations.css";
@import "../features/chat/chat.css";
@import "../features/branch/branch.css";
@import "../components/ui/overlays.css";
@import "../features/workspace/modal.css";
@import "./responsive.css";
```

`apps/web/src/lib/app.ts` was renamed to `lib/api.ts`, which is what the README already claimed. The API base URL now comes from `VITE_API_URL` with `http://localhost:3000` as the default, so the browser suite can point the app at a test server later.

## How the UI parity was proven

Before any code moved, `tests/e2e/visual.spec.ts` captured eight states against the original build and stored them in `parity/`. After the refactor the same spec ran again and compared every state pixel by pixel, with animations disabled and carets hidden.

- Desktop light: [screenshots/after/desktop-light.png](screenshots/after/desktop-light.png)
- Desktop dark: [screenshots/after/desktop-dark.png](screenshots/after/desktop-dark.png)
- Collapsed sidebar: [screenshots/after/sidebar-collapsed.png](screenshots/after/sidebar-collapsed.png)
- Workspace members panel: [screenshots/after/workspace-members-panel.png](screenshots/after/workspace-members-panel.png)
- Settings modal: [screenshots/after/settings-modal.png](screenshots/after/settings-modal.png)
- Conversation search: [screenshots/after/conversation-search.png](screenshots/after/conversation-search.png)
- Mobile drawer: [screenshots/after/mobile-drawer.png](screenshots/after/mobile-drawer.png)
- Branch notice: [screenshots/after/branch-notice.png](screenshots/after/branch-notice.png)

`parity/` holds the pre-refactor reference images. `screenshots/before/` and `screenshots/after/` are plain `page.screenshot()` captures, so their bytes can differ by text caret blink phase. The authoritative comparison is the `toHaveScreenshot` assertion, which hides carets and disables animations.

Negative control: changing one token in `styles/tokens.css` from `--accent: #2d6796` to `#d02d2d` made the desktop parity test fail, then the token was restored. The comparison is not vacuous.

## Deliberate behavior fix

The icon rail profile button could not close its own menu, because the old code cleared every menu and then toggled the flag back on. Menus now share one `ActiveMenu` value, which makes "only one menu open" a single state and lets the button toggle correctly. Everything else preserves the previous behavior, including the rule that opening the notifications or members panel closes conversation search while the conversation members panel does not.

## Known follow-ups

- `noUnusedLocals` is on for web and API. It found nothing new, but future code will be held to it.
- The visual parity suite skips on CI because the baselines were recorded on Windows. Functional browser tests run everywhere.
