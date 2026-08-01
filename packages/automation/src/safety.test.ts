import { describe, expect, it } from "vitest";
import {
  assertActionCount,
  assertTriggerDepth,
  buildIdempotencyKey,
  detectSelfLoop,
  ACTION_TRIGGER_CASCADE,
  SafetyError,
  MAX_ACTIONS_PER_RUN,
} from "./safety";
import { evaluateConditions } from "./conditions";

describe("assertActionCount", () => {
  it("allows up to the max", () => {
    expect(() => assertActionCount(MAX_ACTIONS_PER_RUN)).not.toThrow();
  });
  it("rejects over the max", () => {
    expect(() => assertActionCount(MAX_ACTIONS_PER_RUN + 1)).toThrow(SafetyError);
  });
});

describe("assertTriggerDepth", () => {
  it("detects deep cascades", () => {
    expect(() => assertTriggerDepth(4)).toThrow(/cascade depth/);
  });
});

describe("detectSelfLoop", () => {
  it("flags deactivate → USER_DEACTIVATED loops", () => {
    expect(
      detectSelfLoop("USER_DEACTIVATED", ["DEACTIVATE_USER"], ACTION_TRIGGER_CASCADE),
    ).toBe(true);
  });
  it("allows notify-only workflows", () => {
    expect(detectSelfLoop("USER_CREATED", ["NOTIFY_ADMIN"], ACTION_TRIGGER_CASCADE)).toBe(false);
  });
});

describe("buildIdempotencyKey", () => {
  it("is stable", () => {
    expect(buildIdempotencyKey("w1", "USER_CREATED", "abc")).toBe("w1:USER_CREATED:abc");
  });
});

describe("evaluateConditions", () => {
  it("matches eq/contains", () => {
    expect(
      evaluateConditions(
        { all: [{ field: "admin", op: "eq", value: true }] },
        { admin: true },
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { all: [{ field: "userId", op: "contains", value: "alice" }] },
        { userId: "@alice:example.org" },
      ),
    ).toBe(true);
    expect(
      evaluateConditions({ any: [{ field: "x", op: "eq", value: 1 }] }, { x: 2 }),
    ).toBe(false);
  });
  it("empty group is true", () => {
    expect(evaluateConditions({}, {})).toBe(true);
    expect(evaluateConditions(null, {})).toBe(true);
  });
});
