import { sql } from "drizzle-orm";
import { getDb } from "@zts/database";
import { getRedis } from "@zts/security";
import { getSynapseClient } from "@zts/matrix";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

/** Detailed component health for the dashboard (authenticated only). */
export const GET = createApiHandler({ rateLimit: "api" }, async () => {
  const synapse = getSynapseClient();

  const [database, redis, synapseHealthy, synapseVersion] = await Promise.all([
    getDb()
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
    getRedis()
      .ping()
      .then(() => true)
      .catch(() => false),
    synapse.isHealthy(),
    synapse
      .getServerVersion()
      .then((v) => v.server_version)
      .catch(() => null),
  ]);

  return jsonOk({
    database: { healthy: database },
    redis: { healthy: redis },
    synapse: { healthy: synapseHealthy, version: synapseVersion },
  });
});
