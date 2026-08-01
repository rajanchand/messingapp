"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Pencil,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { formatDate, formatRelative } from "@/lib/utils";
import type { MatrixDevice, RoleInfo, UserDetailResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = decodeURIComponent(params.id);
  const encodedId = encodeURIComponent(userId);
  const queryClient = useQueryClient();
  const permissions = usePermissions();

  const [renameOpen, setRenameOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [eraseOnDeactivate, setEraseOnDeactivate] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reactivatePassword, setReactivatePassword] = useState("");
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [shadowBanOpen, setShadowBanOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeBody, setNoticeBody] = useState("");
  const [rolesOpen, setRolesOpen] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const detail = useQuery({
    queryKey: ["user", userId],
    queryFn: () => api.get<UserDetailResponse>(`/api/users/${encodedId}`),
  });

  const devices = useQuery({
    queryKey: ["user", userId, "devices"],
    queryFn: () =>
      api.get<{ devices: MatrixDevice[]; total: number }>(`/api/users/${encodedId}/devices`),
  });

  const allRoles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<{ roles: RoleInfo[] }>("/api/roles"),
    enabled: permissions.has("roles.read"),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["user", userId] });
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  const renameMutation = useMutation({
    mutationFn: () => api.patch(`/api/users/${encodedId}`, { displayName }),
    onSuccess: () => {
      toast.success("Display name updated.");
      setRenameOpen(false);
      refresh();
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Update failed."),
  });

  const rolesMutation = useMutation({
    mutationFn: () => api.put(`/api/users/${encodedId}/roles`, { roles: selectedRoles }),
    onSuccess: () => {
      toast.success("Roles updated.");
      setRolesOpen(false);
      refresh();
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Role update failed."),
  });

  async function removeDevice(deviceId: string) {
    try {
      await api.delete(`/api/users/${encodedId}/devices/${encodeURIComponent(deviceId)}`);
      toast.success("Device removed.");
      queryClient.invalidateQueries({ queryKey: ["user", userId, "devices"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to remove device.");
    }
  }

  const user = detail.data?.user;
  const canUpdate = permissions.has("users.update");
  const canDisable = permissions.has("users.disable");
  const canManageRoles = permissions.has("roles.manage");

  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (detail.isError || !user) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/users">
            <ArrowLeft /> Back to users
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            User not found or the homeserver is unreachable.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/users">
              <ArrowLeft /> Back to users
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {user.displayname || userId}
          </h1>
          <p className="text-sm text-muted-foreground">{userId}</p>
          <div className="flex flex-wrap gap-1 pt-1">
            {user.deactivated ? (
              <Badge variant="destructive">Deactivated</Badge>
            ) : (
              <Badge variant="success">Active</Badge>
            )}
            {user.admin ? (
              <Badge variant="secondary">
                <ShieldCheck className="mr-1 size-3" /> Server admin
              </Badge>
            ) : null}
            {user.shadow_banned ? <Badge variant="destructive">Shadow-banned</Badge> : null}
            {detail.data?.roles.map((r) => (
              <Badge key={r.slug} variant="outline">
                {r.name}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDisplayName(user.displayname ?? "");
                setRenameOpen(true);
              }}
            >
              <Pencil /> Rename
            </Button>
          ) : null}
          {canUpdate && !user.deactivated ? (
            <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
              <KeyRound /> Reset password
            </Button>
          ) : null}
          {canDisable && !user.deactivated ? (
            <Button variant="outline" size="sm" onClick={() => setLogoutAllOpen(true)}>
              <LogOut /> Logout all devices
            </Button>
          ) : null}
          {canDisable && !user.deactivated ? (
            <Button variant="outline" size="sm" onClick={() => setShadowBanOpen(true)}>
              {user.shadow_banned ? "Clear shadow-ban" : "Shadow-ban"}
            </Button>
          ) : null}
          {canUpdate && !user.deactivated ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNoticeBody("");
                setNoticeOpen(true);
              }}
            >
              Server notice
            </Button>
          ) : null}
          {canManageRoles ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedRoles(detail.data?.roles.map((r) => r.slug) ?? []);
                setRolesOpen(true);
              }}
            >
              <ShieldCheck /> Roles
            </Button>
          ) : null}
          {canDisable && !user.deactivated ? (
            <Button variant="destructive" size="sm" onClick={() => setDeactivateOpen(true)}>
              <UserX /> Deactivate
            </Button>
          ) : null}
          {canDisable && user.deactivated ? (
            <Button size="sm" onClick={() => setReactivateOpen(true)}>
              <UserCheck /> Reactivate
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Created</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{formatDate(user.creation_ts)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Devices</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm">
            <MonitorSmartphone className="size-4 text-muted-foreground" />
            {detail.data?.deviceCount ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rooms</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{detail.data?.roomCount ?? 0} joined</CardContent>
        </Card>
      </div>

      {detail.data?.profile ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{detail.data.profile.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Phone</p>
              <p className="font-medium">{detail.data.profile.phone ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Employee ID</p>
              <p className="font-medium">{detail.data.profile.employeeId ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Role</p>
              <p className="font-medium">{detail.data.profile.primaryRoleSlug ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Department</p>
              <p className="font-medium">{detail.data.profile.department ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Sub-department</p>
              <p className="font-medium">{detail.data.profile.subdepartment ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
        </TabsList>

        <TabsContent value="devices">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead className="hidden md:table-cell">Last IP</TableHead>
                    <TableHead className="hidden md:table-cell">Last seen</TableHead>
                    {canDisable ? <TableHead className="w-24" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : (devices.data?.devices.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        No devices.
                      </TableCell>
                    </TableRow>
                  ) : (
                    devices.data?.devices.map((d) => (
                      <TableRow key={d.device_id}>
                        <TableCell>
                          <div className="font-medium">{d.display_name || d.device_id}</div>
                          <div className="text-xs text-muted-foreground">{d.device_id}</div>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {d.last_seen_ip ?? "—"}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {d.last_seen_ts ? formatRelative(d.last_seen_ts) : "—"}
                        </TableCell>
                        {canDisable ? (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => removeDevice(d.device_id)}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rooms">
          <Card>
            <CardContent className="p-4">
              {(detail.data?.rooms.length ?? 0) === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Not a member of any rooms.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {detail.data?.rooms.map((roomId) => (
                    <li key={roomId} className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
                      {roomId}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change display name</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => renameMutation.mutate()}
              loading={renameMutation.isPending}
              disabled={!displayName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password (sudo-protected server-side) */}
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(o) => {
          setResetOpen(o);
          if (!o) setNewPassword("");
        }}
        title={`Reset password for ${userId}?`}
        description={
          <div className="space-y-3 pt-2">
            <p>The user will be logged out of all devices.</p>
            <div className="space-y-2">
              <Label htmlFor="user-new-password">New password (min 12 chars)</Label>
              <Input
                id="user-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>
        }
        confirmLabel="Reset password"
        destructive
        requireReauth
        onConfirm={async () => {
          await api.post(`/api/users/${encodedId}/reset-password`, {
            password: newPassword,
            logoutDevices: true,
          });
          toast.success("Password reset.");
          setNewPassword("");
        }}
      />

      {/* Deactivate */}
      <ConfirmDialog
        open={deactivateOpen}
        onOpenChange={(o) => {
          setDeactivateOpen(o);
          if (!o) setEraseOnDeactivate(false);
        }}
        title={`Deactivate ${userId}?`}
        description={
          <div className="space-y-3">
            <p>
              The user will be logged out everywhere and unable to sign in. Reactivation requires
              setting a new password.
            </p>
            {permissions.has("users.delete") ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={eraseOnDeactivate}
                  onChange={(e) => setEraseOnDeactivate(e.target.checked)}
                />
                <span>
                  Permanently erase profile data (GDPR).{" "}
                  <span className="font-medium text-destructive">
                    Irreversible — removes profile and redacts message metadata on the homeserver.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        }
        confirmLabel={eraseOnDeactivate ? "Deactivate & erase" : "Deactivate"}
        destructive
        requireReauth
        onConfirm={async () => {
          await api.post(`/api/users/${encodedId}/deactivate`, { erase: eraseOnDeactivate });
          toast.success(eraseOnDeactivate ? "User deactivated and erased." : "User deactivated.");
          setEraseOnDeactivate(false);
          refresh();
        }}
      />

      {/* Reactivate */}
      <ConfirmDialog
        open={reactivateOpen}
        onOpenChange={(o) => {
          setReactivateOpen(o);
          if (!o) setReactivatePassword("");
        }}
        title={`Reactivate ${userId}?`}
        description={
          <div className="space-y-3 pt-2">
            <p>A new password is required for the account to sign in again.</p>
            <div className="space-y-2">
              <Label htmlFor="reactivate-password">New password (min 12 chars)</Label>
              <Input
                id="reactivate-password"
                type="password"
                autoComplete="new-password"
                value={reactivatePassword}
                onChange={(e) => setReactivatePassword(e.target.value)}
              />
            </div>
          </div>
        }
        confirmLabel="Reactivate"
        requireReauth
        onConfirm={async () => {
          await api.post(`/api/users/${encodedId}/reactivate`, { password: reactivatePassword });
          toast.success("User reactivated.");
          setReactivatePassword("");
          refresh();
        }}
      />

      {/* Logout all devices */}
      <ConfirmDialog
        open={logoutAllOpen}
        onOpenChange={setLogoutAllOpen}
        title={`Log ${userId} out everywhere?`}
        description="All of the user's devices will be removed and their access tokens invalidated."
        confirmLabel="Logout all"
        destructive
        requireReauth
        onConfirm={async () => {
          await api.post(`/api/users/${encodedId}/logout-all`);
          toast.success("All sessions terminated.");
          queryClient.invalidateQueries({ queryKey: ["user", userId, "devices"] });
        }}
      />

      <ConfirmDialog
        open={shadowBanOpen}
        onOpenChange={setShadowBanOpen}
        title={user.shadow_banned ? "Clear shadow-ban?" : "Shadow-ban user?"}
        description={
          user.shadow_banned
            ? "The user will be able to send messages normally again."
            : "Shadow-banned users appear to send messages but recipients do not receive them."
        }
        confirmLabel={user.shadow_banned ? "Clear shadow-ban" : "Shadow-ban"}
        destructive={!user.shadow_banned}
        requireReauth
        onConfirm={async () => {
          await api.post(`/api/users/${encodedId}/shadow-ban`, {
            shadowBanned: !user.shadow_banned,
          });
          toast.success(user.shadow_banned ? "Shadow-ban cleared." : "User shadow-banned.");
          refresh();
        }}
      />

      <ConfirmDialog
        open={noticeOpen}
        onOpenChange={(o) => {
          setNoticeOpen(o);
          if (!o) setNoticeBody("");
        }}
        title="Send server notice?"
        description={
          <div className="space-y-3 pt-2">
            <p>Delivers a server notice to {userId} via the Synapse Admin API.</p>
            <div className="space-y-2">
              <Label htmlFor="notice-body">Message</Label>
              <Input
                id="notice-body"
                value={noticeBody}
                onChange={(e) => setNoticeBody(e.target.value)}
                placeholder="Maintenance window tonight…"
              />
            </div>
          </div>
        }
        confirmLabel="Send"
        requireReauth
        onConfirm={async () => {
          if (!noticeBody.trim()) {
            toast.error("Enter a message.");
            throw new Error("empty");
          }
          await api.post("/api/server-notices", { userId, body: noticeBody });
          toast.success("Server notice sent.");
          setNoticeBody("");
        }}
      />

      {/* Roles dialog */}
      <Dialog open={rolesOpen} onOpenChange={setRolesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign platform roles</DialogTitle>
            <DialogDescription>
              Platform roles control what this Matrix user could do in the admin panel. They do
              not change Synapse server-admin status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {allRoles.data?.roles.map((role) => (
              <label key={role.slug} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={selectedRoles.includes(role.slug)}
                  onChange={(e) =>
                    setSelectedRoles((prev) =>
                      e.target.checked
                        ? [...prev, role.slug]
                        : prev.filter((s) => s !== role.slug),
                    )
                  }
                />
                <span>
                  <span className="font-medium">{role.name}</span>
                  {role.description ? (
                    <span className="block text-xs text-muted-foreground">{role.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <Separator />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => rolesMutation.mutate()} loading={rolesMutation.isPending}>
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
