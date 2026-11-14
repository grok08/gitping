import { parseCommand } from "@gitping/command-engine";
import type { Database } from "bun:sqlite";
import type { BranchRepository } from "../repositories/branch-repository";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { MessageRepository } from "../repositories/message-repository";
import type { UserRepository } from "../repositories/user-repository";
import type { MessageRecord, MessageRow } from "../types/http";

export type SendCommandOptions = {
  conversation?: string;
  branch?: string;
};

export type SendCommandResult =
  | { ok: true; message: MessageRecord }
  | { ok: false; error: string };

export type CommandServiceDependencies = {
  db: Database;
  users: UserRepository;
  conversations: ConversationRepository;
  branches: BranchRepository;
  messages: MessageRepository;
};

const defaultConversation = "engineering";
const defaultBranch = "main";

function reject(error: string): SendCommandResult {
  return { ok: false, error };
}

export function createCommandService({
  db,
  users,
  conversations,
  branches,
  messages,
}: CommandServiceDependencies) {
  return {
    send(
      input: string,
      author: string,
      options: SendCommandOptions = {},
    ): SendCommandResult {
      let parsed: ReturnType<typeof parseCommand>;

      try {
        parsed = parseCommand(input);
      } catch {
        return reject("Unsupported or invalid Git command");
      }

      if (parsed.type !== "commit") {
        return reject(
          'For the first message flow, use: git commit -m "message"',
        );
      }

      const conversationName = options.conversation ?? defaultConversation;
      const conversation = conversations.findByKindAndName(
        "channel",
        conversationName,
      );

      if (!conversation) {
        return reject(`Unknown conversation: ${conversationName}`);
      }

      const branchName = options.branch ?? defaultBranch;
      const branch = branches.find(conversation.id, branchName);

      if (!branch) {
        return reject(`Unknown branch: ${branchName}`);
      }

      const write = db.transaction((): MessageRow => {
        const user = users.ensure(author);

        const message = messages.insert({
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          branchId: branch.id,
          authorId: user.id,
          text: parsed.message,
          verb: parsed.type,
          raw: input,
          args: JSON.stringify(parsed),
          createdAt: new Date().toISOString(),
        });

        branches.setHead(branch.id, message.id);

        return message;
      });

      const row = write();

      return {
        ok: true,
        message: {
          id: row.id,
          author: row.author,
          text: row.text,
          command: row.command,
          createdAt: row.created_at,
        },
      };
    },
  };
}

export type CommandService = ReturnType<typeof createCommandService>;
