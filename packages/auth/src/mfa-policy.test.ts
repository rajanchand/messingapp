import { describe, expect, it } from "vitest";
import type { Permission } from "@zts/database";
import { MFA_REQUIRED_PERMISSIONS, permissionsRequireMfa } from "./mfa-policy";
import { applyMandatoryMfaPolicy, type LoginResult } from "./login";

type AdminUser = Extract<LoginResult, { status: "success" }>["user"];

function fakeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    username: "admin",
    email: null,
    displayName: null,
    passwordHash: "x",
    isActive: true,
    mfaEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("permissionsRequireMfa", () => {
  it("returns false for empty / read-only permission sets", () => {
    expect(permissionsRequireMfa([])).toBe(false);
    expect(permissionsRequireMfa(["users.read" as Permission])).toBe(false);
  });

  it("returns true when any privileged permission is present", () => {
    expect(permissionsRequireMfa(["users.create" as Permission])).toBe(true);
    expect(
      permissionsRequireMfa(["audit.read", "security.manage"] as Permission[]),
    ).toBe(true);
  });

  it("lists expected privileged permissions", () => {
    expect(MFA_REQUIRED_PERMISSIONS).toContain("roles.manage");
    expect(MFA_REQUIRED_PERMISSIONS).toContain("settings.manage");
  });
});

describe("applyMandatoryMfaPolicy", () => {
  it("upgrades success to enrollment when MFA is required and not enrolled", () => {
    const result = applyMandatoryMfaPolicy(
      { status: "success", user: fakeUser({ mfaEnabled: false }) },
      true,
    );
    expect(result.status).toBe("mfa_enrollment_required");
  });

  it("leaves success alone when MFA is not required", () => {
    const result = applyMandatoryMfaPolicy(
      { status: "success", user: fakeUser({ mfaEnabled: false }) },
      false,
    );
    expect(result.status).toBe("success");
  });

  it("does not alter mfa_required results", () => {
    const result = applyMandatoryMfaPolicy(
      { status: "mfa_required", user: fakeUser({ mfaEnabled: true }) },
      true,
    );
    expect(result.status).toBe("mfa_required");
  });
});
