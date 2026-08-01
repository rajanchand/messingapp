import { describe, expect, it } from "vitest";
import { getAdapter, INTEGRATION_TYPES, type IntegrationAdapter } from "./index";

describe("integration adapters", () => {
  it("registers all types", () => {
    for (const type of INTEGRATION_TYPES) {
      const adapter = getAdapter(type);
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe(type);
      expect(typeof adapter!.execute).toBe("function");
    }
  });

  it("webhook adapter requires url", async () => {
    const adapter = getAdapter("webhook") as IntegrationAdapter;
    const result = await adapter.execute(
      { integrationId: "x", config: {}, secrets: {} },
      "send",
      {},
    );
    expect(result.ok).toBe(false);
  });
});
