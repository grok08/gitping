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

Returns persisted messages ordered chronologically. Each message includes `id`, `author`, `text`, `command`, and `created_at`.

### `POST /commands`

Request:

```json
{
	"input": "git commit -m \"hello from GitPing\"",
	"author": "grok08"
}
```

`author` is optional and defaults to `grok08`. The current message flow requires a `git commit -m "message"` command. Other commands may be recognized by the parser, but are not yet persisted as messages by this endpoint.

Successful requests return `201 Created` with the new message, including its `createdAt` timestamp. Invalid JSON, unsupported commands, and commands without a commit message return `400 Bad Request` with an `error` field.

## Database

On startup, the API creates the SQLite database and `messages` table if needed at `apps/api/data/gitping.db`. The database is local development data and is ignored by Git.
