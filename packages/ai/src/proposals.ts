import { z } from "zod";

/**
 * Privileged action kinds stored in `ai_proposals.kind`.
 * The admin app persists proposals and executes side effects only after approval.
 */
export const AI_PROPOSAL_KINDS = [
  "user.deactivate",
  "user.reactivate",
  "user.reset_password",
  "user.assign_role",
  "user.revoke_role",
  "security.block_ip",
  "security.unblock_ip",
  "workflow.create",
  "workflow.update",
  "workflow.enable",
  "workflow.disable",
  "integration.configure",
  "integration.enable",
  "integration.disable",
] as const;

export type AiProposalKind = (typeof AI_PROPOSAL_KINDS)[number];

export const AI_PROPOSAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type AiProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number];

const userTargetPayloadSchema = z.object({
  userId: z.string().min(1),
  matrixUserId: z.string().optional(),
});

const userDeactivatePayloadSchema = userTargetPayloadSchema.extend({
  erase: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

const userReactivatePayloadSchema = userTargetPayloadSchema.extend({
  password: z.string().min(8).optional(),
});

const userResetPasswordPayloadSchema = userTargetPayloadSchema.extend({
  /** When true the admin app generates a temporary password on approval. */
  generateTemporary: z.boolean().optional(),
});

const roleChangePayloadSchema = userTargetPayloadSchema.extend({
  roleSlug: z.string().min(1).max(64),
});

const ipBlockPayloadSchema = z.object({
  cidr: z.string().min(1).max(64),
  reason: z.string().max(500).optional(),
  expiresAt: z.iso.datetime().optional(),
});

const ipUnblockPayloadSchema = z.object({
  blockId: z.uuid().optional(),
  cidr: z.string().min(1).max(64).optional(),
});

const workflowMutationPayloadSchema = z.object({
  workflowId: z.uuid().optional(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).optional(),
  triggerType: z.string().min(1).max(64).optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
});

const integrationMutationPayloadSchema = z.object({
  integrationId: z.uuid().optional(),
  type: z.enum(["slack", "github", "email", "discord", "jira", "webhook"]).optional(),
  name: z.string().min(1).max(128).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const proposalPayloadSchemas: Record<AiProposalKind, z.ZodType<Record<string, unknown>>> = {
  "user.deactivate": userDeactivatePayloadSchema,
  "user.reactivate": userReactivatePayloadSchema,
  "user.reset_password": userResetPasswordPayloadSchema,
  "user.assign_role": roleChangePayloadSchema,
  "user.revoke_role": roleChangePayloadSchema,
  "security.block_ip": ipBlockPayloadSchema,
  "security.unblock_ip": ipUnblockPayloadSchema,
  "workflow.create": workflowMutationPayloadSchema,
  "workflow.update": workflowMutationPayloadSchema,
  "workflow.enable": workflowMutationPayloadSchema,
  "workflow.disable": workflowMutationPayloadSchema,
  "integration.configure": integrationMutationPayloadSchema,
  "integration.enable": integrationMutationPayloadSchema,
  "integration.disable": integrationMutationPayloadSchema,
};

/** Insert shape for `ai_proposals` excluding server-managed columns. */
export interface AiProposalInsert {
  kind: AiProposalKind;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AiProposalRecord extends AiProposalInsert {
  id: string;
  userId: string;
  status: AiProposalStatus;
  decidedAt: Date | null;
  createdAt: Date;
}

export function isAiProposalKind(value: string): value is AiProposalKind {
  return (AI_PROPOSAL_KINDS as readonly string[]).includes(value);
}

export function validateProposalPayload(
  kind: AiProposalKind,
  payload: unknown,
): Record<string, unknown> {
  return proposalPayloadSchemas[kind].parse(payload);
}

/**
 * Builds a validated privileged-action proposal. Never executes side effects —
 * the admin app persists the row and applies changes only after human approval.
 */
export function createProposal(
  kind: AiProposalKind,
  summary: string,
  payload: unknown,
): AiProposalInsert {
  const trimmedSummary = summary.trim();
  if (trimmedSummary.length === 0) {
    throw new Error("Proposal summary must not be empty.");
  }
  if (trimmedSummary.length > 2000) {
    throw new Error("Proposal summary exceeds 2000 characters.");
  }

  return {
    kind,
    summary: trimmedSummary,
    payload: validateProposalPayload(kind, payload),
  };
}

export function getProposalPayloadSchema(kind: AiProposalKind): z.ZodType<Record<string, unknown>> {
  return proposalPayloadSchemas[kind];
}
