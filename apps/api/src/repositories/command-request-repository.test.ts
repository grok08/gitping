import { describe, expect, test } from "bun:test";
import { createCommandRequestRepository } from "./command-request-repository";
import { createTestCommandService, sentMessage } from "../test-helpers";

function seedMessage(): {
  db: ReturnType<typeof createTestCommandService>["db"];
  messageId: string;
} {
  const { db, commands } = createTestCommandService();
  const message = sentMessage(
    commands.send('git commit -m "request row"', "grok08"),
  );

  return { db, messageId: message.id };
}

describe("command request repository", () => {
  test("inserts a request row and reads it back by id", () => {
    const { db, messageId } = seedMessage();
    const requests = createCommandRequestRepository(db);

    const record = {
      id: "request-repo-1",
      conversationId: "conv-engineering",
      messageId,
      authorId: "user-grok08",
      createdAt: "2026-11-15T10:00:00.000Z",
    };

    requests.insert(record);

    expect(requests.find(record.id)).toEqual(record);
  });

  test("returns null for an unknown request id", () => {
    const { db } = seedMessage();

    expect(createCommandRequestRepository(db).find("request-missing")).toBeNull();
  });
});
