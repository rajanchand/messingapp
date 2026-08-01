"use client";

import { useQuery } from "@tanstack/react-query";
import { api, setCsrfToken } from "@/lib/api/client";

export interface Me {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    email: string | null;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
  };
  roles: { id: string; slug: string; name: string }[];
  permissions: string[];
  /** True when RBAC requires MFA and the user has not enrolled yet. */
  requiresMfaEnrollment?: boolean;
  csrfToken: string;
  sudoActive: boolean;
  sessionCreatedAt: string;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api.get<Me>("/api/auth/me");
      setCsrfToken(me.csrfToken);
      return me;
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function usePermissions(): Set<string> {
  const { data } = useMe();
  return new Set(data?.permissions ?? []);
}
