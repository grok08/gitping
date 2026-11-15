import type {
  ApiMessage,
  CreatedMessage,
  Message,
} from "../types/message";
import { formatTime } from "./format";

function buildMessage(payload: CreatedMessage): Message {
  return {
    seq: payload.seq,
    id: payload.id,
    author: payload.author,
    avatar: payload.author.charAt(0).toUpperCase(),
    text: payload.text,
    command: `${payload.command} -m "${payload.text}"`,
    time: formatTime(payload.createdAt),
    mine: payload.author === "grok08",
  };
}

export function fromApiMessage(message: ApiMessage): Message {
  return buildMessage({
    seq: message.seq,
    id: message.id,
    author: message.author,
    text: message.text,
    command: message.command,
    createdAt: message.created_at,
  });
}

export function fromConfirmedMessage(message: CreatedMessage): Message {
  return buildMessage(message);
}

/**
 * The single merge point for confirmed messages, whatever their source:
 * initial history, reconnect catch-up, a broadcast, or the HTTP response to
 * the sender's own command.
 *
 * - Duplicates collapse by server id, so a broadcast that repeats a message
 *   already on screen (or an event delivered twice) cannot render twice.
 * - Order comes from `seq`, so an out-of-order event lands where it belongs
 *   rather than at the bottom of the list.
 */
export function mergeMessages(
  current: Message[],
  incoming: Message[],
): Message[] {
  if (incoming.length === 0) {
    return current;
  }

  const byId = new Map<string, Message>();

  for (const message of current) {
    byId.set(message.id, message);
  }

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}
