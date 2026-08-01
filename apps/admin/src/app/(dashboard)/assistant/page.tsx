"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Send } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Proposal {
  id: string;
  kind: string;
  summary: string;
  status: string;
  payload: Record<string, unknown>;
}

export default function AssistantPage() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask about audit activity, security events, workflows or integrations. Privileged actions require your confirmation.",
    },
  ]);
  const [decideId, setDecideId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");

  const proposals = useQuery({
    queryKey: ["ai-proposals"],
    queryFn: () => api.get<{ proposals: Proposal[] }>("/api/ai/proposals"),
  });

  const chat = useMutation({
    mutationFn: (vars: { message: string; history: ChatMessage[] }) =>
      api.post<{ reply: string; proposals: Proposal[] }>("/api/ai/chat", {
        message: vars.message,
        history: vars.history.map((m) => ({ role: m.role, content: m.content })),
      }),
    onSuccess: (data, vars) => {
      setMessages([
        ...vars.history,
        { role: "user", content: vars.message },
        { role: "assistant", content: data.reply },
      ]);
      queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Assistant request failed."),
  });

  function send() {
    if (!input.trim()) return;
    const message = input.trim();
    setInput("");
    chat.mutate({ message, history: messages });
  }

  const pending = (proposals.data?.proposals ?? []).filter((p) => p.status === "pending");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="size-6" />
            Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Read-only tools for live data. Privileged changes are proposals until you confirm.
          </p>
        </div>
        <Card className="min-h-[420px]">
          <CardContent className="flex h-full flex-col gap-3 p-4">
            <div className="flex-1 space-y-3 overflow-y-auto">
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={
                    m.role === "user"
                      ? "ml-8 rounded-md bg-primary/10 p-3 text-sm"
                      : "mr-8 rounded-md bg-muted p-3 text-sm"
                  }
                >
                  {m.content}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about security events or workflows…"
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <Button onClick={send} loading={chat.isPending}>
                <Send className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending proposals</CardTitle>
          <CardDescription>Approve with sudo. No privileged side effects until confirmed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending proposals.</p>
          ) : (
            pending.map((p) => (
              <div key={p.id} className="space-y-2 rounded-md border p-3">
                <Badge variant="outline">{p.kind}</Badge>
                <p className="text-sm">{p.summary}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setDecision("approved");
                      setDecideId(p.id);
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDecision("rejected");
                      setDecideId(p.id);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!decideId}
        onOpenChange={(o) => !o && setDecideId(null)}
        title={decision === "approved" ? "Approve proposal" : "Reject proposal"}
        description="This records your decision with an audit entry. Requires re-authentication."
        confirmLabel={decision === "approved" ? "Approve" : "Reject"}
        destructive={decision === "rejected"}
        requireReauth
        onConfirm={async () => {
          await api.post("/api/ai/proposals", {
            proposalId: decideId,
            decision: decision === "approved" ? "approve" : "reject",
          });
          toast.success(decision === "approved" ? "Proposal approved." : "Proposal rejected.");
          queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
        }}
      />
    </div>
  );
}
