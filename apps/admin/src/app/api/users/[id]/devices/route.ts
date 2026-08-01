import { getSynapseClient } from "@zts/matrix";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

export const GET = createApiHandler(
  { permission: "users.read", rateLimit: "api" },
  async ({ params }) => {
    const userId = requireMatrixUserId(params);
    const result = await getSynapseClient().listDevices(userId);
    return jsonOk(result);
  },
);
