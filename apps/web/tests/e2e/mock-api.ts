import type { Page } from "@playwright/test";

export const apiUrl = "http://localhost:3000";

type MockMessage = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

type MockConversation = {
  id: string;
  name: string;
  kind: "channel" | "direct";
  memberCount: number;
  preview: string | null;
  unreadCount: number;
};

type MockBranch = {
  id: string;
  name: string;
  headMessageId: string | null;
};

type MockMember = {
  id: string;
  handle: string;
  displayName: string;
  avatar: string;
  role: "owner" | "developer";
};

type MockState = {
  conversations: MockConversation[];
  messages: Map<string, MockMessage[]>;
  branches: Map<string, MockBranch[]>;
};

const users: MockMember[] = [
  { id: "user-grok08", handle: "grok08", displayName: "grok08", avatar: "G", role: "owner" },
  { id: "user-rahul", handle: "rahul", displayName: "rahul", avatar: "R", role: "developer" },
  { id: "user-alice", handle: "alice", displayName: "alice", avatar: "A", role: "developer" },
  { id: "user-maria", handle: "maria", displayName: "maria", avatar: "M", role: "developer" },
];

function createState(): MockState {
  const seedMessage: MockMessage = {
    seq: 1,
    id: "playwright-seed",
    author: "rahul",
    text: "Ready to ship?",
    command: "git commit",
    created_at: "2026-10-03T08:42:00.000Z",
  };

  return {
    conversations: [
      { id: "conv-general", name: "general", kind: "channel", memberCount: 4, preview: null, unreadCount: 0 },
      { id: "conv-engineering", name: "engineering", kind: "channel", memberCount: 4, preview: seedMessage.text, unreadCount: 0 },
      { id: "conv-random", name: "random", kind: "channel", memberCount: 4, preview: null, unreadCount: 0 },
      { id: "conv-weekend", name: "weekend", kind: "channel", memberCount: 4, preview: null, unreadCount: 0 },
      { id: "conv-rahul", name: "rahul", kind: "direct", memberCount: 2, preview: null, unreadCount: 0 },
      { id: "conv-alice", name: "alice", kind: "direct", memberCount: 2, preview: null, unreadCount: 0 },
    ],
    messages: new Map([
      ["conv-engineering", [seedMessage]],
      ["conv-general", []],
      ["conv-random", []],
      ["conv-weekend", []],
      ["conv-rahul", []],
      ["conv-alice", []],
    ]),
    branches: new Map([
      [
        "conv-engineering",
        [
          { id: "branch-conv-engineering-main", name: "main", headMessageId: seedMessage.id },
          { id: "branch-conv-engineering-weekend", name: "weekend", headMessageId: null },
          { id: "branch-conv-engineering-feature-ui", name: "feature-ui", headMessageId: null },
        ],
      ],
      ["conv-general", [{ id: "branch-conv-general-main", name: "main", headMessageId: null }]],
      ["conv-random", [{ id: "branch-conv-random-main", name: "main", headMessageId: null }]],
      ["conv-weekend", [{ id: "branch-conv-weekend-main", name: "main", headMessageId: null }]],
      ["conv-rahul", [{ id: "branch-conv-rahul-main", name: "main", headMessageId: null }]],
      ["conv-alice", [{ id: "branch-conv-alice-main", name: "main", headMessageId: null }]],
    ]),
  };
}

function membersFor(conversation: MockConversation): MockMember[] {
  if (conversation.kind === "channel") {
    return users;
  }

  return users.filter(
    (user) => user.handle === "grok08" || user.handle === conversation.name,
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCommitText(input: string): string {
  const match = input.match(/(?:-m|--message)\s+["'](.*?)["']\s*$/);

  return match?.[1] ?? input;
}

export async function openApp(
  page: Page,
  viewport?: { width: number; height: number },
) {
  const submittedCommands: string[] = [];
  const state = createState();

  if (viewport) {
    await page.setViewportSize(viewport);
  }

  // These tests mock HTTP and have no real API process behind them, so the
  // realtime socket is replaced with an already-open stub. The badge stays
  // "Live" deterministically, and the socket never touches the network.
  // Real delivery is covered by tests/e2e/realtime.spec.ts against the real API.
  await page.addInitScript(() => {
    class StubWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readyState = 1;
      readonly url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);

        window.setTimeout(() => {
          if (this.readyState !== 1) {
            return;
          }

          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ type: "ready", conversationId: "mock" }),
            }),
          );
        }, 0);
      }

      send() {
        // The mocked UI has no server to talk to.
      }

      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: StubWebSocket,
    });
  });

  await page.route(`${apiUrl}/**`, async (route) => {
    const request = route.request();
    const origin = request.headers().origin ?? "http://127.0.0.1:4173";
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "content-type": "application/json",
    };
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        headers,
        body: JSON.stringify(body),
      });

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }

    const { pathname } = new URL(request.url());
    const nested = pathname.match(
      /^\/conversations\/([^/]+)\/(messages|commands|members|branches)$/,
    );

    if (request.method() === "GET" && pathname === "/conversations") {
      await json(200, state.conversations);
      return;
    }

    if (request.method() === "POST" && pathname === "/conversations") {
      const body = request.postDataJSON() as {
        name?: string;
        kind?: "channel" | "direct";
      };
      const name = body.name?.trim() ?? "";
      const kind = body.kind ?? "channel";

      if (!name) {
        await json(400, { error: "Conversation name is required" });
        return;
      }

      if (
        state.conversations.some(
          (conversation) =>
            conversation.kind === kind && conversation.name === name,
        )
      ) {
        await json(400, { error: `A ${kind} named ${name} already exists` });
        return;
      }

      const id = `conv-${kind}-${slugify(name)}`;
      const conversation: MockConversation = {
        id,
        name,
        kind,
        memberCount: kind === "channel" ? 1 : 2,
        preview: null,
        unreadCount: 0,
      };

      state.conversations.push(conversation);
      state.messages.set(id, []);
      state.branches.set(id, [
        { id: `branch-${id}-main`, name: "main", headMessageId: null },
      ]);

      await json(201, { conversation });
      return;
    }

    if (!nested) {
      await json(404, { error: "Unhandled test API request" });
      return;
    }

    const conversationId = nested[1] ?? "";
    const resource = nested[2];
    const conversation = state.conversations.find(
      (item) => item.id === conversationId,
    );

    if (!conversation) {
      await json(404, { error: `Unknown conversation: ${conversationId}` });
      return;
    }

    if (request.method() === "GET" && resource === "messages") {
      await json(200, state.messages.get(conversationId) ?? []);
      return;
    }

    if (request.method() === "GET" && resource === "members") {
      await json(200, membersFor(conversation));
      return;
    }

    if (request.method() === "GET" && resource === "branches") {
      await json(200, state.branches.get(conversationId) ?? []);
      return;
    }

    if (request.method() === "POST" && resource === "commands") {
      const body = request.postDataJSON() as {
        input?: string;
        branch?: string;
      };
      const input = body.input ?? "";
      const branchName = body.branch ?? "main";
      const branches = state.branches.get(conversationId) ?? [];
      const branch = branches.find((item) => item.name === branchName);

      if (!branch) {
        await json(400, { error: `Unknown branch: ${branchName}` });
        return;
      }

      const text = parseCommitText(input);
      const messages = state.messages.get(conversationId) ?? [];
      const message: MockMessage = {
        seq: messages.length + 1,
        id: `playwright-${submittedCommands.length + 1}`,
        author: "grok08",
        text,
        command: "git commit",
        created_at: "2026-10-03T08:43:00.000Z",
      };

      submittedCommands.push(input);
      messages.push(message);
      state.messages.set(conversationId, messages);
      conversation.preview = text;
      branch.headMessageId = message.id;

      await json(201, { message });
      return;
    }

    await json(404, { error: "Unhandled test API request" });
  });

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".message-row").first().waitFor();

  return submittedCommands;
}
