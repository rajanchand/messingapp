import { generateSecret, generateURI, verify } from "otplib";

/** Accept one 30-second step of clock drift in either direction. */
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = await verify({
      secret,
      token: code,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}

export function buildOtpauthUrl(appName: string, accountName: string, secret: string): string {
  return generateURI({ issuer: appName, label: accountName, secret });
}
