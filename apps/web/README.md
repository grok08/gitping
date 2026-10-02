# GitPing Web

The web app is GitPing's React, TypeScript, and Vite client. It presents Git commands as messages in a chat-first interface, with conversation navigation, message history, search, branch context, member panels, and light and dark themes.

## Development

Install dependencies from the repository root:

```bash
bun install
```

Start the API in one terminal:

```bash
bun run dev:api
```

Start the web app in another terminal:

```bash
bun run --cwd apps/web dev
```

Vite serves the app at `http://localhost:5173`. The client calls the API at `http://localhost:3000`; run the API for persisted message history and command submission. If the API is unavailable, the UI retains its seed messages.

## Checks

Build the production app:

```bash
bun run --cwd apps/web build
```

Run Oxlint:

```bash
bun run --cwd apps/web lint
```

Preview a production build:

```bash
bun run --cwd apps/web preview
```

## Structure

- `src/App.tsx` composes the current application UI.
- `src/App.css` and `src/index.css` contain application and global styles.
- `src/lib/app.ts` contains the typed API client.
- `public/gitping.svg` is the browser favicon.
