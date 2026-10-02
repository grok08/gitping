const API_URL = "http://localhost:3000";

export type ApiMessage = {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

export type CreatedMessage = {
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
};

type CreateCommandResponse = {
  message: CreatedMessage;
};

type ApiErrorResponse = {
  error?: string;
};

export async function getMessages(): Promise<ApiMessage[]> {
  const response = await fetch(`${API_URL}/messages`);

  if (!response.ok) {
    throw new Error("Unable to load messages");
  }

  return response.json() as Promise<ApiMessage[]>;
}

export async function sendCommand(
  input: string,
  author = "grok08",
): Promise<CreatedMessage> {
  const response = await fetch(`${API_URL}/commands`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      input,
      author,
    }),
  });

  const data = (await response.json()) as
    | CreateCommandResponse
    | ApiErrorResponse;

  if (!response.ok) {
    throw new Error(
      "error" in data && data.error
        ? data.error
        : "Command failed",
    );
  }

  if (!("message" in data)) {
    throw new Error("Invalid API response");
  }

  return data.message;
}