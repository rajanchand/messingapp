import { z } from "zod";
import { getSynapseClient } from "@zts/matrix";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const querySchema = z.object({
  from: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  user_id: z.string().max(255).optional(),
  room_id: z.string().max(255).optional(),
});

export const GET = createApiHandler(
  { permission: "reports.read", querySchema, rateLimit: "api" },
  async ({ query }) => {
    const data = await getSynapseClient().listEventReports(query);
    return jsonOk(data);
  },
);
