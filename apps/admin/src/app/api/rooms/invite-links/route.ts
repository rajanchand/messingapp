import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, roomInviteTokens } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const listQuery = z.object({
  roomId: z.string().min(1).max(255),
});

export const GET = createApiHandler(
  { permission: "rooms.read", querySchema: listQuery, rateLimit: "api" },
  async ({ query }) => {
    const rows = await getDb()
      .select()
      .from(roomInviteTokens)
      .where(eq(roomInviteTokens.roomId, query.roomId))
      .orderBy(desc(roomInviteTokens.createdAt))
      .limit(50);
    return jsonOk({
      tokens: rows.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        label: r.label,
        maxUses: r.maxUses,
        useCount: r.useCount,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        active: !r.revokedAt && (!r.expiresAt || r.expiresAt.getTime() > Date.now()) && r.useCount < r.maxUses,
      })),
    });
  },
);

const createBody = z.object({
  roomId: z.string().min(1).max(255),
  label: z.string().max(128).optional(),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  expiresInHours: z.number().int().min(1).max(24 * 90).default(72),
});

export const POST = createApiHandler(
  { permission: "rooms.moderate", bodySchema: createBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const raw = randomBytes(24).toString("base64url");
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + body.expiresInHours * 3_600_000);

    const [row] = await getDb()
      .insert(roomInviteTokens)
      .values({
        roomId: body.roomId,
        tokenHash,
        label: body.label ?? null,
        maxUses: body.maxUses,
        createdBy: auth.user.id,
        expiresAt,
      })
      .returning();

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_INVITE_LINK_CREATED",
      target: body.roomId,
      ip,
      userAgent,
      metadata: { tokenId: row?.id, maxUses: body.maxUses },
    });

    const domain = getEnv().ADMIN_DOMAIN;
    const protocol = domain.includes("localhost") ? "http" : "https";
    const inviteUrl = `${protocol}://${domain}/invite/${raw}`;

    return jsonOk(
      {
        token: {
          id: row!.id,
          roomId: row!.roomId,
          label: row!.label,
          maxUses: row!.maxUses,
          expiresAt: row!.expiresAt,
          /** Raw token shown once — not stored in plaintext. */
          rawToken: raw,
          inviteUrl,
        },
      },
      { status: 201 },
    );
  },
);

const revokeBody = z.object({
  id: z.string().uuid(),
});

export const PATCH = createApiHandler(
  { permission: "rooms.moderate", bodySchema: revokeBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const [row] = await db
      .select()
      .from(roomInviteTokens)
      .where(and(eq(roomInviteTokens.id, body.id), isNull(roomInviteTokens.revokedAt)))
      .limit(1);
    if (!row) return jsonError(404, "not_found", "Invite token not found.");

    await db
      .update(roomInviteTokens)
      .set({ revokedAt: new Date() })
      .where(eq(roomInviteTokens.id, body.id));

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_INVITE_LINK_REVOKED",
      target: row.roomId,
      ip,
      userAgent,
      metadata: { tokenId: body.id },
    });

    return jsonOk({ status: "ok" as const });
  },
);
