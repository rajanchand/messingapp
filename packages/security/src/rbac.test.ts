import { describe, expect, it } from "vitest";
import type { Permission } from "@zts/database";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@zts/database";
import { PermissionError, hasPermission, requirePermission } from "./rbac";

describe("permission checks", () => {
  const perms = new Set<Permission>(["users.read", "users.create"]);

  it("hasPermission returns true only for held permissions", () => {
    expect(hasPermission(perms, "users.read")).toBe(true);
    expect(hasPermission(perms, "users.delete")).toBe(false);
  });

  it("requirePermission throws PermissionError with 403 semantics", () => {
    expect(() => requirePermission(perms, "users.read")).not.toThrow();
    try {
      requirePermission(perms, "security.manage");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).statusCode).toBe(403);
    }
  });

  it("an empty permission set is denied everything", () => {
    const empty = new Set<Permission>();
    for (const p of ALL_PERMISSIONS) {
      expect(hasPermission(empty, p)).toBe(false);
    }
  });
});

describe("system role catalog", () => {
  it("every role permission exists in the catalog", () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) {
        expect(PERMISSIONS, `${role.slug} references unknown permission ${p}`).toHaveProperty(p);
      }
    }
  });

  it("super_admin holds every permission", () => {
    const superAdmin = SYSTEM_ROLES.find((r) => r.slug === "super_admin");
    expect(superAdmin?.permissions.sort()).toEqual(ALL_PERMISSIONS.slice().sort());
  });

  it("normal users hold no admin permissions (least privilege)", () => {
    const user = SYSTEM_ROLES.find((r) => r.slug === "user");
    expect(user?.permissions).toEqual([]);
  });

  it("auditor is read-only", () => {
    const auditor = SYSTEM_ROLES.find((r) => r.slug === "auditor");
    expect(auditor).toBeDefined();
    for (const p of auditor!.permissions) {
      expect(p.endsWith(".read")).toBe(true);
    }
  });
});
