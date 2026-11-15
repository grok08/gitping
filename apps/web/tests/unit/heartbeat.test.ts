import { describe, expect, test } from "bun:test";
import { createHeartbeat } from "../../src/lib/heartbeat";

describe("socket heartbeat", () => {
  test("pings, then reports a timeout when nothing answers", async () => {
    let pings = 0;
    let timeouts = 0;

    const heartbeat = createHeartbeat({
      intervalMs: 10,
      timeoutMs: 30,
      onPing() {
        pings += 1;
      },
      onTimeout() {
        timeouts += 1;
      },
    });

    heartbeat.start();
    await Bun.sleep(90);
    heartbeat.stop();

    expect(pings).toBeGreaterThan(0);
    expect(timeouts).toBeGreaterThan(0);
  });

  test("any inbound activity keeps the deadline open", async () => {
    let pings = 0;
    let timeouts = 0;

    const heartbeat = createHeartbeat({
      intervalMs: 10,
      timeoutMs: 40,
      onPing() {
        pings += 1;
      },
      onTimeout() {
        timeouts += 1;
      },
    });

    heartbeat.start();

    for (let index = 0; index < 10; index += 1) {
      await Bun.sleep(10);
      heartbeat.noteActivity();
    }

    heartbeat.stop();

    expect(pings).toBeGreaterThan(0);
    expect(timeouts).toBe(0);
  });

  test("stops pinging after stop", async () => {
    let pings = 0;

    const heartbeat = createHeartbeat({
      intervalMs: 10,
      timeoutMs: 20,
      onPing() {
        pings += 1;
      },
      onTimeout() {
        // Nothing to do in this case.
      },
    });

    heartbeat.start();
    await Bun.sleep(25);
    heartbeat.stop();

    const afterStop = pings;

    await Bun.sleep(40);

    expect(pings).toBe(afterStop);
  });
});
