"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Copy, Fingerprint, KeyRound, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { api, ApiClientError } from "@/lib/api/client";
import { useMe } from "@/lib/hooks/use-me";
import { formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: z.string().min(12, "At least 12 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
type PasswordInput = z.infer<typeof passwordSchema>;

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useMe();

  const [mfaDialogOpen, setMfaDialogOpen] = useState(false);
  const [mfaFromQuery, setMfaFromQuery] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("mfa") === "required";
  });
  const [mfaStep, setMfaStep] = useState<"password" | "verify" | "recovery">("password");
  const [mfaPassword, setMfaPassword] = useState("");
  const [enrollment, setEnrollment] = useState<{ otpauthUrl: string; secret: string } | null>(
    null,
  );
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableMfaOpen, setDisableMfaOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);

  const showMfaDialog =
    mfaDialogOpen || (mfaFromQuery && !!me && !me.user.mfaEnabled);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<{ sessions: SessionRow[] }>("/api/auth/sessions"),
  });

  const passwordForm = useForm<PasswordInput>({ resolver: zodResolver(passwordSchema) });

  const changePassword = useMutation({
    mutationFn: (input: PasswordInput) =>
      api.post("/api/auth/change-password", {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      }),
    onSuccess: () => {
      toast.success("Password changed. Other sessions were signed out.");
      passwordForm.reset();
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Password change failed."),
  });

  async function startMfaEnrollment() {
    try {
      await api.post("/api/auth/sudo", { password: mfaPassword });
      const result = await api.post<{ otpauthUrl: string; secret: string }>("/api/auth/mfa/setup");
      setEnrollment(result);
      setMfaStep("verify");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not start enrollment.");
    }
  }

  async function confirmMfa() {
    try {
      const result = await api.post<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", {
        code: mfaCode.trim(),
      });
      setRecoveryCodes(result.recoveryCodes);
      setMfaStep("recovery");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Invalid code.");
    }
  }

  async function revokeSession(id: string) {
    try {
      await api.delete(`/api/auth/sessions/${id}`);
      toast.success("Session revoked.");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to revoke session.");
    }
  }

  function closeMfaDialog() {
    setMfaDialogOpen(false);
    setMfaFromQuery(false);
    setMfaStep("password");
    setMfaPassword("");
    setMfaCode("");
    setEnrollment(null);
    setRecoveryCodes([]);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account security, sessions, and MFA.{" "}
          <Link href="/settings/homeserver-policy" className="text-primary hover:underline">
            Homeserver policy
          </Link>
        </p>
        <p className="text-sm text-muted-foreground">Your account and security preferences.</p>
      </div>

      {!isLoading && me && !me.user.mfaEnabled ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <ShieldCheck className="size-4" />
              Multi-factor authentication required
            </CardTitle>
            <CardDescription>
              Privileged admin roles must enroll TOTP or a passkey before using the rest of the
              console. Use the sections below to enroll now.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Username</span>
                <span className="font-medium">{me?.user.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Roles</span>
                <span className="flex gap-1">
                  {me?.roles.length ? (
                    me.roles.map((r) => (
                      <Badge key={r.slug} variant="secondary">
                        {r.name}
                      </Badge>
                    ))
                  ) : (
                    <span>—</span>
                  )}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> Change password
          </CardTitle>
          <CardDescription>
            Changing your password signs you out of all other sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={passwordForm.handleSubmit((v) => changePassword.mutate(v))}
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                {...passwordForm.register("currentPassword")}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register("newPassword")}
                />
                {passwordForm.formState.errors.newPassword ? (
                  <p className="text-sm text-destructive">
                    {passwordForm.formState.errors.newPassword.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register("confirmPassword")}
                />
                {passwordForm.formState.errors.confirmPassword ? (
                  <p className="text-sm text-destructive">
                    {passwordForm.formState.errors.confirmPassword.message}
                  </p>
                ) : null}
              </div>
            </div>
            <Button type="submit" loading={changePassword.isPending}>
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" /> Authenticator app (TOTP)
          </CardTitle>
          <CardDescription>
            Primary second factor: Google Authenticator, Authy, 1Password, and similar apps.
            Passkeys below are optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : me?.user.mfaEnabled ? (
            <div className="flex items-center justify-between">
              <Badge variant="success">Enabled</Badge>
              <Button variant="outline" size="sm" onClick={() => setDisableMfaOpen(true)}>
                <ShieldOff /> Disable
              </Button>
            </div>
          ) : (
            <Button onClick={() => setMfaDialogOpen(true)}>
              <ShieldCheck /> Set up authenticator app
            </Button>
          )}
        </CardContent>
      </Card>

      <PasskeysCard />
      <NotificationPrefsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your admin account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead className="hidden md:table-cell">IP</TableHead>
                <TableHead className="hidden md:table-cell">Last active</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : (
                sessions.data?.sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="max-w-64 truncate text-sm">
                        {s.userAgent ?? "Unknown device"}
                      </div>
                      {s.current ? <Badge variant="secondary">This session</Badge> : null}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {s.ip ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {formatRelative(s.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      {!s.current ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => revokeSession(s.id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="p-4 pt-0">
            <Button variant="outline" size="sm" onClick={() => setLogoutAllOpen(true)}>
              <LogOut /> Sign out everywhere
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showMfaDialog} onOpenChange={(o) => !o && closeMfaDialog()}>
        <DialogContent>
          {mfaStep === "password" ? (
            <>
              <DialogHeader>
                <DialogTitle>Enable two-factor authentication</DialogTitle>
                <DialogDescription>Confirm your password to begin.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="mfa-password">Password</Label>
                <Input
                  id="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeMfaDialog}>
                  Cancel
                </Button>
                <Button onClick={startMfaEnrollment} disabled={!mfaPassword}>
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : mfaStep === "verify" ? (
            <>
              <DialogHeader>
                <DialogTitle>Add to your authenticator app</DialogTitle>
                <DialogDescription>
                  Scan or enter the secret in Google Authenticator, Authy, or another TOTP app,
                  then enter the 6-digit code it shows.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Secret key</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">
                      {enrollment?.secret}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Copy secret"
                      onClick={() => {
                        if (enrollment) {
                          navigator.clipboard.writeText(enrollment.secret);
                          toast.success("Secret copied.");
                        }
                      }}
                    >
                      <Copy />
                    </Button>
                  </div>
                </div>
                {enrollment ? (
                  <a
                    href={enrollment.otpauthUrl}
                    className="text-sm text-primary underline underline-offset-4"
                  >
                    Open in authenticator app
                  </a>
                ) : null}
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="mfa-code">6-digit code</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    placeholder="123456"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeMfaDialog}>
                  Cancel
                </Button>
                <Button onClick={confirmMfa} disabled={mfaCode.length !== 6}>
                  Verify and enable
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Save your recovery codes</DialogTitle>
                <DialogDescription>
                  Each code can be used once if you lose access to your authenticator.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code) => (
                  <code key={code} className="rounded-md bg-muted px-3 py-1.5 text-center text-xs">
                    {code}
                  </code>
                ))}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(recoveryCodes.join("\n"));
                    toast.success("Recovery codes copied.");
                  }}
                >
                  <Copy /> Copy all
                </Button>
                <Button onClick={closeMfaDialog}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={disableMfaOpen}
        onOpenChange={setDisableMfaOpen}
        title="Disable two-factor authentication?"
        description="Your account will be protected by your password only. Recovery codes will be deleted."
        confirmLabel="Disable 2FA"
        destructive
        requireReauth
        onConfirm={async (password) => {
          await api.post("/api/auth/mfa/disable", { password });
          toast.success("Two-factor authentication disabled.");
          queryClient.invalidateQueries({ queryKey: ["me"] });
        }}
      />

      <ConfirmDialog
        open={logoutAllOpen}
        onOpenChange={setLogoutAllOpen}
        title="Sign out everywhere?"
        description="All of your sessions, including this one, will be revoked."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={async () => {
          await api.post("/api/auth/logout-all");
          window.location.href = "/login";
        }}
      />
    </div>
  );
}

function PasskeysCard() {
  const queryClient = useQueryClient();
  const credentials = useQuery({
    queryKey: ["webauthn"],
    queryFn: () =>
      api.get<{
        credentials: {
          id: string;
          nickname: string | null;
          deviceType: string | null;
          createdAt: string;
          lastUsedAt: string | null;
        }[];
      }>("/api/auth/webauthn"),
  });

  async function enroll() {
    try {
      const { options, challengeToken } = await api.post<{
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
        challengeToken: string;
      }>("/api/auth/webauthn", { action: "begin" });
      const attestation = await startRegistration({ optionsJSON: options });
      await api.post("/api/auth/webauthn", {
        action: "finish",
        response: attestation,
        challengeToken,
        nickname: "Passkey",
      });
      toast.success("Passkey registered.");
      queryClient.invalidateQueries({ queryKey: ["webauthn"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Passkey enrollment failed.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="size-4" /> Passkeys (WebAuthn)
        </CardTitle>
        <CardDescription>
          Hardware keys and platform authenticators. Only public keys are stored server-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={enroll}>Add passkey</Button>
        {(credentials.data?.credentials.length ?? 0) > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.data?.credentials.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.nickname || c.deviceType || "Passkey"}</TableCell>
                  <TableCell>{formatRelative(c.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await api.post("/api/auth/webauthn", {
                          action: "delete",
                          credentialId: c.id,
                        });
                        toast.success("Passkey removed.");
                        queryClient.invalidateQueries({ queryKey: ["webauthn"] });
                      }}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NotificationPrefsCard() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () =>
      api.get<{
        preferences: {
          securityAlerts: boolean;
          workflowFailures: boolean;
          userCreation: boolean;
          serverHealth: boolean;
          integrationErrors: boolean;
          channelInApp: boolean;
          channelEmail: boolean;
          channelMatrix: boolean;
          channelSlack: boolean;
        };
      }>("/api/notifications/preferences"),
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, boolean>) =>
      api.put("/api/notifications/preferences", patch),
    onSuccess: () => {
      toast.success("Notification preferences saved.");
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Failed to save preferences."),
  });

  const p = prefs.data?.preferences;
  if (!p) return <Skeleton className="h-40 w-full" />;

  const toggles: { key: keyof typeof p; label: string }[] = [
    { key: "securityAlerts", label: "Security alerts" },
    { key: "workflowFailures", label: "Workflow failures" },
    { key: "userCreation", label: "User creation" },
    { key: "serverHealth", label: "Server health" },
    { key: "integrationErrors", label: "Integration errors" },
    { key: "channelEmail", label: "Email channel" },
    { key: "channelMatrix", label: "Matrix channel (bot)" },
    { key: "channelSlack", label: "Slack channel" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notification preferences</CardTitle>
        <CardDescription>
          In-app notifications appear in the header bell. External channels use configured
          integrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {toggles.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-4">
            <Label htmlFor={t.key}>{t.label}</Label>
            <Switch
              id={t.key}
              checked={p[t.key]}
              onCheckedChange={(checked) => save.mutate({ [t.key]: checked })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
