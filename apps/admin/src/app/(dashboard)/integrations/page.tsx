"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, PlugZap } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface IntegrationRow {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canManage = permissions.has("integrations.manage");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("slack");
  const [name, setName] = useState("");
  const [configJson, setConfigJson] = useState("{}");
  const [secretsJson, setSecretsJson] = useState("{}");

  const query = useQuery({
    queryKey: ["integrations"],
    queryFn: () =>
      api.get<{ integrations: IntegrationRow[]; types: string[] }>("/api/integrations"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/integrations", {
        type,
        name,
        config: JSON.parse(configJson || "{}"),
        secrets: JSON.parse(secretsJson || "{}"),
        enabled: false,
      }),
    onSuccess: () => {
      toast.success("Integration created. Secrets are stored encrypted.");
      setOpen(false);
      setName("");
      setConfigJson("{}");
      setSecretsJson("{}");
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create integration."),
  });

  async function test(id: string) {
    try {
      const { result } = await api.post<{ result: { ok: boolean; message?: string } }>(
        `/api/integrations/${id}/test`,
      );
      toast[result.ok ? "success" : "error"](result.message ?? (result.ok ? "OK" : "Failed"));
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Test failed.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Slack, GitHub, Email, Discord, Jira and outbound webhooks. Secrets never leave the server after save.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Connect
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last success</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data?.integrations ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.type}</Badge>
                </TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>
                  {row.lastSuccessAt ? formatRelative(row.lastSuccessAt) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {canManage ? (
                    <Button size="sm" variant="outline" onClick={() => test(row.id)}>
                      <PlugZap className="size-3.5" />
                      Test
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect integration</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(query.data?.types ?? ["slack", "github", "email", "discord", "jira", "webhook"]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Config JSON</Label>
              <Input value={configJson} onChange={(e) => setConfigJson(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Secrets JSON (shown once)</Label>
              <Input
                value={secretsJson}
                onChange={(e) => setSecretsJson(e.target.value)}
                placeholder='{"botToken":"..."}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name} loading={create.isPending} onClick={() => create.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
