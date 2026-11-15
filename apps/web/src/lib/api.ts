import type {
  ApiBranch,
  ApiConversation,
  ApiMember,
  ConversationKind,
} from "../types/conversation";
import type { ApiMessage, CreatedMessage } from "../types/message";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL.replace(/^http/, "ws");

/**
 * One socket per conversation. The server subscribes the socket to that
 * conversation only, and sends a `ready` frame once the subscription is live.
 */
export function conversationEventsUrl(conversationId: string): string {
  return `${WS_URL}/conversations/${encodeURIComponent(conversationId)}/events`;
}

type CreateCommandResponse = {
  message: CreatedMessage;
};

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

export async function sendConversationCommand(
  conversationId: string,
  input: string,
  branch: string,
): Promise<CreatedMessage> {
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
      }),
    },
  );

  const data = await readJson<CreateCommandResponse>(response, "Command failed");

  return data.message;
}
