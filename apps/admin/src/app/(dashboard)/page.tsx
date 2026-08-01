"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Database,
  KeyRound,
  MessagesSquare,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Overview {
  matrix: {
    activeUsers: number;
    totalUsers: number;
    deactivatedUsers: number;
    serverAdmins: number;
    totalRooms: number;
  };
  panel: {
    activeSessions: number;
    failedLogins24h: number;
    securityEvents24h: number;
    panelAdmins: number;
  };
}

interface Health {
  database: { healthy: boolean };
  redis: { healthy: boolean };
  synapse: { healthy: boolean; version: string | null };
}

interface ChartsData {
  series: {
    date: string;
    successfulLogins: number;
    failedLogins: number;
    securityEvents: number;
    newUsers: number;
    workflowRuns: number;
    workflowSuccessRate: number | null;
    integrationCalls: number;
    integrationErrorRate: number | null;
  }[];
}

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: number | string | undefined;
  icon: typeof Users;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold tabular-nums">{value ?? "—"}</div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthBadge({ healthy, loading }: { healthy?: boolean; loading: boolean }) {
  if (loading) return <Skeleton className="h-5 w-16" />;
  return healthy ? (
    <Badge variant="success">Healthy</Badge>
  ) : (
    <Badge variant="destructive">Down</Badge>
  );
}

export default function DashboardPage() {
  const overview = useQuery({
    queryKey: ["stats", "overview"],
    queryFn: () => api.get<Overview>("/api/stats/overview"),
    refetchInterval: 60_000,
  });
  const health = useQuery({
    queryKey: ["stats", "health"],
    queryFn: () => api.get<Health>("/api/stats/health"),
    refetchInterval: 30_000,
  });
  const charts = useQuery({
    queryKey: ["stats", "charts"],
    queryFn: () => api.get<ChartsData>("/api/stats/charts?days=14"),
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live overview of your Matrix homeserver and admin platform.
        </p>
      </div>

      {overview.isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Could not load statistics</AlertTitle>
          <AlertDescription>
            The homeserver or database may be unreachable. Check the health cards below.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total users"
          value={overview.data?.matrix.totalUsers}
          icon={Users}
          loading={overview.isLoading}
        />
        <StatCard
          title="Active users"
          value={overview.data?.matrix.activeUsers}
          icon={Activity}
          loading={overview.isLoading}
        />
        <StatCard
          title="Deactivated users"
          value={overview.data?.matrix.deactivatedUsers}
          icon={Users}
          loading={overview.isLoading}
        />
        <StatCard
          title="Server admins"
          value={overview.data?.matrix.serverAdmins}
          icon={ShieldCheck}
          loading={overview.isLoading}
        />
        <StatCard
          title="Total rooms"
          value={overview.data?.matrix.totalRooms}
          icon={MessagesSquare}
          loading={overview.isLoading}
        />
        <StatCard
          title="Active admin sessions"
          value={overview.data?.panel.activeSessions}
          icon={KeyRound}
          loading={overview.isLoading}
        />
        <StatCard
          title="Failed logins (24h)"
          value={overview.data?.panel.failedLogins24h}
          icon={AlertTriangle}
          loading={overview.isLoading}
        />
        <StatCard
          title="Security events (24h)"
          value={overview.data?.panel.securityEvents24h}
          icon={ShieldCheck}
          loading={overview.isLoading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Database className="size-4" /> Application database
            </CardTitle>
            <HealthBadge healthy={health.data?.database.healthy} loading={health.isLoading} />
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Dedicated PostgreSQL for platform data.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Server className="size-4" /> Redis
            </CardTitle>
            <HealthBadge healthy={health.data?.redis.healthy} loading={health.isLoading} />
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Rate limiting and caching layer.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Server className="size-4" /> Synapse
            </CardTitle>
            <HealthBadge healthy={health.data?.synapse.healthy} loading={health.isLoading} />
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {health.data?.synapse.version
              ? `Version ${health.data.synapse.version}`
              : "Matrix homeserver"}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Login activity (14 days)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {charts.isLoading ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.data?.series ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-popover-foreground)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="successfulLogins"
                    name="Successful"
                    stroke="var(--color-chart-2)"
                    fill="var(--color-chart-2)"
                    fillOpacity={0.25}
                  />
                  <Area
                    type="monotone"
                    dataKey="failedLogins"
                    name="Failed"
                    stroke="var(--color-chart-3)"
                    fill="var(--color-chart-3)"
                    fillOpacity={0.25}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">New Matrix users (14 days)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {charts.isLoading ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.data?.series ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-popover-foreground)",
                    }}
                  />
                  <Bar dataKey="newUsers" name="New users" fill="var(--color-chart-1)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Workflow runs (14 days)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {charts.isLoading ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.data?.series ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-popover-foreground)",
                    }}
                  />
                  <Bar
                    dataKey="workflowRuns"
                    name="Runs"
                    fill="var(--color-chart-4)"
                    radius={4}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Integration calls (14 days)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {charts.isLoading ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.data?.series ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-popover-foreground)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="integrationCalls"
                    name="Calls"
                    stroke="var(--color-chart-5)"
                    fill="var(--color-chart-5)"
                    fillOpacity={0.25}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
