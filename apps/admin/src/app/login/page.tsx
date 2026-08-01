"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { KeyRound, ShieldCheck } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const credentialsSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
type Credentials = z.infer<typeof credentialsSchema>;

const mfaSchema = z.object({
  code: z
    .string()
    .min(6, "Enter the 6-digit authenticator code or a recovery code")
    .max(32),
});
type MfaInput = z.infer<typeof mfaSchema>;

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Zero Trust Security";

function SsoComingSoonButton() {
  const oidc = useQuery({
    queryKey: ["oidc-status"],
    queryFn: () =>
      api.get<{ label: string; enabled: boolean; hint: string; status: string }>(
        "/api/auth/oidc",
      ),
    retry: false,
  });

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={!oidc.data?.enabled}
        onClick={async () => {
          try {
            await api.post("/api/auth/oidc");
          } catch (err) {
            toast.message(oidc.data?.label ?? "Single sign-on (coming soon)", {
              description:
                err instanceof ApiClientError
                  ? err.message
                  : (oidc.data?.hint ?? "See docs/MAS-OIDC.md"),
            });
          }
        }}
      >
        {oidc.data?.label ?? "Single sign-on (coming soon)"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {oidc.data?.enabled
          ? "OIDC configured — full login flow pending."
          : "Admin SSO is deferred. Local password + MFA is the break-glass path."}
      </p>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const credForm = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });
  const mfaForm = useForm<MfaInput>({ resolver: zodResolver(mfaSchema) });

  function completeLogin(enrollmentRequired = false) {
    router.replace(enrollmentRequired ? "/settings?mfa=required" : "/");
    router.refresh();
  }

  async function onCredentials(values: Credentials) {
    try {
      const result = await api.post<{
        status: "ok" | "mfa_required" | "mfa_enrollment_required";
      }>("/api/auth/login", values);
      if (result.status === "mfa_required") {
        setStep("mfa");
      } else if (result.status === "mfa_enrollment_required") {
        toast.warning("Multi-factor authentication is required. Enroll TOTP or a passkey.");
        completeLogin(true);
      } else {
        completeLogin();
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "locked") {
        toast.error(err.message);
      } else if (err instanceof ApiClientError && err.code === "rate_limited") {
        toast.error("Too many attempts. Please wait a few minutes.");
      } else {
        toast.error("Invalid username or password.");
      }
    }
  }

  async function onMfa(values: MfaInput) {
    try {
      const result = await api.post<{ status: "ok"; usedRecoveryCode: boolean }>(
        "/api/auth/mfa",
        { code: values.code.trim() },
      );
      if (result.usedRecoveryCode) {
        toast.warning("You used a recovery code. Consider regenerating your recovery codes.");
      }
      completeLogin();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "mfa_expired") {
        toast.error("Session expired. Please log in again.");
        setStep("credentials");
        mfaForm.reset();
      } else if (err instanceof ApiClientError && err.code === "locked") {
        toast.error(err.message);
        setStep("credentials");
        mfaForm.reset();
      } else if (err instanceof ApiClientError && err.code === "rate_limited") {
        toast.error("Too many MFA attempts. Please wait a few minutes.");
      } else {
        toast.error("Invalid authenticator code. Check your app and try again.");
        mfaForm.setValue("code", "");
      }
    }
  }

  async function onPasskeyLogin(asSecondFactor: boolean) {
    setPasskeyBusy(true);
    try {
      const begin = await api.post<{
        options: PublicKeyCredentialRequestOptionsJSON;
        challengeToken: string;
      }>("/api/auth/webauthn/login", {
        action: "begin",
        username: asSecondFactor ? undefined : credForm.getValues("username") || undefined,
      });
      const assertion = await startAuthentication({ optionsJSON: begin.options });
      await api.post("/api/auth/webauthn/login", {
        action: "finish",
        challengeToken: begin.challengeToken,
        response: assertion,
        asSecondFactor,
      });
      completeLogin();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error(err.message);
      } else {
        toast.error("Passkey authentication failed or was cancelled.");
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Image src="/branding/logo.svg" alt="" width={56} height={56} priority />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">Administration console</p>
          </div>
        </div>

        {step === "credentials" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sign in</CardTitle>
              <CardDescription>Use your administrator account or a passkey.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="space-y-4"
                method="post"
                onSubmit={credForm.handleSubmit(onCredentials)}
                noValidate
              >
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    autoFocus
                    {...credForm.register("username")}
                  />
                  {credForm.formState.errors.username ? (
                    <p className="text-sm text-destructive">
                      {credForm.formState.errors.username.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    {...credForm.register("password")}
                  />
                  {credForm.formState.errors.password ? (
                    <p className="text-sm text-destructive">
                      {credForm.formState.errors.password.message}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  loading={credForm.formState.isSubmitting}
                >
                  Sign in
                </Button>
              </form>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                loading={passkeyBusy}
                onClick={() => onPasskeyLogin(false)}
              >
                <KeyRound className="size-4" />
                Sign in with passkey
              </Button>
              <SsoComingSoonButton />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-primary" />
                Authenticator app
              </CardTitle>
              <CardDescription>
                Open Google Authenticator, Authy, 1Password, or a similar app and enter the
                6-digit code for this account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="space-y-4"
                method="post"
                onSubmit={mfaForm.handleSubmit(onMfa)}
                noValidate
              >
                <div className="space-y-2">
                  <Label htmlFor="code">6-digit code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="123456"
                    maxLength={32}
                    {...mfaForm.register("code")}
                  />
                  {mfaForm.formState.errors.code ? (
                    <p className="text-sm text-destructive">
                      {mfaForm.formState.errors.code.message}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Lost your authenticator? Enter a one-time recovery code instead.
                  </p>
                </div>
                <Button type="submit" className="w-full" loading={mfaForm.formState.isSubmitting}>
                  Verify and sign in
                </Button>
              </form>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                loading={passkeyBusy}
                onClick={() => onPasskeyLogin(true)}
              >
                <KeyRound className="size-4" />
                Use passkey instead
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep("credentials");
                  mfaForm.reset();
                }}
              >
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
