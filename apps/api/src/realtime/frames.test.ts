import { describe, expect, test } from "bun:test";
import {
  errorFrame,
  parseClientFrame,
  pongFrame,
  readyFrame,
  serializeServerFrame,
} from "./frames";

describe("realtime frames", () => {
  test("accepts a ping frame", () => {
    expect(parseClientFrame('{"type":"ping"}')).toEqual({ type: "ping" });
  });

  test("reports malformed JSON instead of throwing", () => {
    expect(parseClientFrame("not json")).toEqual({
      type: "unsupported",
      error: "Malformed frame: expected JSON",
    });
    expect(parseClientFrame("")).toEqual({
      type: "unsupported",
      error: "Malformed frame: expected JSON",
    });
  });

  test("rejects JSON that is not a known client frame", () => {
    for (const raw of ["null", "[]", '"ping"', '{"type":"commit"}', '{"type":1}']) {
      expect(parseClientFrame(raw)).toEqual({
        type: "unsupported",
        error: "Unsupported frame type",
      });
    }
  });

  test("serializes server frames with a stable shape", () => {
    expect(readyFrame("conv-engineering")).toBe(
      '{"type":"ready","conversationId":"conv-engineering"}',
    );
    expect(pongFrame()).toBe('{"type":"pong"}');
    expect(errorFrame("nope")).toBe('{"type":"error","error":"nope"}');
    expect(serializeServerFrame({ type: "pong" })).toBe('{"type":"pong"}');
  });
});
