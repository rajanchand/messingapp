import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, workflows, workflowVersions } from "@zts/database";
import {
  TRIGGERS,
  ACTIONS,
  validateWorkflowDefinition,
  WorkflowValidationError,
} from "@zts/automation";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

export const GET = createApiHandler(
  { permission: "automation.read", rateLimit: "api" },
  async () => {
    const rows = await getDb().select().from(workflows).orderBy(desc(workflows.updatedAt));
    return jsonOk({ workflows: rows, catalog: { triggers: TRIGGERS, actions: ACTIONS } });
  },
);

const createBodySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  triggerType: z.string().min(1).max(64),
  definition: z.unknown(),
  enabled: z.boolean().default(false),
});

export const POST = createApiHandler(
  { permission: "automation.create", bodySchema: createBodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    let definition;
    try {
      definition = validateWorkflowDefinition(body.definition);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        return jsonError(400, "validation", err.message);
      }
      throw err;
    }

    const db = getDb();
    const [row] = await db
      .insert(workflows)
      .values({
        name: body.name,
        description: body.description ?? null,
        triggerType: body.triggerType,
        definition,
        enabled: body.enabled,
        ownerId: auth.user.id,
      })
      .returning();

    await db.insert(workflowVersions).values({
      workflowId: row!.id,
      version: 1,
      definition,
      createdBy: auth.user.id,
    });

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WORKFLOW_CREATED",
      target: row!.id,
      ip,
      userAgent,
      metadata: { name: body.name, triggerType: body.triggerType },
    });

    return jsonOk({ workflow: row }, { status: 201 });
  },
);
