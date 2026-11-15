import { describe, expect, test } from "bun:test";
import type { MessageRecord } from "../types/http";
import { createTestDatabase, createTestServer } from "../test-helpers";

type Frame = Record<string, unknown>;

function startHarness() {
  const db = createTestDatabase();
  const { app, hub, websocket } = createTestServer(db);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
    websocket,
  });
  const origin = `http://127.0.0.1:${server.port}`;

  return {
    db,
    hub,

    post(path: string, body: unknown) {
      return fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },

    get(path: string) {
      return fetch(`${origin}${path}`);
    },

    connect(conversationId: string) {
      return connect(`ws://127.0.0.1:${server.port}`, conversationId);
    },

    stop() {
      hub.closeAll();
      server.stop(true);
    },
  };
}

async function connect(wsUrl: string, conversationId: string) {
  const socket = new WebSocket(
    `${wsUrl}/conversations/${conversationId}/events`,
  );
  const queue: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];

  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    const waiter = waiters.shift();

    if (waiter) {
      waiter(frame);
      return;
    }

    queue.push(frame);
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket failed to open")),
      { once: true },
    );
  });

  function next(timeoutMs = 3000): Promise<Frame> {
    const queued = queue.shift();

    if (queued) {
      return Promise.resolve(queued);
    }

    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for a WebSocket frame"));
      }, timeoutMs);

      waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  async function drain(waitMs = 200): Promise<Frame[]> {
    await Bun.sleep(waitMs);

    return queue.splice(0);
  }

  const ready = await next();

  if (ready.type !== "ready") {
    throw new Error(`Expected a ready frame, received ${JSON.stringify(ready)}`);
  }

  return {
    socket,

    next,
    drain,

    send(payload: string) {
      socket.send(payload);
    },

    close() {
      socket.close();
    },
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();

  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for a condition");
    }

    await Bun.sleep(20);
  }
}

async function sentMessage(response: Response): Promise<MessageRecord> {
  const body = (await response.json()) as { message: MessageRecord };

  return body.message;
}

describe("realtime delivery", () => {
  test("broadcasts a persisted message to every client in the conversation", async () => {
    const harness = startHarness();
    const first = await harness.connect("conv-engineering");
    const second = await harness.connect("conv-engineering");

    try {
      const response = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: 'git commit -m "live delivery"', branch: "main" },
      );

      expect(response.status).toBe(201);

      const message = await sentMessage(response);
      const frames = [await first.next(), await second.next()];

      for (const frame of frames) {
        expect(frame.type).toBe("message.created");
        expect(frame.conversationId).toBe("conv-engineering");
        expect(frame.seq).toBe(message.seq);
        expect(frame.message).toMatchObject({
          id: message.id,
          seq: message.seq,
          author: "grok08",
          text: "live delivery",
          command: "git commit",
        });
      }

      // The row exists at the moment the event is delivered, which is what
      // "broadcast after the transaction commits" means in practice.
      const stored = harness.db
        .query("SELECT seq, text FROM messages WHERE id = $id")
        .get({ $id: message.id }) as { seq: number; text: string } | null;

      expect(stored).toEqual({ seq: message.seq, text: "live delivery" });
      expect(harness.hub.subscriberCount("conv-engineering")).toBe(2);
    } finally {
      first.close();
      second.close();
      harness.stop();
    }
  });

  test("only reaches clients subscribed to that conversation", async () => {
    const harness = startHarness();
    const engineering = await harness.connect("conv-engineering");
    const weekend = await harness.connect("conv-weekend");

    try {
      const response = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: 'git commit -m "engineering only"' },
      );

      expect(response.status).toBe(201);

      const frame = await engineering.next();

      expect(frame.conversationId).toBe("conv-engineering");
      expect(await weekend.drain()).toEqual([]);
    } finally {
      engineering.close();
      weekend.close();
      harness.stop();
    }
  });

  test("broadcasts commits made through the compatibility /commands route", async () => {
    const harness = startHarness();
    const client = await harness.connect("conv-weekend");

    try {
      const response = await harness.post("/commands", {
        input: 'git commit -m "compatibility broadcast"',
        author: "grok08",
        conversation: "weekend",
        branch: "main",
      });

      expect(response.status).toBe(201);

      const message = await sentMessage(response);
      const frame = await client.next();

      expect(frame.conversationId).toBe("conv-weekend");
      expect(frame.message).toMatchObject({
        id: message.id,
        text: "compatibility broadcast",
      });
    } finally {
      client.close();
      harness.stop();
    }
  });

  test("does not broadcast a rejected command", async () => {
    const harness = startHarness();
    const client = await harness.connect("conv-engineering");

    try {
      const rejected = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: "git log" },
      );

      expect(rejected.status).toBe(400);
      expect(await client.drain()).toEqual([]);

      const unknownBranch = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: 'git commit -m "nowhere"', branch: "release" },
      );

      expect(unknownBranch.status).toBe(400);
      expect(await client.drain()).toEqual([]);

      const unknownConversation = await harness.post(
        "/conversations/conv-missing/commands",
        { input: 'git commit -m "nowhere"' },
      );

      expect(unknownConversation.status).toBe(404);
      expect(await client.drain()).toEqual([]);

      const stored = harness.db
        .query("SELECT COUNT(*) AS total FROM messages")
        .get() as { total: number };

      expect(stored.total).toBe(0);
    } finally {
      client.close();
      harness.stop();
    }
  });

  test("delivers commits in seq order even when they are sent quickly", async () => {
    const harness = startHarness();
    const client = await harness.connect("conv-engineering");

    try {
      const texts = ["first", "second", "third", "fourth"];

      for (const text of texts) {
        const response = await harness.post(
          "/conversations/conv-engineering/commands",
          { input: `git commit -m "${text}"` },
        );

        expect(response.status).toBe(201);
      }

      const frames = [
        await client.next(),
        await client.next(),
        await client.next(),
        await client.next(),
      ];

      const messages = frames.map(
        (frame) => frame.message as MessageRecord,
      );

      expect(messages.map((message) => message.text)).toEqual(texts);
      expect(messages.map((message) => message.seq)).toEqual(
        [...messages.map((message) => message.seq)].sort((a, b) => a - b),
      );

      const listed = (await (
        await harness.get("/conversations/conv-engineering/messages")
      ).json()) as MessageRecord[];

      expect(listed.map((message) => message.id)).toEqual(
        messages.map((message) => message.id),
      );
    } finally {
      client.close();
      harness.stop();
    }
  });

  test("survives malformed frames and keeps a live connection", async () => {
    const harness = startHarness();
    const client = await harness.connect("conv-engineering");

    try {
      client.send("not json");

      expect(await client.next()).toEqual({
        type: "error",
        error: "Malformed frame: expected JSON",
      });

      client.send(JSON.stringify({ type: "commit", input: "git commit" }));

      expect(await client.next()).toEqual({
        type: "error",
        error: "Unsupported frame type",
      });

      client.send(JSON.stringify({ type: "ping" }));

      expect(await client.next()).toEqual({ type: "pong" });

      const response = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: 'git commit -m "still connected"' },
      );

      expect(response.status).toBe(201);
      expect((await client.next()).message).toMatchObject({
        text: "still connected",
      });
    } finally {
      client.close();
      harness.stop();
    }
  });

  test("broadcasts a revert to both clients in the conversation and no other", async () => {
    const harness = startHarness();
    const first = await harness.connect("conv-engineering");
    const second = await harness.connect("conv-engineering");
    const elsewhere = await harness.connect("conv-weekend");

    try {
      const commitResponse = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: 'git commit -m "revert this"' },
      );

      expect(commitResponse.status).toBe(201);

      const commit = await sentMessage(commitResponse);

      await first.next();
      await second.next();

      const revertResponse = await harness.post(
        "/conversations/conv-engineering/commands",
        { input: `git revert ${commit.id.slice(0, 8)}` },
      );

      expect(revertResponse.status).toBe(201);

      for (const client of [first, second]) {
        const created = await client.next();

        expect(created.type).toBe("message.created");
        expect(created.conversationId).toBe("conv-engineering");
        expect(created.message).toMatchObject({
          text: 'Revert "revert this"',
          command: "git revert",
        });

        const updated = await client.next();

        expect(updated.type).toBe("message.updated");
        expect(updated.conversationId).toBe("conv-engineering");
        expect(updated.seq).toBe(commit.seq);
        expect(updated.message).toMatchObject({
          id: commit.id,
          reverted: true,
          stashed: false,
        });
      }

      expect(await elsewhere.drain()).toEqual([]);
    } finally {
      first.close();
      second.close();
      elsewhere.close();
      harness.stop();
    }
  });

  test("removes a client from the registry when it disconnects", async () => {
    const harness = startHarness();
    const client = await harness.connect("conv-engineering");

    try {
      expect(harness.hub.clientCount()).toBe(1);

      client.close();

      await waitFor(() => harness.hub.clientCount() === 0);
      expect(harness.hub.subscriberCount("conv-engineering")).toBe(0);
    } finally {
      harness.stop();
    }
  });

  test("rejects a socket for an unknown conversation without opening it", async () => {
    const harness = startHarness();

    try {
      const response = await harness.get(
        "/conversations/conv-missing/events",
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Unknown conversation: conv-missing",
      });
      expect(harness.hub.clientCount()).toBe(0);
    } finally {
      harness.stop();
    }
  });
});
