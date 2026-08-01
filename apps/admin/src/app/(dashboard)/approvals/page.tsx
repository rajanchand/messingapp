"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, Ban } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { useMe, usePermissions } from "@/lib/hooks/use-me";
import { formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ApprovalRow {
  id: string;
  kind: string;
  status: string;
  summary: string;
  reason: string | null;
  payload: { userIds?: string[]; erase?: boolean };
  requestedBy: string;
  requestedByUsername: string | null;
  reviewedByUsername: string | null;
  createdAt: string;
  reviewedAt: string | null;
  executedAt: string | null;
  error: string | null;
}

export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const permissions = usePermissions();
  const canManage = permissions.has("approvals.manage");
  const [status, setStatus] = useState("pending");
  const [decideTarget, setDecideTarget] = useState<{
    id: string;
    decision: "approve" | "reject";
  } | null>(null);

  const list = useQuery({
    queryKey: ["approvals", status],
    queryFn: () =>
      api.get<{ approvals: ApprovalRow[] }>(`/api/approvals?status=${status}&limit=50`),
  });

  const decideMutation = useMutation({
    mutationFn: (input: { approvalId: string; decision: "approve" | "reject" | "cancel" }) =>
      api.patch("/api/approvals", input),
    onSuccess: (_, vars) => {
      toast.success(
        vars.decision === "approve"
          ? "Approved and executed."
          : vars.decision === "reject"
            ? "Rejected."
            : "Cancelled.",
      );
      setDecideTarget(null);
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Action failed.");
    },
  });

  const rows = list.data?.approvals ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Dual-control queue for GDPR erase, mass deactivate, and bulk device revoke. A second
          admin must approve (with sudo).
        </p>
      </div>

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="executed">Executed</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        <TabsContent value={status} className="mt-4">
          {list.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No {status} approvals.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isMine = row.requestedBy === me?.user.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant="outline">{row.kind}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm">{row.summary}</TableCell>
                      <TableCell className="text-sm">
                        {row.requestedByUsername ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "pending"
                              ? "default"
                              : row.status === "executed"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {row.status}
                        </Badge>
                        {row.error ? (
                          <p className="mt-1 text-xs text-destructive">{row.error}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {row.status === "pending" && isMine ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                decideMutation.mutate({
                                  approvalId: row.id,
                                  decision: "cancel",
                                })
                              }
                            >
                              <Ban className="size-3.5" />
                              Cancel
                            </Button>
                          ) : null}
                          {row.status === "pending" && canManage && !isMine ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setDecideTarget({ id: row.id, decision: "reject" })
                                }
                              >
                                <X className="size-3.5" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  setDecideTarget({ id: row.id, decision: "approve" })
                                }
                              >
                                <Check className="size-3.5" />
                                Approve
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={Boolean(decideTarget)}
        onOpenChange={(open) => !open && setDecideTarget(null)}
        title={decideTarget?.decision === "approve" ? "Approve request?" : "Reject request?"}
        description={
          decideTarget?.decision === "approve"
            ? "This will execute the Synapse action immediately. Requires an active sudo session."
            : "The requester will be notified. No Synapse changes will be made."
        }
        confirmLabel={decideTarget?.decision === "approve" ? "Approve & execute" : "Reject"}
        destructive={decideTarget?.decision === "reject"}
        requireReauth
        onConfirm={async () => {
          if (!decideTarget) return;
          await api.patch("/api/approvals", {
            approvalId: decideTarget.id,
            decision: decideTarget.decision,
          });
          toast.success(
            decideTarget.decision === "approve" ? "Approved and executed." : "Rejected.",
          );
          setDecideTarget(null);
          queryClient.invalidateQueries({ queryKey: ["approvals"] });
        }}
      />
    </div>
  );
}
