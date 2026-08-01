"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, Ban } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { formatDate, formatRelative } from "@/lib/utils";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SecurityOverview {
  failedLogins: {
    id: string;
    username: string | null;
    ip: string | null;
    success: boolean;
    createdAt: string;
  }[];
  events: {
    id: string;
    type: string;
    severity: string;
    ip: string | null;
    createdAt: string;
  }[];
  sessions: {
    id: string;
    userId: string;
    username: string;
    ip: string | null;
    userAgent: string | null;
    lastSeenAt: string;
  }[];
  ipBlocks: {
    id: string;
    cidr: string;
    reason: string | null;
    createdAt: string;
    expiresAt: string | null;
  }[];
  lockouts: {
    id: string;
    username: string;
    failedLoginCount: number;
    lockedUntil: string | null;
  }[];
  suspiciousIps: { ip: string; failures: number }[];
}

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canManage = permissions.has("security.manage");
  const [cidr, setCidr] = useState("");
  const [reason, setReason] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [unblockId, setUnblockId] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["security-overview"],
    queryFn: () => api.get<SecurityOverview>("/api/security/overview?days=7"),
  });

  const blockMutation = useMutation({
    mutationFn: () => api.post("/api/security/ip-blocks", { cidr, reason: reason || undefined }),
    onSuccess: () => {
      toast.success("IP blocked.");
      setCidr("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["security-overview"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Failed to block IP."),
  });

  async function revokeSession(sessionId: string) {
    await api.post("/api/security/sessions/revoke", { sessionId });
    toast.success("Session revoked.");
    queryClient.invalidateQueries({ queryKey: ["security-overview"] });
  }

  async function unblock(id: string) {
    await api.post("/api/security/ip-blocks/remove", { id });
    toast.success("IP unblocked.");
    queryClient.invalidateQueries({ queryKey: ["security-overview"] });
  }

  const data = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldAlert className="size-6" />
          Security centre
        </h1>
        <p className="text-sm text-muted-foreground">
          Login attempts, active sessions, IP blocks and security events.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Failed logins (7d)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">
            {overview.isLoading ? <Skeleton className="h-8 w-16" /> : (data?.failedLogins.length ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Active sessions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">
            {overview.isLoading ? <Skeleton className="h-8 w-16" /> : (data?.sessions.length ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">IP blocks</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">
            {overview.isLoading ? <Skeleton className="h-8 w-16" /> : (data?.ipBlocks.length ?? 0)}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="logins">Failed logins</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="blocks">IP blocks</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Security events</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.events ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.type}</TableCell>
                      <TableCell>
                        <Badge variant={e.severity === "critical" ? "destructive" : "secondary"}>
                          {e.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>{e.ip ?? "—"}</TableCell>
                      <TableCell>{formatRelative(e.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {!overview.isLoading && !data?.events.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No events in the last 7 days.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logins" className="mt-4 space-y-4">
          {data?.suspiciousIps?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Suspicious IPs</CardTitle>
                <CardDescription>3+ failed attempts in the window.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.suspiciousIps.map((s) => (
                  <Badge key={s.ip} variant="destructive">
                    {s.ip} ({s.failures})
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.failedLogins ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.username ?? "—"}</TableCell>
                      <TableCell>{r.ip ?? "—"}</TableCell>
                      <TableCell>{formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.sessions ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.username}</TableCell>
                      <TableCell>{s.ip ?? "—"}</TableCell>
                      <TableCell>{formatRelative(s.lastSeenAt)}</TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <Button size="sm" variant="ghost" onClick={() => setRevokeId(s.id)}>
                            Revoke
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="blocks" className="mt-4 space-y-4">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Ban className="size-4" />
                  Block IP / CIDR
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="cidr">IP or CIDR</Label>
                  <Input
                    id="cidr"
                    placeholder="203.0.113.0/24"
                    value={cidr}
                    onChange={(e) => setCidr(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason">Reason</Label>
                  <Input
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <Button
                  disabled={!cidr || blockMutation.isPending}
                  onClick={() => blockMutation.mutate()}
                >
                  Block
                </Button>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CIDR</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.ipBlocks ?? []).map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-sm">{b.cidr}</TableCell>
                      <TableCell>{b.reason ?? "—"}</TableCell>
                      <TableCell>{formatRelative(b.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <Button size="sm" variant="ghost" onClick={() => setUnblockId(b.id)}>
                            Remove
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(open) => !open && setRevokeId(null)}
        title="Revoke session?"
        description="The user will be signed out immediately. Requires sudo mode."
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          if (!revokeId) return;
          await revokeSession(revokeId);
          setRevokeId(null);
        }}
      />

      <ConfirmDialog
        open={!!unblockId}
        onOpenChange={(open) => !open && setUnblockId(null)}
        title="Remove IP block?"
        description="Traffic from this address will be allowed again."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!unblockId) return;
          await unblock(unblockId);
          setUnblockId(null);
        }}
      />
    </div>
  );
}
