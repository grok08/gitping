# GitPing agent rules

## Every phase ends with browser evidence

`PLAN.md` defines the phases. A phase is complete only when browser evidence exists for it. A passing build, type check, or unit test is not evidence of behavior.

For each phase, in order:

1. Run the automated checks with `bun run check`.
2. Drive the running app with Playwright and save screenshots under `evidence/phase-<n>/screenshots/`.
3. Write `evidence/phase-<n>/README.md` with the exact commands you ran, the result of each one, and links to the screenshots and any data dump.
4. Say in your reply which evidence file backs the claim.

Rules for the evidence itself:

- Screenshots come from the running app, never from mockups. Name each file for the state it shows.
- Keep the evidence in the repo. A phase with no evidence folder is not done.
- Record a failing check in the evidence file. Do not delete it or hide it.
- If the browser flow needs the API, run the real API. Do not present a mocked API as proof of the data layer.

Install the browser once per machine:

```bash
cd apps/web
bun x playwright install chromium
```

## Working in this repo

- Package manager is Bun. Install from the repo root with `bun install`.
- One validation command: `bun run check`. It runs typecheck, lint, unit tests, the frontend build, and the Playwright suite.
- Layout: `apps/api` is the Hono service, `apps/web` is the React + Vite client, `packages/command-engine` is the Git command parser.
- Backend layering: routes map HTTP, services hold business logic, repositories own SQL. Do not write SQL in a route.
- Update the phase status in `PLAN.md` when a phase lands, and keep the structure sections of `README.md` accurate.
