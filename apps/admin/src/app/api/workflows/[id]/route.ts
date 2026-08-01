import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, workflows, workflowVersions } from "@zts/database";
import {
  validateWorkflowDefinition,
  WorkflowValidationError,
} from "@zts/automation";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

export const GET = createApiHandler(
  { permission: "automation.read", rateLimit: "api" },
  async ({ params }) => {
    const [row] = await getDb().select().from(workflows).where(eq(workflows.id, params.id!));
    if (!row) return jsonError(404, "not_found", "Workflow not found.");
    return jsonOk({ workflow: row });
  },
);

const patchBodySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
  triggerType: z.string().min(1).max(64).optional(),
  definition: z.unknown().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = createApiHandler(
  { permission: "automation.create", bodySchema: patchBodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const db = getDb();
    const [existing] = await db.select().from(workflows).where(eq(workflows.id, params.id!));
    if (!existing) return jsonError(404, "not_found", "Workflow not found.");

    let definition = existing.definition;
    if (body.definition !== undefined) {
      try {
        definition = validateWorkflowDefinition(body.definition);
      } catch (err) {
        if (err instanceof WorkflowValidationError) {
          return jsonError(400, "validation", err.message);
        }
        throw err;
      }
    }

    const nextVersion = body.definition !== undefined ? existing.version + 1 : existing.version;
    const [row] = await db
      .update(workflows)
      .set({
        name: body.name ?? existing.name,
        description: body.description === undefined ? existing.description : body.description,
        triggerType: body.triggerType ?? existing.triggerType,
        definition,
        enabled: body.enabled ?? existing.enabled,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, params.id!))
      .returning();

    if (body.definition !== undefined) {
      await db.insert(workflowVersions).values({
        workflowId: row!.id,
        version: nextVersion,
        definition,
        createdBy: auth.user.id,
      });
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WORKFLOW_UPDATED",
      target: row!.id,
      ip,
      userAgent,
      metadata: { enabled: row!.enabled, version: row!.version },
    });

    return jsonOk({ workflow: row });
  },
);

export const DELETE = createApiHandler(
  { permission: "automation.delete", requireSudo: true, rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const db = getDb();
    const [removed] = await db.delete(workflows).where(eq(workflows.id, params.id!)).returning();
    if (!removed) return jsonError(404, "not_found", "Workflow not found.");
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WORKFLOW_DELETED",
      target: removed.id,
      ip,
      userAgent,
    });
    return jsonOk({ deleted: true });
  },
);
