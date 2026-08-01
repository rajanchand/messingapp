"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
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
   * Dangerous actions: require the admin to re-enter their password.
   * Unlocks sudo mode server-side before running the action; the server
   * independently enforces sudo on the target endpoint. The entered
   * password is passed to onConfirm for endpoints that verify it again.
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

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
