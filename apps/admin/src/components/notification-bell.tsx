"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "@/lib/api/client";
import { formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api.get<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/api/notifications", { all: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unread > 0 ? (
            <button
              type="button"
              className="text-xs font-normal text-primary hover:underline"
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No notifications yet.
          </div>
        ) : (
          items.slice(0, 12).map((n) => (
            <DropdownMenuItem key={n.id} asChild className="flex flex-col items-start gap-0.5">
              {n.href ? (
                <Link href={n.href}>
                  <span className={`text-sm ${n.readAt ? "" : "font-medium"}`}>{n.title}</span>
                  {n.body ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelative(n.createdAt)}
                  </span>
                </Link>
              ) : (
                <div>
                  <span className={`text-sm ${n.readAt ? "" : "font-medium"}`}>{n.title}</span>
                  {n.body ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelative(n.createdAt)}
                  </span>
                </div>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
