import { cors } from "hono/cors";
import { Hono } from "hono";
import { db } from "./db";
import { parseCommand } from "../../../packages/command-engine/src/parser";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "http://localhost:5173",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

type MessageRow = {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

type CreateCommandRequest = {
  input: string;
  author?: string;
};

function extractCommitMessage(input: string): string | null {
  const match = input.match(
    /^git\s+commit(?:\s+--amend)?\s+(?:-m|--message)\s+(["'])(.*?)\1$/i,
  );

  return match?.[2] ?? null;
}

/*
 * GET /health
 */
app.get("/health", (c) => {
  const result = db.query(
    "SELECT 1 AS ok",
  ).get() as { ok: number } | null;

  return c.json({
    status: "ok",
    database: result?.ok === 1,
  });
});

/*
 * GET /messages
 *
 * Used by the React application when loading the conversation.
 */
app.get("/messages", (c) => {
  const rows = db
    .query(`
      SELECT
        id,
        author,
        text,
        command,
        created_at
      FROM messages
      ORDER BY datetime(created_at) ASC
    `)
    .all() as MessageRow[];

  return c.json(rows);
});

/*
 * POST /commands
 *
 * One complete message flow:
 *
 * React
 *   -> Hono
 *   -> command parser
 *   -> SQLite
 *   -> Hono response
 *   -> React
 */
app.post("/commands", async (c) => {
  let body: CreateCommandRequest;

  try {
    body = await c.req.json<CreateCommandRequest>();
  } catch {
    return c.json(
      {
        error: "Invalid JSON request body",
      },
      400,
    );
  }

  const input = body.input?.trim();
  const author = body.author?.trim() || "grok08";

  if (!input) {
    return c.json(
      {
        error: "Command is required",
      },
      400,
    );
  }

  /*
   * Validate the Git command using the command engine.
   *
   * The existing parser tests indicate unsupported commands
   * are rejected by the parser.
   */
  try {
    parseCommand(input);
  } catch {
    return c.json(
      {
        error: "Unsupported or invalid Git command",
      },
      400,
    );
  }

  /*
   * For this first vertical slice, a GitPing message is
   * represented by git commit -m "...".
   */
  const text = extractCommitMessage(input);

  if (!text) {
    return c.json(
      {
        error:
          'For the first message flow, use: git commit -m "message"',
      },
      400,
    );
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const command = "git commit";

  db.query(`
    INSERT INTO messages (
      id,
      author,
      text,
      command,
      created_at
    )
    VALUES (
      $id,
      $author,
      $text,
      $command,
      $created_at
    )
  `).run({
    $id: id,
    $author: author,
    $text: text,
    $command: command,
    $created_at: createdAt,
  });

  return c.json(
    {
      message: {
        id,
        author,
        text,
        command,
        createdAt,
      },
    },
    201,
  );
});

console.log("GitPing API running on http://localhost:3000");

Bun.serve({
  port: 3000,
  fetch: app.fetch,
});