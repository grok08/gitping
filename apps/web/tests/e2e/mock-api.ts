import type { Page } from "@playwright/test";

export const apiUrl = "http://localhost:3000";

type MockMessage = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
  reverted: boolean;
  stashed: boolean;
  note: string | null;
  branchId: string;
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
  current: boolean;
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
    reverted: false,
    stashed: false,
    note: null,
    branchId: "branch-conv-engineering-main",
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
          { id: "branch-conv-engineering-main", name: "main", headMessageId: seedMessage.id, current: true },
          { id: "branch-conv-engineering-weekend", name: "weekend", headMessageId: null, current: false },
          { id: "branch-conv-engineering-feature-ui", name: "feature-ui", headMessageId: null, current: false },
        ],
      ],
      ["conv-general", [{ id: "branch-conv-general-main", name: "main", headMessageId: null, current: true }]],
      ["conv-random", [{ id: "branch-conv-random-main", name: "main", headMessageId: null, current: true }]],
      ["conv-weekend", [{ id: "branch-conv-weekend-main", name: "main", headMessageId: null, current: true }]],
      ["conv-rahul", [{ id: "branch-conv-rahul-main", name: "main", headMessageId: null, current: true }]],
      ["conv-alice", [{ id: "branch-conv-alice-main", name: "main", headMessageId: null, current: true }]],
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

function branchNameFor(
  state: MockState,
  conversationId: string,
  branchId: string,
): string {
  return (
    state.branches
      .get(conversationId)
      ?.find((branch) => branch.id === branchId)?.name ?? "main"
  );
}

/**
 * The mock understands the text part of a query and ignores filters. Filter
 * behavior is proven against the real API, not here.
 */
function searchTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .filter((token) => !/^(author|command|branch|after|before):/i.test(token))
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function matchesTerms(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();

  return terms.every((term) => lower.includes(term));
}

function messageHits(
  state: MockState,
  terms: readonly string[],
  onlyConversationId?: string,
) {
  const hits: Array<Record<string, unknown>> = [];

  for (const conversation of state.conversations) {
    if (onlyConversationId && conversation.id !== onlyConversationId) {
      continue;
    }

    for (const message of state.messages.get(conversation.id) ?? []) {
      if (!matchesTerms(message.text, terms)) {
        continue;
      }

      hits.push({
        id: message.id,
        seq: message.seq,
        text: message.text,
        snippet: message.text,
        author: message.author,
        command: message.command,
        createdAt: message.created_at,
        reverted: message.reverted,
        stashed: message.stashed,
        branch: {
          id: message.branchId,
          name: branchNameFor(state, conversation.id, message.branchId),
        },
        conversation: {
          id: conversation.id,
          name: conversation.name,
          kind: conversation.kind,
        },
      });
    }
  }

  return hits.sort(
    (left, right) => (right.seq as number) - (left.seq as number),
  );
}

function parsedQuery(terms: readonly string[]) {
  return {
    text: terms.join(" "),
    terms,
    filters: {
      author: null,
      command: null,
      branch: null,
      after: null,
      before: null,
    },
  };
}

function searchWorkspaceFixture(state: MockState, url: string) {
  const terms = searchTerms(new URL(url).searchParams.get("q") ?? "");
  const messages = messageHits(state, terms);
  const conversations =
    terms.length === 0
      ? []
      : state.conversations.filter(
          (conversation) =>
            matchesTerms(conversation.name, terms) ||
            (conversation.preview !== null &&
              matchesTerms(conversation.preview, terms)),
        );
  const people =
    terms.length === 0
      ? []
      : users.filter(
          (user) =>
            matchesTerms(user.handle, terms) ||
            matchesTerms(user.displayName, terms),
        );
  const branches =
    terms.length === 0
      ? []
      : state.conversations.flatMap((conversation) =>
          (state.branches.get(conversation.id) ?? [])
            .filter((branch) => matchesTerms(branch.name, terms))
            .map((branch) => ({
              id: branch.id,
              name: branch.name,
              conversationId: conversation.id,
              conversationName: conversation.name,
              conversationKind: conversation.kind,
              current: branch.current,
            })),
        );

  return {
    query: parsedQuery(terms),
    groups: { conversations, users: people, branches, messages },
    totals: {
      conversations: conversations.length,
      users: people.length,
      branches: branches.length,
      messages: messages.length,
    },
    truncated: {
      conversations: false,
      users: false,
      branches: false,
      messages: false,
    },
  };
}

function searchConversationFixture(
  state: MockState,
  conversationId: string,
  url: string,
) {
  const terms = searchTerms(new URL(url).searchParams.get("q") ?? "");
  const messages = messageHits(state, terms, conversationId);

  return {
    query: parsedQuery(terms),
    messages,
    total: messages.length,
    truncated: false,
  };
}

function stashRecords(
  state: MockState,
  conversationId: string,
  branchId: string,
): Array<{ id: string; text: string; note: string | null; createdAt: string }> {
  return (state.messages.get(conversationId) ?? [])
    .filter((message) => message.branchId === branchId && message.stashed)
    .sort((left, right) => right.seq - left.seq)
    .map((message) => ({
      id: message.id,
      text: message.text,
      note: message.note,
      createdAt: message.created_at,
    }));
}

function setCurrentBranch(
  state: MockState,
  conversationId: string,
  branchId: string,
): void {
  for (const branch of state.branches.get(conversationId) ?? []) {
    branch.current = branch.id === branchId;
  }
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

      send(data?: string) {
        // Answer keepalives so the mocked UI never trips the heartbeat.
        if (typeof data === "string" && data.includes('"ping"')) {
          window.setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "pong" }),
              }),
            );
          }, 0);
        }
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
      /^\/conversations\/([^/]+)\/(messages|commands|members|branches|stashes|search)$/,
    );

    if (request.method() === "GET" && pathname === "/search") {
      await json(200, searchWorkspaceFixture(state, request.url()));
      return;
    }

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
        { id: `branch-${id}-main`, name: "main", headMessageId: null, current: true },
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

    if (request.method() === "GET" && resource === "search") {
      await json(
        200,
        searchConversationFixture(state, conversationId, request.url()),
      );
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

    if (request.method() === "GET" && resource === "stashes") {
      const current = (state.branches.get(conversationId) ?? []).find(
        (item) => item.current,
      );

      await json(200, stashRecords(state, conversationId, current?.id ?? ""));
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

      const messages = state.messages.get(conversationId) ?? [];
      const words = input.trim().split(/\s+/);

      if (words[1] === "branch") {
        const name = words[2];

        if (name === undefined) {
          await json(200, { branches });
          return;
        }

        if (branches.some((item) => item.name === name)) {
          await json(409, { error: `Branch already exists: ${name}` });
          return;
        }

        branches.push({
          id: `branch-${conversationId}-${slugify(name)}`,
          name,
          headMessageId: branch.headMessageId,
          current: false,
        });
        submittedCommands.push(input);

        await json(200, { branches });
        return;
      }

      if (words[1] === "switch") {
        const name = words[2] === "-c" ? words[3] : words[2];
        const existing = branches.find((item) => item.name === name);

        if (!name) {
          await json(400, { error: "Unknown branch: " });
          return;
        }

        if (!existing && words[2] === "-c") {
          branches.push({
            id: `branch-${conversationId}-${slugify(name)}`,
            name,
            headMessageId: branch.headMessageId,
            current: true,
          });
        } else if (!existing) {
          await json(400, { error: `Unknown branch: ${name}` });
          return;
        }

        const target = branches.find((item) => item.name === name);

        if (target) {
          setCurrentBranch(state, conversationId, target.id);
        }

        submittedCommands.push(input);

        await json(200, { branches });
        return;
      }

      if (words[1] === "stash") {
        const stashed = messages.filter(
          (message) => message.branchId === branch.id && message.stashed,
        );

        if (words[2] === "list") {
          submittedCommands.push(input);
          await json(200, {
            stashes: stashRecords(state, conversationId, branch.id),
          });
          return;
        }

        if (words[2] === "pop") {
          const target = words[3];
          const stash = target
            ? stashed.find((message) => message.id.startsWith(target))
            : stashed.sort((left, right) => right.seq - left.seq)[0];

          if (!stash) {
            await json(400, {
              error: target
                ? `Unknown stash: ${target}`
                : `No stash to pop on ${branch.name}`,
            });
            return;
          }

          stash.stashed = false;
          stash.note = null;
          submittedCommands.push(input);

          await json(200, {
            stashes: stashRecords(state, conversationId, branch.id),
          });
          return;
        }

        const newest = messages
          .filter(
            (message) => message.branchId === branch.id && !message.stashed,
          )
          .sort((left, right) => right.seq - left.seq)[0];

        if (!newest) {
          await json(400, {
            error: `Nothing to stash on ${branch.name}`,
          });
          return;
        }

        const note = input.match(/-m\s+["'](.*?)["']/)?.[1] ?? null;

        newest.stashed = true;
        newest.note = note;
        submittedCommands.push(input);

        await json(200, {
          stashes: stashRecords(state, conversationId, branch.id),
        });
        return;
      }

      if (words[1] === "revert") {
        const target = words[2] ?? "";
        const reverted = messages.find((message) => message.id.startsWith(target));

        if (!reverted) {
          await json(400, { error: `Unknown message: ${target}` });
          return;
        }

        if (reverted.reverted) {
          await json(409, {
            error: `Message ${target} is already reverted`,
          });
          return;
        }

        reverted.reverted = true;
        messages.push({
          seq: messages.length + 1,
          id: `playwright-revert-${submittedCommands.length + 1}`,
          author: "grok08",
          text: `Revert "${reverted.text}"`,
          command: "git revert",
          created_at: "2026-10-03T08:44:00.000Z",
          reverted: false,
          stashed: false,
          note: null,
          branchId: branch.id,
        });
        submittedCommands.push(input);

        await json(201, { message: messages[messages.length - 1] });
        return;
      }

      if (words[1] === "merge") {
        const source = branches.find((item) => item.name === words[2]);

        if (!source || source.id === branch.id) {
          await json(400, {
            error: source
              ? "Cannot merge a branch into itself"
              : `Unknown branch: ${words[2]}`,
          });
          return;
        }

        messages.push({
          seq: messages.length + 1,
          id: `playwright-merge-${submittedCommands.length + 1}`,
          author: "grok08",
          text: `Merge branch '${source.name}' into ${branch.name}`,
          command: "git merge",
          created_at: "2026-10-03T08:45:00.000Z",
          reverted: false,
          stashed: false,
          note: null,
          branchId: branch.id,
        });
        submittedCommands.push(input);

        await json(201, { message: messages[messages.length - 1] });
        return;
      }

      const text = parseCommitText(input);
      const message: MockMessage = {
        seq: messages.length + 1,
        id: `playwright-${submittedCommands.length + 1}`,
        author: "grok08",
        text,
        command: "git commit",
        created_at: "2026-10-03T08:43:00.000Z",
        reverted: false,
        stashed: false,
        note: null,
        branchId: branch.id,
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
