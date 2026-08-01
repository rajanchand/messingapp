import { z } from "zod";
import { draftWorkflowFromNaturalLanguage } from "@zts/ai";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
});

export const POST = createApiHandler(
  { permission: "automation.create", bodySchema, rateLimit: "mutation" },
  async ({ body }) => {
    const draft = await draftWorkflowFromNaturalLanguage(body.prompt);
    // Map AI draft shape (conditions array) to automation engine shape ({ all }).
    const definition = {
      conditions: {
        all: (draft.definition.conditions ?? []).map((c) => ({
          field: c.field,
          op: c.operator === "eq" ? "eq" : c.operator,
          value: c.value,
        })),
      },
      actions: draft.definition.actions,
    };
    return jsonOk({
      draft: {
        name: draft.name,
        description: draft.description,
        triggerType: draft.triggerType,
        enabled: false,
        definition,
        notes: draft.description,
      },
    });
  },
);
