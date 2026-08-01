export { hashPassword, verifyPassword, checkPasswordPolicy } from "./password";
export {
  generateOpaqueToken,
  hashToken,
  hmacSign,
  safeEqual,
  deriveCsrfToken,
  verifyCsrfToken,
  signExpiringValue,
  verifyExpiringValue,
} from "./tokens";
export { encryptSecret, decryptSecret } from "./secret-encryption";
export { generateTotpSecret, verifyTotpCode, buildOtpauthUrl } from "./totp";
export {
  generateRecoveryCodes,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "./recovery-codes";
export {
  createSession,
  validateSessionToken,
  revokeSession,
  revokeAllSessions,
  listActiveSessions,
  enterSudoMode,
  isSudoActive,
  SESSION_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SUDO_TTL_MS,
  type SessionContext,
  type CreatedSession,
  type ValidSession,
} from "./sessions";
export {
  loginWithPassword,
  verifyMfaChallenge,
  reauthenticate,
  MAX_FAILED_LOGINS,
  LOCKOUT_DURATION_MS,
  type LoginResult,
  type LoginContext,
  type MfaVerifyResult,
} from "./login";
export {
  startTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  type TotpEnrollment,
  type TotpConfirmation,
} from "./mfa";
export {
  startWebAuthnRegistration,
  finishWebAuthnRegistration,
  startWebAuthnAuthentication,
  finishWebAuthnAuthentication,
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
  type WebAuthnRpConfig,
} from "./webauthn";

/** Aliases used by some call sites. */
export {
  startWebAuthnRegistration as beginWebAuthnRegistration,
  startWebAuthnAuthentication as beginWebAuthnAuthentication,
  type WebAuthnRpConfig as WebAuthnConfig,
} from "./webauthn";
