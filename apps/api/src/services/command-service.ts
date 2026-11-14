import { parseCommand } from "@gitping/command-engine";
import type { MessageRepository } from "../repositories/message-repository";
import type { MessageRecord } from "../types/http";

export type SendCommandResult =
  | { ok: true; message: MessageRecord }
  | { ok: false; error: string };

export function createCommandService(messages: MessageRepository) {
  return {
    send(input: string, author: string): SendCommandResult {
      let command;

      try {
        command = parseCommand(input);
      } catch {
        return { ok: false, error: "Unsupported or invalid Git command" };
      }

      if (command.type !== "commit") {
        return {
          ok: false,
          error: 'For the first message flow, use: git commit -m "message"',
        };
      }

      const message: MessageRecord = {
        id: crypto.randomUUID(),
        author,
        text: command.message,
        command: "git commit",
        createdAt: new Date().toISOString(),
      };

      messages.insert(message);

      return { ok: true, message };
    },
  };
}

export type CommandService = ReturnType<typeof createCommandService>;
