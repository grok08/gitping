import { describe, expect, test } from "bun:test";
import type { MessageCreatedEvent } from "./events";
import { createMessageHub } from "./hub";
import type { RealtimeClient } from "./hub";

function createClient(conversationId: string) {
  const received: string[] = [];
  const client: RealtimeClient = {
    id: `${conversationId}-${received.length}`,
    conversationId,
    send(payload) {
      received.push(payload);
    },
  };

  return { client, received };
}

function messageCreated(conversationId: string, seq: number): MessageCreatedEvent {
  return {
    type: "message.created",
    conversationId,
    seq,
    message: {
      seq,
      id: `message-${seq}`,
      author: "grok08",
      text: `note ${seq}`,
      command: "git commit",
      createdAt: "2026-10-01T09:00:00.000Z",
      reverted: false,
      stashed: false,
    },
  };
}

describe("message hub", () => {
  test("fans a committed message out to every subscriber in the conversation", () => {
    const hub = createMessageHub();
    const first = createClient("conv-engineering");
    const second = createClient("conv-engineering");

    hub.subscribe(first.client);
    hub.subscribe(second.client);
    hub.publish(messageCreated("conv-engineering", 1));

    expect(first.received).toHaveLength(1);
    expect(second.received).toHaveLength(1);
    expect(first.received).toEqual(second.received);

    const payload = JSON.parse(first.received[0] ?? "{}") as MessageCreatedEvent;

    expect(payload).toEqual(messageCreated("conv-engineering", 1));
    expect(hub.subscriberCount("conv-engineering")).toBe(2);
    expect(hub.clientCount()).toBe(2);
  });

  test("never leaks a message into another conversation", () => {
    const hub = createMessageHub();
    const engineering = createClient("conv-engineering");
    const weekend = createClient("conv-weekend");

    hub.subscribe(engineering.client);
    hub.subscribe(weekend.client);
    hub.publish(messageCreated("conv-engineering", 7));

    expect(engineering.received).toHaveLength(1);
    expect(weekend.received).toHaveLength(0);
    expect(hub.subscriberCount("conv-weekend")).toBe(1);
  });

  test("stops delivering after unsubscribe and tolerates repeated unsubscribes", () => {
    const hub = createMessageHub();
    const client = createClient("conv-engineering");

    hub.subscribe(client.client);
    hub.unsubscribe(client.client);
    hub.unsubscribe(client.client);
    hub.publish(messageCreated("conv-engineering", 2));

    expect(client.received).toHaveLength(0);
    expect(hub.subscriberCount("conv-engineering")).toBe(0);
    expect(hub.clientCount()).toBe(0);
  });

  test("drops only the subscriber whose socket refuses the write", () => {
    const hub = createMessageHub();
    const healthy = createClient("conv-engineering");
    const broken: RealtimeClient = {
      id: "broken",
      conversationId: "conv-engineering",
      send() {
        throw new Error("socket is closed");
      },
    };

    hub.subscribe(healthy.client);
    hub.subscribe(broken);
    hub.publish(messageCreated("conv-engineering", 3));

    expect(healthy.received).toHaveLength(1);
    expect(hub.subscriberCount("conv-engineering")).toBe(1);

    hub.publish(messageCreated("conv-engineering", 4));
    expect(healthy.received).toHaveLength(2);
  });

  test("drops a subscriber whose socket cannot drain, without affecting others", () => {
    const hub = createMessageHub();
    const healthy = createClient("conv-engineering");
    const closed: number[] = [];
    const slow: RealtimeClient = {
      id: "slow",
      conversationId: "conv-engineering",
      send() {
        // The write is accepted, but the socket never drains.
      },
      overloaded() {
        return true;
      },
      close(code) {
        closed.push(code ?? 0);
      },
    };

    hub.subscribe(healthy.client);
    hub.subscribe(slow);
    hub.publish(messageCreated("conv-engineering", 5));

    expect(healthy.received).toHaveLength(1);
    expect(closed).toEqual([1013]);
    expect(hub.subscriberCount("conv-engineering")).toBe(1);
  });

  test("publishing with no subscribers is a no-op", () => {    const hub = createMessageHub();

    expect(() => hub.publish(messageCreated("conv-engineering", 1))).not.toThrow();
    expect(hub.clientCount()).toBe(0);
  });

  test("closeAll closes every connection and empties the registry", () => {
    const hub = createMessageHub();
    const closed: string[] = [];
    const engineering = createClient("conv-engineering");
    const weekend = createClient("conv-weekend");

    hub.subscribe({
      ...engineering.client,
      close(code, reason) {
        closed.push(`${code}:${reason}`);
      },
    });
    hub.subscribe({
      ...weekend.client,
      close(code) {
        closed.push(String(code));
      },
    });

    hub.closeAll();

    expect(closed).toEqual(["1001:server shutting down", "1001"]);
    expect(hub.clientCount()).toBe(0);
  });
});
