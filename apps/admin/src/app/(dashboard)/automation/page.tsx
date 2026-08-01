"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Play } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: string;
  lastRunAt: string | null;
  updatedAt: string;
}

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");

  const query = useQuery({
    queryKey: ["workflows"],
    queryFn: () =>
      api.get<{ workflows: WorkflowRow[] }>("/api/workflows"),
  });

  const create = useMutation({
    mutationFn: async () => {
      let definition = {
        actions: [{ type: "NOTIFY_ADMIN", config: { title: "Workflow fired", body: name } }],
      };
      if (draftPrompt.trim()) {
        const { draft } = await api.post<{ draft: { definition: typeof definition; triggerType: string; name: string } }>(
          "/api/ai/draft-workflow",
          { prompt: draftPrompt },
        );
        definition = draft.definition as typeof definition;
        return api.post("/api/workflows", {
          name: name || draft.name,
          triggerType: draft.triggerType,
          definition,
          enabled: false,
        });
      }
      return api.post("/api/workflows", {
        name,
        triggerType: "USER_CREATED",
        definition,
        enabled: false,
      });
    },
    onSuccess: () => {
      toast.success("Workflow created.");
      setCreateOpen(false);
      setName("");
      setDraftPrompt("");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create workflow."),
  });

  const [webhookName, setWebhookName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const webhooks = useQuery({
    queryKey: ["webhooks"],
    queryFn: () =>
      api.get<{
        endpoints: {
          id: string;
          name: string;
          slug: string;
          enabled: boolean;
          createdAt: string;
        }[];
      }>("/api/webhooks"),
  });

  const createWebhook = useMutation({
    mutationFn: () => api.post<{ secret: string; inboundPath: string }>("/api/webhooks", { name: webhookName }),
    onSuccess: (data) => {
      toast.success("Webhook endpoint created. Copy the secret now — it is shown once.");
      setCreatedSecret(`${data.inboundPath}\n${data.secret}`);
      setWebhookName("");
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create webhook."),
  });

  async function toggle(wf: WorkflowRow, enabled: boolean) {
    await api.patch(`/api/workflows/${wf.id}`, { enabled });
    queryClient.invalidateQueries({ queryKey: ["workflows"] });
  }

  async function run(wf: WorkflowRow) {
    try {
      await api.post(`/api/workflows/${wf.id}/execute`);
      toast.success("Workflow queued.");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Execute failed.");
    }
  }

  const canCreate = permissions.has("automation.create");
  const canExecute = permissions.has("automation.execute");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
          <p className="text-sm text-muted-foreground">
            Workflows, schedules and webhooks. Destructive actions require sudo.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New workflow
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
              <TableHead>Trigger</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data?.workflows ?? []).map((wf) => (
              <TableRow key={wf.id}>
                <TableCell>
                  <Link href={`/automation/${wf.id}`} className="font-medium text-primary hover:underline">
                    {wf.name}
                  </Link>
                  {wf.description ? (
                    <div className="text-xs text-muted-foreground">{wf.description}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{wf.triggerType}</Badge>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={wf.enabled}
                    disabled={!canCreate}
                    onCheckedChange={(v) => toggle(wf, v)}
                  />
                </TableCell>
                <TableCell>{wf.lastRunAt ? formatRelative(wf.lastRunAt) : "—"}</TableCell>
                <TableCell className="text-right">
                  {canExecute ? (
                    <Button size="sm" variant="outline" onClick={() => run(wf)}>
                      <Play className="size-3.5" />
                      Run
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Inbound webhooks</h2>
            <p className="text-sm text-muted-foreground">
              HMAC-signed endpoints that fire WEBHOOK_RECEIVED workflows.
            </p>
          </div>
          {canCreate ? (
            <div className="flex gap-2">
              <Input
                className="w-48"
                placeholder="Endpoint name"
                value={webhookName}
                onChange={(e) => setWebhookName(e.target.value)}
              />
              <Button
                disabled={!webhookName}
                loading={createWebhook.isPending}
                onClick={() => createWebhook.mutate()}
              >
                Add webhook
              </Button>
            </div>
          ) : null}
        </div>
        {createdSecret ? (
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{createdSecret}</pre>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(webhooks.data?.endpoints ?? []).map((ep) => (
              <TableRow key={ep.id}>
                <TableCell className="font-medium">{ep.name}</TableCell>
                <TableCell className="font-mono text-xs">{ep.slug}</TableCell>
                <TableCell>{formatRelative(ep.createdAt)}</TableCell>
              </TableRow>
            ))}
            {!webhooks.isLoading && !(webhooks.data?.endpoints.length ?? 0) ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No webhook endpoints yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Optional AI draft prompt</Label>
              <Input
                placeholder="When a user is created, notify admins"
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name && !draftPrompt} loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
