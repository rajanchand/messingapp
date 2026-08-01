"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiClientError } from "@/lib/api/client";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /**
   * Dangerous actions: require the admin to re-enter their password or passkey.
   * Unlocks sudo mode server-side before running the action; the server
   * independently enforces sudo on the target endpoint.
   */
  requireReauth?: boolean;
  onConfirm: (password?: string) => Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  requireReauth = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      if (requireReauth) {
        if (!password) {
          toast.error("Enter your password to confirm this action.");
          setBusy(false);
          return;
        }
        await api.post("/api/auth/sudo", { password });
      }
      await onConfirm(requireReauth ? password : undefined);
      onOpenChange(false);
      setPassword("");
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : "Action failed. Please try again.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePasskeyConfirm() {
    setPasskeyBusy(true);
    try {
      const begin = await api.post<{
        status: "webauthn_begin";
        options: PublicKeyCredentialRequestOptionsJSON;
        challengeToken: string;
      }>("/api/auth/sudo", { method: "webauthn_begin" });
      const assertion = await startAuthentication({ optionsJSON: begin.options });
      await api.post("/api/auth/sudo", {
        method: "webauthn",
        challengeToken: begin.challengeToken,
        response: assertion,
      });
      await onConfirm(undefined);
      onOpenChange(false);
      setPassword("");
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : "Passkey confirmation failed.";
      toast.error(message);
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !passkeyBusy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        {requireReauth ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm with your password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your admin password"
            />
          </div>
        ) : null}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy || passkeyBusy}
          >
            Cancel
          </Button>
          {requireReauth ? (
            <Button
              variant="outline"
              onClick={handlePasskeyConfirm}
              loading={passkeyBusy}
              disabled={busy}
            >
              Use passkey
            </Button>
          ) : null}
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            loading={busy}
            disabled={passkeyBusy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
