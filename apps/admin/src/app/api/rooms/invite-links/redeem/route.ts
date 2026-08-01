import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, roomInviteTokens } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const querySchema = z.object({
  token: z.string().min(8).max(128),
});

export const GET = createApiHandler(
  { permission: "rooms.read", querySchema, rateLimit: "api" },
  async ({ query }) => {
    const tokenHash = hashToken(query.token);
    const [row] = await getDb()
      .select()
      .from(roomInviteTokens)
      .where(eq(roomInviteTokens.tokenHash, tokenHash))
      .limit(1);
    if (!row) return jsonError(404, "not_found", "Invite not found.");
    const active =
      !row.revokedAt &&
      (!row.expiresAt || row.expiresAt.getTime() > Date.now()) &&
      row.useCount < row.maxUses;
    return jsonOk({
      roomId: row.roomId,
      label: row.label,
      active,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      useCount: row.useCount,
    });
  },
);

const redeemBody = z.object({
  token: z.string().min(8).max(128),
  userId: z.string().min(1).max(255),
});

export const POST = createApiHandler(
  { permission: "rooms.moderate", bodySchema: redeemBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const tokenHash = hashToken(body.token);
    const [row] = await db
      .select()
      .from(roomInviteTokens)
      .where(and(eq(roomInviteTokens.tokenHash, tokenHash), isNull(roomInviteTokens.revokedAt)))
      .limit(1);
    if (!row) return jsonError(404, "not_found", "Invite not found.");
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return jsonError(410, "gone", "Invite has expired.");
    }
    if (row.useCount >= row.maxUses) {
      return jsonError(410, "gone", "Invite has no remaining uses.");
    }

    await getSynapseClient().inviteUser(row.roomId, body.userId);
    await db
      .update(roomInviteTokens)
      .set({ useCount: sql`${roomInviteTokens.useCount} + 1` })
      .where(eq(roomInviteTokens.id, row.id));

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_INVITE_LINK_REDEEMED",
      target: row.roomId,
      ip,
      userAgent,
      metadata: { userId: body.userId, tokenId: row.id },
    });

    return jsonOk({ status: "ok" as const, roomId: row.roomId, userId: body.userId });
  },
);
