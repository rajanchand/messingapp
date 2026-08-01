"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Lock, Plus, Search } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MatrixRoom, RoomsListResponse } from "@/lib/types";

const PAGE_SIZE = 25;

const createSchema = z.object({
  name: z.string().min(1).max(256),
  topic: z.string().max(1024).optional(),
  alias: z.string().max(255).optional(),
  visibility: z.enum(["public", "private"]),
  encryption: z.boolean(),
  space: z.boolean(),
});
type CreateInput = z.infer<typeof createSchema>;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function RoomsPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState("rooms");
  const [aliasInput, setAliasInput] = useState("");
  const [aliasRoomId, setAliasRoomId] = useState("");
  const [resolveAlias, setResolveAlias] = useState("");
  const debouncedSearch = useDebounced(search, 300);

  const roomsQuery = useQuery({
    queryKey: ["rooms", { search: debouncedSearch, from }],
    queryFn: () =>
      api.get<RoomsListResponse>(
        `/api/rooms?search=${encodeURIComponent(debouncedSearch)}&from=${from}&limit=${PAGE_SIZE}`,
      ),
  });

  const directoryQuery = useQuery({
    queryKey: ["room-directory"],
    queryFn: () =>
      api.get<{
        rooms: {
          room_id: string;
          name?: string | null;
          canonical_alias?: string | null;
          num_joined_members: number;
          room_type?: string | null;
        }[];
        totalEstimate: number | null;
      }>("/api/rooms/directory?limit=50"),
    enabled: tab === "directory",
  });

  const form = useForm<CreateInput>({
    resolver: zodResolver(createSchema),
    defaultValues: { visibility: "private", encryption: true, space: false },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateInput) => api.post("/api/rooms", input),
    onSuccess: (_, vars) => {
      toast.success(vars.space ? "Space created." : "Room created.");
      setCreateOpen(false);
      form.reset({ visibility: "private", encryption: true, space: false });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      queryClient.invalidateQueries({ queryKey: ["room-directory"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create room.");
    },
  });

  const aliasCreate = useMutation({
    mutationFn: () => api.post("/api/rooms/aliases", { alias: aliasInput, roomId: aliasRoomId }),
    onSuccess: () => {
      toast.success("Alias created.");
      setAliasInput("");
      setAliasRoomId("");
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create alias."),
  });

  const aliasResolve = useMutation({
    mutationFn: () =>
      api.get<{ alias: string; room_id: string }>(
        `/api/rooms/aliases?alias=${encodeURIComponent(resolveAlias)}`,
      ),
    onSuccess: (data) => toast.success(`Resolves to ${data.room_id}`),
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : "Alias not found."),
  });

  const rooms = roomsQuery.data?.rooms ?? [];
  const total = roomsQuery.data?.total ?? 0;
  const canCreate = permissions.has("rooms.create");
  const canUpdate = permissions.has("rooms.update");
  const spaces = rooms.filter((r) => (r as MatrixRoom & { room_type?: string }).room_type === "m.space");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rooms & spaces</h1>
          <p className="text-sm text-muted-foreground">
            Rooms, public directory, and aliases. {total} rooms total.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rooms">All rooms</TabsTrigger>
          <TabsTrigger value="spaces">Spaces</TabsTrigger>
          <TabsTrigger value="directory">Public directory</TabsTrigger>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
        </TabsList>

        <TabsContent value="rooms" className="mt-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search rooms…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setFrom(0);
              }}
            />
          </div>
          <RoomTable rooms={rooms} loading={roomsQuery.isLoading} />
          <Pager from={from} pageSize={PAGE_SIZE} total={total} setFrom={setFrom} count={rooms.length} />
        </TabsContent>

        <TabsContent value="spaces" className="mt-4">
          <RoomTable
            rooms={spaces.length ? spaces : rooms.filter(() => false)}
            loading={roomsQuery.isLoading}
            empty="No spaces in this page. Create one with the Space checkbox."
          />
        </TabsContent>

        <TabsContent value="directory" className="mt-4">
          {directoryQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(directoryQuery.data?.rooms ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No public rooms published.
                    </TableCell>
                  </TableRow>
                ) : (
                  (directoryQuery.data?.rooms ?? []).map((r) => (
                    <TableRow key={r.room_id}>
                      <TableCell>
                        <Link
                          href={`/rooms/${encodeURIComponent(r.room_id)}`}
                          className="font-medium hover:underline"
                        >
                          {r.name || r.canonical_alias || r.room_id}
                        </Link>
                      </TableCell>
                      <TableCell>{r.num_joined_members}</TableCell>
                      <TableCell>
                        {r.room_type === "m.space" ? (
                          <Badge>Space</Badge>
                        ) : (
                          <Badge variant="outline">Room</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="aliases" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="#alias:server or localpart"
              value={resolveAlias}
              onChange={(e) => setResolveAlias(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              disabled={!resolveAlias}
              onClick={() => aliasResolve.mutate()}
            >
              Resolve
            </Button>
          </div>
          {canUpdate ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label>Alias</Label>
                <Input
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="ops"
                />
              </div>
              <div className="space-y-1">
                <Label>Room ID</Label>
                <Input
                  value={aliasRoomId}
                  onChange={(e) => setAliasRoomId(e.target.value)}
                  placeholder="!room:server"
                  className="min-w-[220px]"
                />
              </div>
              <Button
                disabled={!aliasInput || !aliasRoomId || aliasCreate.isPending}
                onClick={() => aliasCreate.mutate()}
              >
                Create alias
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create room or space</DialogTitle>
            <DialogDescription>
              Creates via the Client-Server API using the admin token.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
          >
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Input id="topic" {...form.register("topic")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alias">Alias localpart</Label>
              <Input id="alias" placeholder="general" {...form.register("alias")} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register("space")} />
              Create as space (m.space)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...form.register("encryption")}
                disabled={form.watch("space")}
              />
              Enable encryption
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoomTable({
  rooms,
  loading,
  empty = "No rooms found.",
}: {
  rooms: MatrixRoom[];
  loading: boolean;
  empty?: string;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Room</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={3}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : null}
          {!loading && rooms.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : null}
          {rooms.map((room) => (
            <TableRow key={room.room_id}>
              <TableCell>
                <Link
                  href={`/rooms/${encodeURIComponent(room.room_id)}`}
                  className="font-medium hover:underline"
                >
                  {room.name || room.canonical_alias || room.room_id}
                </Link>
                <div className="text-xs text-muted-foreground">{room.room_id}</div>
              </TableCell>
              <TableCell>{room.joined_members}</TableCell>
              <TableCell className="space-x-1">
                {(room as MatrixRoom & { room_type?: string }).room_type === "m.space" ? (
                  <Badge>Space</Badge>
                ) : null}
                {room.encryption ? (
                  <Badge variant="secondary">
                    <Lock className="mr-1 size-3" />
                    Encrypted
                  </Badge>
                ) : (
                  <Badge variant="outline">Unencrypted</Badge>
                )}
                {room.public ? <Badge>Public</Badge> : <Badge variant="outline">Private</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Pager({
  from,
  pageSize,
  total,
  setFrom,
  count,
}: {
  from: number;
  pageSize: number;
  total: number;
  setFrom: (n: number) => void;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {count === 0 ? 0 : from + 1}–{from + count} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={from === 0} onClick={() => setFrom(Math.max(0, from - pageSize))}>
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={from + pageSize >= total}
          onClick={() => setFrom(from + pageSize)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
