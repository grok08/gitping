# GitPing API

The API is the Bun and Hono backend for GitPing. It validates Git commands with the shared `@gitping/command-engine` package and stores created messages in SQLite.

## Development

Install workspace dependencies from the repository root:

```bash
bun install
```

Start the API from the repository root:

```bash
bun run dev:api
```

Or run its package script from `apps/api`:

```bash
bun run dev
```

The API listens at `http://localhost:3000`. The web app's Vite development server runs at `http://localhost:5173` and is allowed by the API's development CORS configuration.

## Endpoints

### `GET /health`

Returns API and database health:

```json
{
	"status": "ok",
	"database": true
}
```

### `GET /messages`

Returns persisted messages ordered chronologically. Each message includes `id`, `author`, `text`, `command`, `created_at`, `reverted`, and `stashed`.

### `POST /commands`

Request:

```json
{
	"input": "git commit -m \"hello from GitPing\"",
	"author": "grok08"
}
```

`author` is optional and defaults to `grok08`. The response is one of three untagged bodies: `{ message }` for `git commit`, `git revert`, and `git merge` (`201`); `{ branches }` for `git branch` and `git switch` (`200`); `{ stashes }` for the `git stash` commands (`200`). Query commands such as `git log` are still rejected with `400`.

Invalid JSON, unsupported commands, and commands without a commit message return `400 Bad Request` with an `error` field. A duplicate branch or an already reverted message returns `409`.

### `GET /conversations/:id/stashes`

Returns the stash of the current user's current branch as `{ id, text, note, createdAt }` records, newest first.

## Database

On startup, the API creates the SQLite database and `messages` table if needed at `apps/api/data/gitping.db`. The database is local development data and is ignored by Git.
