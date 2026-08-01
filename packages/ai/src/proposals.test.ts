import { describe, expect, it } from "vitest";
import {
  AI_PROPOSAL_KINDS,
  createProposal,
  getProposalPayloadSchema,
  isAiProposalKind,
  validateProposalPayload,
} from "./proposals";

describe("proposal helpers", () => {
  it("lists supported proposal kinds", () => {
    expect(AI_PROPOSAL_KINDS).toContain("user.deactivate");
    expect(AI_PROPOSAL_KINDS).toContain("workflow.create");
  });

  it("creates a validated user deactivation proposal", () => {
    const proposal = createProposal("user.deactivate", "Deactivate inactive user", {
      userId: "abc-123",
      matrixUserId: "@jane:example.org",
      reason: "Policy violation",
    });

    expect(proposal).toEqual({
      kind: "user.deactivate",
      summary: "Deactivate inactive user",
      payload: {
        userId: "abc-123",
        matrixUserId: "@jane:example.org",
        reason: "Policy violation",
      },
    });
  });

  it("rejects empty summaries", () => {
    expect(() =>
      createProposal("security.block_ip", "   ", { cidr: "203.0.113.0/24" }),
    ).toThrow(/summary/i);
  });

  it("validates payload shape per kind", () => {
    expect(() =>
      validateProposalPayload("security.block_ip", { cidr: "203.0.113.0/24" }),
    ).not.toThrow();
    expect(() => validateProposalPayload("security.block_ip", {})).toThrow();
  });

  it("exposes payload schemas for each kind", () => {
    for (const kind of AI_PROPOSAL_KINDS) {
      expect(getProposalPayloadSchema(kind)).toBeDefined();
    }
  });

  it("detects proposal kind strings", () => {
    expect(isAiProposalKind("user.assign_role")).toBe(true);
    expect(isAiProposalKind("user.delete")).toBe(false);
  });
});
