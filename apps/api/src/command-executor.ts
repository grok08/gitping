import type { GitCommand } from "@gitping/command-engine";
import { db } from "./db";

export interface CommandContext {
  author: string;
}

export interface CommitResult {
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
}

export function executeCommand(
  command: GitCommand,
  context: CommandContext,
): CommitResult | null {
  switch (command.type) {
    case "commit": {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      db.run(
        `
          INSERT INTO messages (
            id,
            author,
            text,
            command,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          id,
          context.author,
          command.message,
          "git commit",
          createdAt,
        ],
      );

      return {
        id,
        author: context.author,
        text: command.message,
        command: "git commit",
        createdAt,
      };
    }

    default:
      return null;
  }
}