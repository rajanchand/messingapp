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
import type { MatrixRoom, RoomsListResponse } from "@/lib/types";

const PAGE_SIZE = 25;

const createSchema = z.object({
  name: z.string().min(1).max(256),
  topic: z.string().max(1024).optional(),
  alias: z.string().max(255).optional(),
  visibility: z.enum(["public", "private"]),
  encryption: z.boolean(),
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
  const debouncedSearch = useDebounced(search, 300);

  const roomsQuery = useQuery({
    queryKey: ["rooms", { search: debouncedSearch, from }],
    queryFn: () =>
      api.get<RoomsListResponse>(
        `/api/rooms?search=${encodeURIComponent(debouncedSearch)}&from=${from}&limit=${PAGE_SIZE}`,
      ),
  });

  const form = useForm<CreateInput>({
    resolver: zodResolver(createSchema),
    defaultValues: { visibility: "private", encryption: true },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateInput) => api.post("/api/rooms", input),
    onSuccess: () => {
      toast.success("Room created.");
      setCreateOpen(false);
      form.reset({ visibility: "private", encryption: true });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create room.");
    },
  });

  const rooms = roomsQuery.data?.rooms ?? [];
  const total = roomsQuery.data?.total ?? 0;
  const canCreate = permissions.has("rooms.create");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-sm text-muted-foreground">
            Matrix rooms on your homeserver. {total} total.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create room
          </Button>
        ) : null}
      </div>

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
          aria-label="Search rooms"
        />
      </div>

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
            {roomsQuery.isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={3}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!roomsQuery.isLoading && rooms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No rooms found.
                </TableCell>
              </TableRow>
            ) : null}
            {rooms.map((room: MatrixRoom) => (
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {rooms.length === 0 ? 0 : from + 1}–{from + rooms.length} of {total}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={from === 0}
            onClick={() => setFrom(Math.max(0, from - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={from + PAGE_SIZE >= total}
            onClick={() => setFrom(from + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create room</DialogTitle>
            <DialogDescription>Creates a room via the Synapse Admin token.</DialogDescription>
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
              <input type="checkbox" {...form.register("encryption")} />
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
