import { describe, expect, it } from "vitest";
import { draftWorkflowFromNaturalLanguage } from "./workflow-draft";

describe("draftWorkflowFromNaturalLanguage", () => {
  it("returns a heuristic draft when no API key is configured", async () => {
    const draft = await draftWorkflowFromNaturalLanguage(
      "When a new user is created, notify admins and write an audit log",
    );

    expect(draft.enabled).toBe(false);
    expect(draft.triggerType).toBe("USER_CREATED");
    expect(draft.definition.actions.length).toBeGreaterThan(0);
    expect(JSON.stringify(draft)).not.toMatch(/count|total|statistics/i);
  });

  it("infers scheduled triggers from cron language", async () => {
    const draft = await draftWorkflowFromNaturalLanguage("Run a daily health check workflow");

    expect(draft.triggerType).toBe("SCHEDULE");
    expect(draft.definition.schedule).toEqual({ cron: expect.any(String) });
  });
});
