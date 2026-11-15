import type { Context } from "hono";
import type {
  CommandFailureReason,
  SendCommandResult,
} from "../services/command-service";

/**
 * The failure reason decides the status, so both command routes answer the
 * same way. A conflict is the only 409; everything else is a rejected input,
 * except an unknown conversation, whose status is the route's own convention.
 */
export function commandFailureStatus(
  reason: CommandFailureReason,
  unknownConversationStatus: 400 | 404,
): 400 | 404 | 409 {
  if (reason === "unknown_conversation") {
    return unknownConversationStatus;
  }

  if (reason === "conflict" || reason === "request_conflict") {
    return 409;
  }

  return 400;
}

/**
 * A successful command answers with the one body it produced, untagged:
 * `message`, `branches`, or `stashes`. Only a new message is a created
 * resource, so only that body is a 201.
 */
export function sendCommandResponse(
  c: Context,
  result: SendCommandResult,
  unknownConversationStatus: 400 | 404 = 404,
) {
  if (!result.ok) {
    return c.json(
      { error: result.error },
      commandFailureStatus(result.reason, unknownConversationStatus),
    );
  }

  if (result.kind === "message") {
    if (result.replayed) {
      c.header("Idempotent-Replay", "true");
    }

    return c.json({ message: result.message }, 201);
  }

  if (result.kind === "branches") {
    return c.json({ branches: result.branches });
  }

  return c.json({ stashes: result.stashes });
}
