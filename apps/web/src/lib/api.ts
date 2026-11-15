import type {
  ApiBranch,
  ApiConversation,
  ApiMember,
  ApiStash,
  ConversationKind,
} from "../types/conversation";
import type { ApiMessage, CreatedMessage } from "../types/message";
import type {
  ConversationSearchResults,
  WorkspaceSearchResults,
} from "../types/search";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL.replace(/^http/, "ws");

/**
 * One socket per conversation. The server subscribes the socket to that
 * conversation only, and sends a `ready` frame once the subscription is live.
 */
export function conversationEventsUrl(conversationId: string): string {
  return `${WS_URL}/conversations/${encodeURIComponent(conversationId)}/events`;
}

/**
 * A command answers with one of three untagged bodies. The caller checks
 * `message`, then `branches`, then `stashes`.
 */
export type CommandResponse =
  | { message: CreatedMessage }
  | { branches: ApiBranch[] }
  | { stashes: ApiStash[] };

type CreateConversationResponse = {
  conversation: ApiConversation;
};

type ApiErrorResponse = {
  error?: string;
};

async function readJson<T>(
  response: Response,
  fallbackError: string,
): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | T
    | ApiErrorResponse
    | null;

  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data ? data.error : null;

    throw new Error(error || fallbackError);
  }

  if (!data) {
    throw new Error("Invalid API response");
  }

  return data as T;
}

export async function getConversations(): Promise<ApiConversation[]> {
  const response = await fetch(`${API_URL}/conversations`);

  return readJson<ApiConversation[]>(response, "Unable to load conversations");
}

export async function createConversation(input: {
  name: string;
  kind: ConversationKind;
}): Promise<ApiConversation> {
  const response = await fetch(`${API_URL}/conversations`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify(input),
  });

  const data = await readJson<CreateConversationResponse>(
    response,
    "Unable to create conversation",
  );

  return data.conversation;
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ApiMessage[]> {
  const response = await fetch(
    `${API_URL}/conversations/${encodeURIComponent(conversationId)}/messages`,
  );

  return readJson<ApiMessage[]>(response, "Unable to load messages");
}

export async function getConversationBranches(
  conversationId: string,
): Promise<ApiBranch[]> {
  const response = await fetch(
    `${API_URL}/conversations/${encodeURIComponent(conversationId)}/branches`,
  );

  return readJson<ApiBranch[]>(response, "Unable to load branches");
}

export async function getConversationMembers(
  conversationId: string,
): Promise<ApiMember[]> {
  const response = await fetch(
    `${API_URL}/conversations/${encodeURIComponent(conversationId)}/members`,
  );

  return readJson<ApiMember[]>(response, "Unable to load members");
}

export async function getConversationStashes(
  conversationId: string,
): Promise<ApiStash[]> {
  const response = await fetch(
    `${API_URL}/conversations/${encodeURIComponent(conversationId)}/stashes`,
  );

  return readJson<ApiStash[]>(response, "Unable to load stashes");
}

/**
 * Every search goes through the server. `encodeURIComponent` rather than
 * `URLSearchParams`, so a space is `%20` and never an ambiguous `+`.
 */
export async function searchWorkspace(
  query: string,
  signal?: AbortSignal,
): Promise<WorkspaceSearchResults> {
  const response = await fetch(
    `${API_URL}/search?q=${encodeURIComponent(query)}`,
    { signal },
  );

  return readJson<WorkspaceSearchResults>(response, "Unable to search");
}

export async function searchConversation(
  conversationId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ConversationSearchResults> {
  const response = await fetch(
    `${API_URL}/conversations/${encodeURIComponent(
      conversationId,
    )}/search?q=${encodeURIComponent(query)}`,
    { signal },
  );

  return readJson<ConversationSearchResults>(
    response,
    "Unable to search this conversation",
  );
}

export async function sendConversationCommand(
  conversationId: string,
  input: string,
  branch: string,
  requestId: string,
): Promise<CommandResponse> {
  const response = await fetch(
    `${API_URL}/conversations/${encodeURIComponent(conversationId)}/commands`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        input,
        branch,
        requestId,
      }),
    },
  );

  return readJson<CommandResponse>(response, "Command failed");
}
