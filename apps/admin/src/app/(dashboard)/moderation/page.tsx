"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flag, ImageIcon, Network } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { formatRelative } from "@/lib/utils";
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

interface EventReport {
  id: number;
  user_id: string;
  room_id: string | null;
  event_id: string | null;
  reason: string | null;
  received_ts: number;
}

interface MediaItem {
  media_id: string;
  media_type?: string | null;
  upload_name?: string | null;
  quarantined_by?: string | null;
}

interface FederationDestination {
  destination: string;
  failure_ts?: number | null;
  retry_interval?: number | null;
}

export default function ModerationPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canManageReports = permissions.has("reports.manage");
  const canManageMedia = permissions.has("media.manage");
  const [mediaUserId, setMediaUserId] = useState("");
  const [deleteReportId, setDeleteReportId] = useState<string | null>(null);
  const [mediaAction, setMediaAction] = useState<{
    action: "quarantine" | "unquarantine" | "delete";
    mediaId: string;
  } | null>(null);

  const reports = useQuery({
    queryKey: ["event-reports"],
    queryFn: () =>
      api.get<{ event_reports: EventReport[]; total: number }>("/api/reports?limit=50"),
    enabled: permissions.has("reports.read"),
  });

  const media = useQuery({
    queryKey: ["media", mediaUserId],
    queryFn: () =>
      api.get<{ local?: MediaItem[]; total?: number }>(
        `/api/media?userId=${encodeURIComponent(mediaUserId)}`,
      ),
    enabled: permissions.has("media.read") && mediaUserId.includes(":"),
  });

  const federation = useQuery({
    queryKey: ["federation-destinations"],
    queryFn: () =>
      api.get<{ destinations: FederationDestination[]; total: number }>(
        "/api/federation/destinations?limit=50",
      ),
    enabled: permissions.has("federation.read"),
  });

  const serverName =
    mediaUserId.includes(":") ? mediaUserId.split(":").slice(1).join(":") : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
        <p className="text-sm text-muted-foreground">
          Event reports, media quarantine, and federation destinations.
        </p>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          {permissions.has("reports.read") ? (
            <TabsTrigger value="reports">
              <Flag className="size-4" />
              Reports
            </TabsTrigger>
          ) : null}
          {permissions.has("media.read") ? (
            <TabsTrigger value="media">
              <ImageIcon className="size-4" />
              Media
            </TabsTrigger>
          ) : null}
          {permissions.has("federation.read") ? (
            <TabsTrigger value="federation">
              <Network className="size-4" />
              Federation
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="reports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event reports</CardTitle>
              <CardDescription>
                User-submitted reports from the homeserver ({reports.data?.total ?? 0} total).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Reporter</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : (reports.data?.event_reports ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No reports.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (reports.data?.event_reports ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.id}</TableCell>
                        <TableCell className="font-mono text-xs">{r.user_id}</TableCell>
                        <TableCell className="font-mono text-xs">{r.room_id ?? "—"}</TableCell>
                        <TableCell>{r.reason ?? "—"}</TableCell>
                        <TableCell>{formatRelative(new Date(r.received_ts).toISOString())}</TableCell>
                        <TableCell className="text-right">
                          {canManageReports ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteReportId(String(r.id))}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="media" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">List user media</CardTitle>
              <CardDescription>Enter a full Matrix user ID to list uploaded media.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="media-user">User ID</Label>
                <Input
                  id="media-user"
                  className="min-w-[280px] font-mono text-sm"
                  placeholder="@alice:example.org"
                  value={mediaUserId}
                  onChange={(e) => setMediaUserId(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["media", mediaUserId] })}
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Media ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(media.data?.local ?? []).map((m) => (
                    <TableRow key={m.media_id}>
                      <TableCell className="font-mono text-sm">{m.media_id}</TableCell>
                      <TableCell>{m.media_type ?? "—"}</TableCell>
                      <TableCell>{m.upload_name ?? "—"}</TableCell>
                      <TableCell>
                        {m.quarantined_by ? (
                          <Badge variant="destructive">Quarantined</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {canManageMedia ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setMediaAction({
                                  action: m.quarantined_by ? "unquarantine" : "quarantine",
                                  mediaId: m.media_id,
                                })
                              }
                            >
                              {m.quarantined_by ? "Unquarantine" : "Quarantine"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setMediaAction({ action: "delete", mediaId: m.media_id })
                              }
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!mediaUserId.includes(":") ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Enter a user ID to load media.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="federation" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Federation destinations</CardTitle>
              <CardDescription>Outbound federation status from Synapse.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destination</TableHead>
                    <TableHead>Failure</TableHead>
                    <TableHead>Retry interval</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(federation.data?.destinations ?? []).map((d) => (
                    <TableRow key={d.destination}>
                      <TableCell className="font-mono text-sm">{d.destination}</TableCell>
                      <TableCell>
                        {d.failure_ts ? (
                          <Badge variant="destructive">Failing</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell>{d.retry_interval ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!deleteReportId}
        onOpenChange={(o) => !o && setDeleteReportId(null)}
        title="Delete event report?"
        description="Removes the report from the Synapse queue. Does not delete the underlying event."
        confirmLabel="Delete"
        destructive
        requireReauth
        onConfirm={async () => {
          if (!deleteReportId) return;
          await api.delete(`/api/reports/${deleteReportId}`);
          toast.success("Report deleted.");
          queryClient.invalidateQueries({ queryKey: ["event-reports"] });
        }}
      />

      <ConfirmDialog
        open={!!mediaAction}
        onOpenChange={(o) => !o && setMediaAction(null)}
        title={`${mediaAction?.action} media?`}
        description={`Media ${mediaAction?.mediaId} on ${serverName || "homeserver"}.`}
        confirmLabel="Confirm"
        destructive={mediaAction?.action === "delete"}
        requireReauth
        onConfirm={async () => {
          if (!mediaAction || !serverName) {
            toast.error("Could not resolve media server name from user ID.");
            return;
          }
          try {
            await api.post("/api/media", {
              action: mediaAction.action,
              serverName,
              mediaId: mediaAction.mediaId,
            });
            toast.success(`Media ${mediaAction.action} complete.`);
            queryClient.invalidateQueries({ queryKey: ["media", mediaUserId] });
          } catch (err) {
            toast.error(err instanceof ApiClientError ? err.message : "Media action failed.");
            throw err;
          }
        }}
      />
    </div>
  );
}
