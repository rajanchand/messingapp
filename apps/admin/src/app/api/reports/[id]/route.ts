import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

export const GET = createApiHandler(
  { permission: "reports.read", rateLimit: "api" },
  async ({ params }) => {
    const report = await getSynapseClient().getEventReport(params.id!);
    return jsonOk({ report });
  },
);

export const DELETE = createApiHandler(
  { permission: "reports.manage", requireSudo: true, rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const id = params.id!;
    await getSynapseClient().deleteEventReport(id);
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "EVENT_REPORT_DELETED",
      target: id,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" as const });
  },
);
