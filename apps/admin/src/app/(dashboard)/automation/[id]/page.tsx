"use client";

import { use, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WorkflowDetail {
  id: string;
  name: string;
  triggerType: string;
  definition: {
    actions: { type: string; config?: Record<string, unknown> }[];
    conditions?: unknown;
    schedule?: { cron: string } | string;
  };
}

export default function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState("NOTIFY_ADMIN");

  const detail = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api.get<{ workflow: WorkflowDetail }>(`/api/workflows/${id}`),
  });

  const runs = useQuery({
    queryKey: ["workflow-runs", id],
    queryFn: () => api.get<{ runs: { id: string; status: string; createdAt: string }[] }>(
      `/api/workflows/${id}/runs`,
    ),
  });

  const initialNodes: Node[] = useMemo(() => {
    const wf = detail.data?.workflow;
    if (!wf) return [];
    const nodes: Node[] = [
      {
        id: "trigger",
        position: { x: 80, y: 120 },
        data: { label: `Trigger: ${wf.triggerType}` },
        type: "input",
      },
    ];
    wf.definition.actions.forEach((action, i) => {
      nodes.push({
        id: `action-${i}`,
        position: { x: 320, y: 40 + i * 100 },
        data: { label: action.type },
      });
    });
    return nodes;
  }, [detail.data]);

  const initialEdges: Edge[] = useMemo(() => {
    const wf = detail.data?.workflow;
    if (!wf) return [];
    return wf.definition.actions.map((_, i) => ({
      id: `e-trigger-${i}`,
      source: "trigger",
      target: `action-${i}`,
    }));
  }, [detail.data]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when data loads
  if (detail.data && nodes.length === 0 && initialNodes.length > 0) {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const save = useMutation({
    mutationFn: () => {
      const actions = nodes
        .filter((n) => n.id.startsWith("action-"))
        .map((n) => ({
          type: String(n.data.label),
          config:
            String(n.data.label) === "NOTIFY_ADMIN"
              ? { title: "Automation", body: "Workflow action" }
              : {},
        }));
      return api.patch(`/api/workflows/${id}`, {
        definition: { actions: actions.length ? actions : [{ type: "NOTIFY_ADMIN", config: { title: "Automation", body: "noop" } }] },
      });
    },
    onSuccess: () => {
      toast.success("Workflow saved.");
      queryClient.invalidateQueries({ queryKey: ["workflow", id] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Save failed."),
  });

  if (detail.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!detail.data) return <p className="text-sm text-destructive">Workflow not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/automation" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Automation
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{detail.data.workflow.name}</h1>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Add action</Label>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "NOTIFY_ADMIN",
                  "WRITE_AUDIT",
                  "SEND_SLACK",
                  "SEND_EMAIL",
                  "SEND_WEBHOOK",
                  "SEND_MATRIX_MESSAGE",
                  "DEACTIVATE_USER",
                  "KICK_USER",
                ].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() =>
                setNodes((ns) => [
                  ...ns,
                  {
                    id: `action-${ns.length}`,
                    position: { x: 320, y: 40 + ns.length * 80 },
                    data: { label: actionType },
                  },
                ])
              }
            >
              Add
            </Button>
          </div>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            <Save className="size-4" />
            Save
          </Button>
        </div>
      </div>

      <div className="h-[420px] rounded-md border bg-card">
        <ReactFlow
          nodes={nodes.length ? nodes : initialNodes}
          edges={edges.length ? edges : initialEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Recent runs</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {(runs.data?.runs ?? []).map((r) => (
            <li key={r.id}>
              {r.status} · {r.createdAt}
            </li>
          ))}
          {(runs.data?.runs.length ?? 0) === 0 ? <li>No runs yet.</li> : null}
        </ul>
      </div>
    </div>
  );
}
