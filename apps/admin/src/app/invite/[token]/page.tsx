"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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

/**
 * Operator redeem surface for room invite tokens. Tokens are hashed at rest;
 * this page looks up by raw token segment and invites a Matrix user into the room.
 */
export default function InviteRedeemPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [userId, setUserId] = useState("");

  const meta = useQuery({
    queryKey: ["invite-meta", token],
    queryFn: () =>
      api.get<{
        roomId: string;
        label: string | null;
        active: boolean;
        expiresAt: string | null;
      }>(`/api/rooms/invite-links/redeem?token=${encodeURIComponent(token)}`),
    retry: false,
  });

  const redeem = useMutation({
    mutationFn: () =>
      api.post("/api/rooms/invite-links/redeem", { token, userId }),
    onSuccess: () => toast.success(`Invited ${userId} to the room.`),
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Redeem failed."),
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Room invite</CardTitle>
          <CardDescription>
            {meta.isError
              ? "Invalid or expired invite link."
              : meta.data
                ? `${meta.data.label ?? "Invite"} → ${meta.data.roomId}`
                : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {meta.data?.active ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="mxid">Matrix user ID to invite</Label>
                <Input
                  id="mxid"
                  placeholder="@user:server"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                disabled={!userId || redeem.isPending}
                loading={redeem.isPending}
                onClick={() => redeem.mutate()}
              >
                Redeem invite
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
