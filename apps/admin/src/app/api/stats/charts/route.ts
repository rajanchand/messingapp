import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Builds a continuous series of the last N days with zero-filled buckets. */
function buildSeries(days: number): { date: string }[] {
  const out: { date: string }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: dayKey(d) });
  }
  return out;
}

export const GET = createApiHandler(
  { querySchema, rateLimit: "api" },
  async ({ query }) => {
    const db = getDb();
    const synapse = getSynapseClient();
    const days = query.days;

    const [loginRows, securityRows, workflowRows, integrationRows, recentUsers] =
      await Promise.all([
        db.execute(sql`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
               count(*) filter (where success) as successful,
               count(*) filter (where not success) as failed
        from login_attempts
        where created_at > now() - (${days} * interval '1 day')
        group by 1
      `),
        db.execute(sql`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
               count(*) as events
        from security_events
        where created_at > now() - (${days} * interval '1 day')
        group by 1
      `),
        db.execute(sql`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
               count(*) as total,
               count(*) filter (where status = 'succeeded') as succeeded,
               count(*) filter (where status = 'failed') as failed
        from workflow_runs
        where created_at > now() - (${days} * interval '1 day')
        group by 1
      `),
        db.execute(sql`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
               count(*) as total,
               count(*) filter (where level = 'error') as errors
        from integration_logs
        where created_at > now() - (${days} * interval '1 day')
        group by 1
      `),
        synapse.listUsers({ limit: 500, order_by: "creation_ts", dir: "b", deactivated: true }),
      ]);

    const loginByDay = new Map(
      (loginRows as unknown as { day: string; successful: string; failed: string }[]).map((r) => [
        r.day,
        { successful: Number(r.successful), failed: Number(r.failed) },
      ]),
    );
    const securityByDay = new Map(
      (securityRows as unknown as { day: string; events: string }[]).map((r) => [
        r.day,
        Number(r.events),
      ]),
    );
    const workflowByDay = new Map(
      (
        workflowRows as unknown as {
          day: string;
          total: string;
          succeeded: string;
          failed: string;
        }[]
      ).map((r) => [
        r.day,
        {
          total: Number(r.total),
          succeeded: Number(r.succeeded),
          failed: Number(r.failed),
        },
      ]),
    );
    const integrationByDay = new Map(
      (integrationRows as unknown as { day: string; total: string; errors: string }[]).map((r) => [
        r.day,
        { total: Number(r.total), errors: Number(r.errors) },
      ]),
    );

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const newUsersByDay = new Map<string, number>();
    for (const user of recentUsers.users) {
      if (user.creation_ts >= cutoff) {
        const key = dayKey(new Date(user.creation_ts));
        newUsersByDay.set(key, (newUsersByDay.get(key) ?? 0) + 1);
      }
    }

    const series = buildSeries(days).map(({ date }) => {
      const wf = workflowByDay.get(date);
      const integ = integrationByDay.get(date);
      return {
        date,
        successfulLogins: loginByDay.get(date)?.successful ?? 0,
        failedLogins: loginByDay.get(date)?.failed ?? 0,
        securityEvents: securityByDay.get(date) ?? 0,
        newUsers: newUsersByDay.get(date) ?? 0,
        workflowRuns: wf?.total ?? 0,
        workflowSuccessRate:
          wf && wf.total > 0 ? Math.round((wf.succeeded / wf.total) * 100) : null,
        integrationCalls: integ?.total ?? 0,
        integrationErrorRate:
          integ && integ.total > 0 ? Math.round((integ.errors / integ.total) * 100) : null,
      };
    });

    return jsonOk({ series });
  },
);
