import { z } from "zod";
import { getDb, ipAllowlist } from "@zts/database";
import { writeAuditLog, parseCidr, isIpInCidr } from "@zts/security";
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
    // Must include the operator's current IP when creating the first allowlist entry —
    // checked by the client, but also refuse if allowlist would lock them out immediately.
    if (ip && !isIpInCidr(ip, cidr)) {
      const existing = await getDb().select({ id: ipAllowlist.id }).from(ipAllowlist).limit(1);
      if (existing.length === 0) {
        return jsonError(
          400,
          "validation",
          "The first allowlist entry must include your current IP so you are not locked out.",
        );
      }
    }

    const db = getDb();
    const [row] = await db
      .insert(ipAllowlist)
      .values({
        cidr,
        reason: body.reason ?? null,
        createdBy: auth.user.id,
        expiresAt: body.expiresAt ?? null,
      })
      .returning()
      .onConflictDoNothing();

    if (!row) {
      return jsonError(409, "conflict", "This IP/CIDR is already on the allowlist.");
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "IP_ALLOWLIST_ADDED",
      target: cidr,
      ip,
      userAgent,
      metadata: { reason: body.reason },
    });

    return jsonOk({ entry: row }, { status: 201 });
  },
);
