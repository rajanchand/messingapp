import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import type { Database } from "@zts/database";
import { adminUsers, webauthnCredentials } from "@zts/database";

export interface WebAuthnRpConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

function parseTransports(value: unknown): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((t): t is AuthenticatorTransportFuture => typeof t === "string");
}

export async function startWebAuthnRegistration(
  db: Database,
  userId: string,
  rp: WebAuthnRpConfig,
) {
  const user = (await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1))[0];
  if (!user) throw new Error("User not found");

  const existing = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.username,
    userDisplayName: user.displayName ?? user.username,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  return options;
}

export async function finishWebAuthnRegistration(
  db: Database,
  userId: string,
  rp: WebAuthnRpConfig,
  expectedChallenge: string,
  response: unknown,
  nickname?: string,
): Promise<VerifiedRegistrationResponse> {
  const verification = await verifyRegistrationResponse({
    response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("WebAuthn registration verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  await db.insert(webauthnCredentials).values({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? null,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    nickname: nickname ?? null,
  });

  return verification;
}

export async function startWebAuthnAuthentication(
  db: Database,
  userId: string | null,
  rp: WebAuthnRpConfig,
) {
  const existing = userId
    ? await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId))
    : [];

  return generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "preferred",
    allowCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
  });
}

export async function finishWebAuthnAuthentication(
  db: Database,
  rp: WebAuthnRpConfig,
  expectedChallenge: string,
  response: { id: string; rawId: string; response: unknown; type: string; clientExtensionResults?: unknown },
): Promise<{ verification: VerifiedAuthenticationResponse; userId: string }> {
  const cred = (
    await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, response.id))
      .limit(1)
  )[0];
  if (!cred) throw new Error("Unknown credential");

  const verification = await verifyAuthenticationResponse({
    response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: cred.credentialId,
      publicKey: Buffer.from(cred.publicKey, "base64url"),
      counter: cred.counter,
      transports: parseTransports(cred.transports),
    },
  });

  if (!verification.verified) {
    throw new Error("WebAuthn authentication verification failed");
  }

  await db
    .update(webauthnCredentials)
    .set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(webauthnCredentials.id, cred.id));

  return { verification, userId: cred.userId };
}

export async function listWebAuthnCredentials(db: Database, userId: string) {
  return db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
}

export async function deleteWebAuthnCredential(db: Database, userId: string, credentialId: string) {
  await db
    .delete(webauthnCredentials)
    .where(
      and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.credentialId, credentialId)),
    );
}
