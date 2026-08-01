import { z } from "zod";
import { getDb } from "@zts/database";
import {
  getDefaultLlmProvider,
  ADMIN_TOOL_DEFINITIONS,
  parseAdminToolCall,
  createProposal,
  isAiProposalKind,
} from "@zts/ai";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { and, count, desc, eq, gte } from "drizzle-orm";
import {
  auditLogs,
  securityEvents,
  workflows,
  integrations,
  loginAttempts,
  workflowRuns,
  aiProposals,
} from "@zts/database";
import type { ChatMessage } from "@zts/ai";

async function runTool(name: string, args: Record<string, unknown>) {
  const db = getDb();
  const limit = Math.min(Number(args.limit ?? 20), 50);
  const since = new Date(Date.now() - 7 * 86_400_000);
  switch (name) {
    case "get_user_stats": {
      const [fails, events, wfs, runs, ints] = await Promise.all([
        db
          .select({ c: count() })
          .from(loginAttempts)
          .where(and(eq(loginAttempts.success, false), gte(loginAttempts.createdAt, since))),
        db
          .select({ c: count() })
          .from(securityEvents)
          .where(gte(securityEvents.createdAt, since)),
        db.select({ c: count() }).from(workflows),
        db.select({ c: count() }).from(workflowRuns).where(gte(workflowRuns.createdAt, since)),
        db.select({ c: count() }).from(integrations),
      ]);
      return {
        failedLogins7d: Number(fails[0]?.c ?? 0),
        securityEvents7d: Number(events[0]?.c ?? 0),
        workflows: Number(wfs[0]?.c ?? 0),
        workflowRuns7d: Number(runs[0]?.c ?? 0),
        integrations: Number(ints[0]?.c ?? 0),
      };
    }
    case "get_audit_summary":
      return db
        .select({
          action: auditLogs.action,
          actor: auditLogs.actor,
          target: auditLogs.target,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    case "get_security_events":
      return db
        .select({
          type: securityEvents.type,
          severity: securityEvents.severity,
          ip: securityEvents.ip,
          createdAt: securityEvents.createdAt,
        })
        .from(securityEvents)
        .orderBy(desc(securityEvents.createdAt))
        .limit(limit);
    case "get_workflow_status":
      return db
        .select({
          id: workflows.id,
          name: workflows.name,
          enabled: workflows.enabled,
          triggerType: workflows.triggerType,
          lastRunAt: workflows.lastRunAt,
        })
        .from(workflows)
        .orderBy(desc(workflows.updatedAt))
        .limit(50);
    case "get_integration_health":
      return db
        .select({
          id: integrations.id,
          type: integrations.type,
          name: integrations.name,
          enabled: integrations.enabled,
          status: integrations.status,
          lastError: integrations.lastError,
        })
        .from(integrations)
        .limit(50);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .max(20)
    .default([]),
});

export const POST = createApiHandler(
  { permission: "settings.read", bodySchema: chatSchema, rateLimit: "mutation" },
  async ({ auth, body }) => {
    const provider = getDefaultLlmProvider();
    const env = getEnv();
    const configured = Boolean(env.AI_API_KEY);

    if (!configured || !provider.isConfigured()) {
      const stats = await runTool("get_user_stats", {});
      return jsonOk({
        reply: `AI is not configured (set AI_API_KEY). Snapshot: ${JSON.stringify(stats)}. Privileged changes still require propose → confirm.`,
        proposals: [],
        configured: false,
      });
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are the Zero Trust Security admin assistant. Use tools for live data. Never claim to have performed privileged actions; propose them for UI confirmation using a ```proposal JSON block with kind/summary/payload.",
      },
      ...body.history.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content })),
      { role: "user", content: body.message },
    ];

    const first = await provider.chat({
      messages,
      tools: ADMIN_TOOL_DEFINITIONS,
    });

    const toolTrace: { name: string; result: unknown }[] = [];
    let reply = first.content ?? "";

    if (first.toolCalls?.length) {
      const followup: ChatMessage[] = [...messages, { role: "assistant", content: reply || "" }];
      for (const raw of first.toolCalls) {
        const name = raw.name as Parameters<typeof parseAdminToolCall>[0];
        let args: Record<string, unknown>;
        try {
          args = parseAdminToolCall(name, raw.arguments) as Record<string, unknown>;
        } catch {
          try {
            args = JSON.parse(raw.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
        }
        const result = await runTool(name, args);
        toolTrace.push({ name, result });
        followup.push({
          role: "tool",
          content: JSON.stringify(result).slice(0, 8000),
          name,
          toolCallId: raw.id,
        });
      }
      const second = await provider.chat({ messages: followup });
      reply = second.content ?? reply;
    }

    const proposals: { id: string; kind: string; summary: string }[] = [];
    const match = reply.match(/```proposal\n([\s\S]*?)```/);
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1]) as {
          kind: string;
          summary: string;
          payload: Record<string, unknown>;
        };
        if (isAiProposalKind(parsed.kind)) {
          const insert = createProposal(parsed.kind, parsed.summary, parsed.payload);
          const [row] = await getDb()
            .insert(aiProposals)
            .values({
              userId: auth.user.id,
              kind: insert.kind,
              summary: insert.summary,
              payload: insert.payload,
              status: "pending",
            })
            .returning();
          if (row) proposals.push({ id: row.id, kind: row.kind, summary: row.summary });
        }
      } catch {
        // ignore malformed proposal
      }
    }

    return jsonOk({ reply, proposals, toolTrace, configured: true });
  },
);

export const GET = createApiHandler(
  { permission: "settings.read", rateLimit: "api" },
  async () => {
    const env = getEnv();
    const provider = getDefaultLlmProvider();
    return jsonOk({
      configured: provider.isConfigured(),
      model: env.AI_MODEL ?? "gpt-4o-mini",
    });
  },
);
