import { z } from "zod";
import { getDb, ipBlocks } from "@zts/database";
import { writeAuditLog, writeSecurityEvent, parseCidr, isIpInCidr } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const createBodySchema = z.object({
  cidr: z.string().min(1).max(64),
  reason: z.string().max(512).optional(),
  expiresAt: z.coerce.date().optional(),
});

export const POST = createApiHandler(
  { permission: "security.manage", bodySchema: createBodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const cidr = body.cidr.trim();
    const isV6 = cidr.includes(":");
    if (!isV6 && !parseCidr(cidr)) {
      return jsonError(400, "validation", "Invalid IPv4 address or CIDR.");
    }
    if (ip && isIpInCidr(ip, cidr)) {
      return jsonError(400, "validation", "Refusing to block your current IP.");
    }

    const db = getDb();
    const [row] = await db
      .insert(ipBlocks)
      .values({
        cidr,
        reason: body.reason ?? null,
        createdBy: auth.user.id,
        expiresAt: body.expiresAt ?? null,
      })
      .returning()
      .onConflictDoNothing();

    if (!row) {
      return jsonError(409, "conflict", "This IP/CIDR is already blocked.");
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "IP_BLOCKED",
      target: cidr,
      ip,
      userAgent,
      metadata: { reason: body.reason },
    });
    await writeSecurityEvent(db, {
      type: "IP_BLOCKED",
      severity: "warning",
      userId: auth.user.id,
      ip,
      metadata: { cidr },
    });

    return jsonOk({ block: row }, { status: 201 });
  },
);
