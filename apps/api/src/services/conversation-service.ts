import type { Database } from "bun:sqlite";
import type { BranchRepository } from "../repositories/branch-repository";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { MessageRepository } from "../repositories/message-repository";
import type { UserRepository } from "../repositories/user-repository";
import type { ConversationKind } from "../types/domain";
import type {
  BranchSummary,
  ConversationMemberRecord,
  ConversationSummary,
  MessageRow,
} from "../types/http";

export type ConversationFailureReason = "invalid" | "duplicate" | "not_found";

export type ConversationFailure = {
  ok: false;
  reason: ConversationFailureReason;
  error: string;
};

export type ConversationResult<T> = { ok: true; value: T } | ConversationFailure;

export type CreateConversationInput = {
  name: string;
  kind: string;
};

export type ConversationServiceDependencies = {
  db: Database;
  users: UserRepository;
  conversations: ConversationRepository;
  branches: BranchRepository;
  messages: MessageRepository;
};

const maxNameLength = 80;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reject(
  reason: ConversationFailureReason,
  error: string,
): ConversationFailure {
  return { ok: false, reason, error };
}

function isConversationKind(value: string): value is ConversationKind {
  return value === "channel" || value === "direct";
}

export function createConversationService({
  db,
  users,
  conversations,
  branches,
  messages,
}: ConversationServiceDependencies) {
  function unknownConversation(conversationId: string): ConversationFailure {
    return reject("not_found", `Unknown conversation: ${conversationId}`);
  }

  function viewerId(handle: string): string {
    return users.findByHandle(handle)?.id ?? "";
  }

  function requireConversation(conversationId: string): ConversationFailure | null {
    return conversations.findById(conversationId)
      ? null
      : unknownConversation(conversationId);
  }

  return {
    list(viewerHandle: string): ConversationSummary[] {
      return conversations.listSummaries(viewerId(viewerHandle));
    },

    create(
      input: CreateConversationInput,
      viewerHandle: string,
    ): ConversationResult<ConversationSummary> {
      const name = input.name.trim();
      const kind = input.kind;

      if (!isConversationKind(kind)) {
        return reject(
          "invalid",
          'Conversation kind must be "channel" or "direct"',
        );
      }

      if (!name) {
        return reject("invalid", "Conversation name is required");
      }

      if (name.length > maxNameLength) {
        return reject(
          "invalid",
          `Conversation name must be ${maxNameLength} characters or fewer`,
        );
      }

      const slug = slugify(name);

      if (!slug) {
        return reject(
          "invalid",
          "Conversation name must include at least one letter or number",
        );
      }

      const conversationId = `conv-${kind}-${slug}`;
      const existing =
        conversations.findByKindAndName(kind, name) ??
        conversations.findById(conversationId);

      if (existing) {
        return reject(
          "duplicate",
          `A ${kind} named ${existing.name} already exists`,
        );
      }

      const viewer = users.ensure(viewerHandle);
      const branchId = `branch-${conversationId}-main`;
      const createdAt = new Date().toISOString();

      const write = db.transaction(() => {
        conversations.create({
          id: conversationId,
          name,
          kind,
          createdBy: viewer.id,
          createdAt,
        });

        conversations.addMember(conversationId, viewer.id, createdAt);

        if (kind === "direct") {
          const partner = users.findByHandle(name);

          if (partner && partner.id !== viewer.id) {
            conversations.addMember(conversationId, partner.id, createdAt);
          }
        }

        branches.create({
          id: branchId,
          conversationId,
          name: "main",
          headMessageId: null,
          createdFromBranchId: null,
          createdAt,
        });
      });

      write();

      const conversation = conversations.findSummary(conversationId, viewer.id);

      if (!conversation) {
        throw new Error(`Unable to read back conversation ${conversationId}`);
      }

      return { ok: true, value: conversation };
    },

    messages(conversationId: string): ConversationResult<MessageRow[]> {
      const missing = requireConversation(conversationId);

      if (missing) {
        return missing;
      }

      return { ok: true, value: messages.list(conversationId) };
    },

    members(
      conversationId: string,
    ): ConversationResult<ConversationMemberRecord[]> {
      const missing = requireConversation(conversationId);

      if (missing) {
        return missing;
      }

      return { ok: true, value: conversations.listMembers(conversationId) };
    },

    branches(conversationId: string): ConversationResult<BranchSummary[]> {
      const missing = requireConversation(conversationId);

      if (missing) {
        return missing;
      }

      return { ok: true, value: branches.list(conversationId) };
    },
  };
}

export type ConversationService = ReturnType<typeof createConversationService>;
