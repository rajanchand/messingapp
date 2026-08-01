import { describe, expect, it } from "vitest";
import {
  ADMIN_TOOL_DEFINITIONS,
  ADMIN_TOOL_NAMES,
  getAdminToolSchema,
  isAdminToolName,
  parseAdminToolArgs,
  parseAdminToolCall,
} from "./tools/index";

describe("admin tool schemas", () => {
  it("exposes read-only tool definitions", () => {
    expect(ADMIN_TOOL_DEFINITIONS.length).toBe(ADMIN_TOOL_NAMES.length);
    expect(ADMIN_TOOL_DEFINITIONS.every((tool) => tool.type === "function")).toBe(true);
    expect(ADMIN_TOOL_DEFINITIONS.every((tool) => Boolean(tool.function.name))).toBe(true);
  });

  it("validates known tool names and args", () => {
    expect(isAdminToolName("get_user_stats")).toBe(true);
    expect(isAdminToolName("delete_everything")).toBe(false);
    expect(getAdminToolSchema("get_audit_summary")).toBeDefined();
    expect(parseAdminToolArgs("get_user_stats", { limit: 10 })).toEqual({ limit: 10 });
    expect(parseAdminToolCall("get_workflow_status", '{"limit":5}')).toEqual({ limit: 5 });
  });

  it("rejects invalid tool args", () => {
    expect(() => parseAdminToolArgs("get_user_stats", { limit: 0 })).toThrow();
  });
});
