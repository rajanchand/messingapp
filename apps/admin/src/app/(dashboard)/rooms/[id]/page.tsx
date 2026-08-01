"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Ban, Lock, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RoomDetail {
  room: {
    room_id: string;
    name: string | null;
    canonical_alias: string | null;
    topic: string | null;
    joined_members: number;
    encryption: string | null;
    join_rules: string | null;
    creator: string | null;
    public: boolean;
  };
  members: {
    user_id: string;
    display_name: string | null;
    membership: string;
  }[];
  memberTotal: number;
}

export default function RoomDetailPage() {
  const params = useParams<{ id: string }>();
  const roomId = decodeURIComponent(params.id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [modTarget, setModTarget] = useState<{
    userId: string;
    action: "kick" | "ban" | "unban";
  } | null>(null);

  const detail = useQuery({
    queryKey: ["room", roomId],
    queryFn: () => api.get<RoomDetail>(`/api/rooms/${encodeURIComponent(roomId)}`),
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/rooms/${encodeURIComponent(roomId)}/invite`, { userId: inviteUserId }),
    onSuccess: () => {
      toast.success("Invite sent.");
      setInviteOpen(false);
      setInviteUserId("");
      queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Invite failed."),
  });

  async function moderate(userId: string, action: "kick" | "ban" | "unban") {
    await api.post(`/api/rooms/${encodeURIComponent(roomId)}/${action}`, { userId });
    toast.success(`User ${action === "unban" ? "unbanned" : action + "ed"}.`);
    queryClient.invalidateQueries({ queryKey: ["room", roomId] });
  }

  async function deleteRoom() {
    await api.delete(`/api/rooms/${encodeURIComponent(roomId)}`);
    toast.success("Room deleted.");
    router.push("/rooms");
  }

  const room = detail.data?.room;
  const canModerate = permissions.has("rooms.moderate");
  const canInvite = permissions.has("rooms.update");
  const canDelete = permissions.has("rooms.delete");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/rooms"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Rooms
          </Link>
          {detail.isLoading ? (
            <Skeleton className="h-8 w-64" />
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">
              {room?.name || roomId}
            </h1>
          )}
          <p className="font-mono text-xs text-muted-foreground">{roomId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canInvite ? (
            <Button variant="outline" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" />
              Invite
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete room
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Members</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">
            {room?.joined_members ?? "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Join rule</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{room?.join_rules ?? "—"}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Encryption</CardTitle>
          </CardHeader>
          <CardContent>
            {room?.encryption ? (
              <Badge variant="success" className="gap-1">
                <Lock className="size-3" />
                E2EE
              </Badge>
            ) : (
              <Badge variant="outline">Off</Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {room?.topic ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Topic</CardTitle>
            <CardDescription>{room.topic}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            Membership management only — messaging remains in Element X.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={3}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : (detail.data?.members ?? []).map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell>
                        <div className="font-medium">{m.display_name || m.user_id}</div>
                        <div className="text-xs text-muted-foreground">{m.user_id}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{m.membership}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canModerate ? (
                          <div className="flex justify-end gap-1">
                            {m.membership === "join" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setModTarget({ userId: m.user_id, action: "kick" })
                                  }
                                >
                                  <UserMinus className="size-3.5" />
                                  Kick
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setModTarget({ userId: m.user_id, action: "ban" })
                                  }
                                >
                                  <Ban className="size-3.5" />
                                  Ban
                                </Button>
                              </>
                            ) : null}
                            {m.membership === "ban" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setModTarget({ userId: m.user_id, action: "unban" })
                                }
                              >
                                Unban
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="inviteUserId">Matrix user ID</Label>
            <Input
              id="inviteUserId"
              placeholder="@alice:example.org"
              value={inviteUserId}
              onChange={(e) => setInviteUserId(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!inviteUserId || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete room?"
        description="This permanently removes the room from Synapse. Requires recent re-authentication (sudo)."
        confirmLabel="Delete"
        destructive
        onConfirm={deleteRoom}
      />

      <ConfirmDialog
        open={!!modTarget}
        onOpenChange={(open) => !open && setModTarget(null)}
        title={`${modTarget?.action === "unban" ? "Unban" : modTarget?.action === "ban" ? "Ban" : "Kick"} user?`}
        description={`${modTarget?.userId ?? ""} — moderation requires sudo mode.`}
        confirmLabel={modTarget?.action ?? "Confirm"}
        destructive={modTarget?.action !== "unban"}
        onConfirm={async () => {
          if (!modTarget) return;
          await moderate(modTarget.userId, modTarget.action);
          setModTarget(null);
        }}
      />
    </div>
  );
}
