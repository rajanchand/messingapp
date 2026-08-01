"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  registrationEnabled: z.boolean(),
  federationEnabled: z.boolean(),
  guestsAllowed: z.boolean(),
  publicRoomDirectoryEnabled: z.boolean(),
  messagesPerSecond: z.string().optional(),
  registrationPerSecond: z.string().optional(),
  loginPerSecond: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
type FormInput = z.infer<typeof formSchema>;

interface PolicyResponse {
  live: {
    serverVersion: string;
    registrationEnabled: boolean;
    federationEnabled: boolean;
    guestsAllowed: boolean;
    publicRoomDirectoryEnabled: boolean;
    rateLimitSummary: { notes?: string; messagesPerSecond?: number };
    source: string;
  };
  panel: {
    registrationEnabled: boolean;
    federationEnabled: boolean;
    guestsAllowed: boolean;
    publicRoomDirectoryEnabled: boolean;
    messagesPerSecond: number | null;
    registrationPerSecond: number | null;
    loginPerSecond: number | null;
    notes: string;
  };
  mutableRemotely: boolean;
  guidance: string;
}

export default function HomeserverPolicyPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canManage = permissions.has("settings.manage");

  const query = useQuery({
    queryKey: ["homeserver-policy"],
    queryFn: () => api.get<PolicyResponse>("/api/settings/homeserver-policy"),
  });

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    values: query.data
      ? {
          registrationEnabled: query.data.panel.registrationEnabled,
          federationEnabled: query.data.panel.federationEnabled,
          guestsAllowed: query.data.panel.guestsAllowed,
          publicRoomDirectoryEnabled: query.data.panel.publicRoomDirectoryEnabled,
          messagesPerSecond: query.data.panel.messagesPerSecond?.toString() ?? "",
          registrationPerSecond: query.data.panel.registrationPerSecond?.toString() ?? "",
          loginPerSecond: query.data.panel.loginPerSecond?.toString() ?? "",
          notes: query.data.panel.notes ?? "",
        }
      : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (input: FormInput) =>
      api.patch("/api/settings/homeserver-policy", {
        registrationEnabled: input.registrationEnabled,
        federationEnabled: input.federationEnabled,
        guestsAllowed: input.guestsAllowed,
        publicRoomDirectoryEnabled: input.publicRoomDirectoryEnabled,
        messagesPerSecond: input.messagesPerSecond ? Number(input.messagesPerSecond) : null,
        registrationPerSecond: input.registrationPerSecond
          ? Number(input.registrationPerSecond)
          : null,
        loginPerSecond: input.loginPerSecond ? Number(input.loginPerSecond) : null,
        notes: input.notes,
      }),
    onSuccess: () => {
      toast.success("Policy preferences saved.");
      queryClient.invalidateQueries({ queryKey: ["homeserver-policy"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Save failed.");
    },
  });

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!query.data) return <p className="text-sm text-destructive">Failed to load policy.</p>;

  const { live, guidance, mutableRemotely } = query.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Homeserver policy</h1>
        <p className="text-sm text-muted-foreground">
          Registration, federation, and rate-limit intent. Synapse version:{" "}
          <span className="font-medium text-foreground">{live.serverVersion}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live snapshot</CardTitle>
          <CardDescription>
            Source: <Badge variant="outline">{live.source}</Badge>
            {mutableRemotely ? " (writable mock)" : " (read + panel prefs)"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>Registration: {live.registrationEnabled ? "open" : "closed"}</div>
          <div>Federation: {live.federationEnabled ? "on" : "off"}</div>
          <div>Guests: {live.guestsAllowed ? "allowed" : "denied"}</div>
          <div>Public directory: {live.publicRoomDirectoryEnabled ? "on" : "off"}</div>
          <p className="sm:col-span-2 text-muted-foreground">{guidance}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Panel preferences</CardTitle>
          <CardDescription>
            Safe toggles store operator intent. On mock Synapse they are pushed remotely; on
            production Synapse, sync to homeserver.yaml and reload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
          >
            {(
              [
                ["registrationEnabled", "Open registration"],
                ["federationEnabled", "Federation enabled"],
                ["guestsAllowed", "Guest access"],
                ["publicRoomDirectoryEnabled", "Public room directory"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <Label htmlFor={key}>{label}</Label>
                <Switch
                  id={key}
                  checked={form.watch(key)}
                  onCheckedChange={(c) => form.setValue(key, c)}
                  disabled={!canManage}
                />
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="mps">Messages / sec</Label>
                <Input id="mps" type="number" {...form.register("messagesPerSecond")} disabled={!canManage} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rps">Registration / sec</Label>
                <Input id="rps" type="number" {...form.register("registrationPerSecond")} disabled={!canManage} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lps">Login / sec</Label>
                <Input id="lps" type="number" {...form.register("loginPerSecond")} disabled={!canManage} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" {...form.register("notes")} disabled={!canManage} />
            </div>
            {canManage ? (
              <Button type="submit" disabled={saveMutation.isPending}>
                Save preferences
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
