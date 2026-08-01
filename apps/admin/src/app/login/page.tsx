"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
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
  code: z.string().min(6, "Enter your 6-digit code or a recovery code"),
});
type MfaInput = z.infer<typeof mfaSchema>;

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Zero Trust Security";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");

  const credForm = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });
  const mfaForm = useForm<MfaInput>({ resolver: zodResolver(mfaSchema) });

  function completeLogin() {
    router.replace("/");
    router.refresh();
  }

  async function onCredentials(values: Credentials) {
    try {
      const result = await api.post<{ status: "ok" | "mfa_required" }>("/api/auth/login", values);
      if (result.status === "mfa_required") {
        setStep("mfa");
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
        values,
      );
      if (result.usedRecoveryCode) {
        toast.warning("You used a recovery code. Consider regenerating your recovery codes.");
      }
      completeLogin();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "mfa_expired") {
        toast.error("Session expired. Please log in again.");
        setStep("credentials");
      } else {
        toast.error("Invalid authentication code.");
        mfaForm.reset();
      }
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
              <CardDescription>Use your administrator account.</CardDescription>
            </CardHeader>
            <CardContent>
              {/* method="post" so a pre-hydration native submit never puts
                  credentials in the URL/query string. */}
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
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-primary" />
                Two-factor authentication
              </CardTitle>
              <CardDescription>
                Enter the 6-digit code from your authenticator app, or a recovery code.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                method="post"
                onSubmit={mfaForm.handleSubmit(onMfa)}
                noValidate
              >
                <div className="space-y-2">
                  <Label htmlFor="code">Authentication code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="123456"
                    {...mfaForm.register("code")}
                  />
                  {mfaForm.formState.errors.code ? (
                    <p className="text-sm text-destructive">
                      {mfaForm.formState.errors.code.message}
                    </p>
                  ) : null}
                </div>
                <Button type="submit" className="w-full" loading={mfaForm.formState.isSubmitting}>
                  Verify
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep("credentials")}
                >
                  Back to sign in
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
