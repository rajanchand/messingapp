import { desc, eq } from "drizzle-orm";
import { getDb, workflowRuns, workflowRunSteps } from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

export const GET = createApiHandler(
  { permission: "automation.read", rateLimit: "api" },
  async ({ params }) => {
    const db = getDb();
    const runs = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, params.id!))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(50);

    const withSteps = await Promise.all(
      runs.map(async (run) => {
        const steps = await db
          .select()
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.runId, run.id))
          .orderBy(workflowRunSteps.stepIndex);
        return { ...run, steps };
      }),
    );

    return jsonOk({ runs: withSteps });
  },
);
