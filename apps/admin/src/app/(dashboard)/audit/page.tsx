"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/utils";
import type { AuditEntry } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

async function downloadExport(format: "csv" | "json", actor: string, target: string) {
  const qs = new URLSearchParams({
    format,
    actor,
    target,
  });
  const res = await fetch(`/api/audit/export?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) {
    toast.error("Export failed.");
    return;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `audit-export.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${filename}`);
}

export default function AuditPage() {
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const debouncedActor = useDebounced(actor, 300);
  const debouncedTarget = useDebounced(target, 300);

  const query = useQuery({
    queryKey: ["audit", { actor: debouncedActor, target: debouncedTarget, page }],
    queryFn: () =>
      api.get<{ entries: AuditEntry[]; total: number }>(
        `/api/audit?actor=${encodeURIComponent(debouncedActor)}&target=${encodeURIComponent(debouncedTarget)}&page=${page}&limit=${PAGE_SIZE}`,
      ),
  });

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">
            Append-only trail of every sensitive administrative action.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!exporting}
            onClick={async () => {
              setExporting("csv");
              try {
                await downloadExport("csv", debouncedActor, debouncedTarget);
              } finally {
                setExporting(null);
              }
            }}
          >
            <Download className="size-4" />
            {exporting === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!!exporting}
            onClick={async () => {
              setExporting("json");
              try {
                await downloadExport("json", debouncedActor, debouncedTarget);
              } finally {
                setExporting(null);
              }
            }}
          >
            <Download className="size-4" />
            {exporting === "json" ? "Exporting…" : "Export JSON"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter by actor…"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by actor"
          />
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter by target…"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by target"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Target</TableHead>
              <TableHead className="hidden lg:table-cell">IP</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No audit entries yet.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{entry.actor}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-56 truncate text-sm md:table-cell">
                    {entry.target ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {entry.ip ?? "—"}
                  </TableCell>
                  <TableCell>
                    {entry.result === "success" ? (
                      <Badge variant="success">success</Badge>
                    ) : (
                      <Badge variant="destructive">{entry.result}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {page} of {pageCount} · {total} entries
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
