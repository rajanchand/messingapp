"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  Blocks,
  Bot,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/hooks/use-me";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { Skeleton } from "@/components/ui/skeleton";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Zero Trust Security";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users, permission: "users.read" },
  { href: "/rooms", label: "Rooms", icon: MessagesSquare, permission: "rooms.read" },
  { href: "/security", label: "Security", icon: ShieldAlert, permission: "security.read" },
  { href: "/automation", label: "Automation", icon: Bot, permission: "automation.read" },
  { href: "/integrations", label: "Integrations", icon: Blocks, permission: "integrations.read" },
  { href: "/assistant", label: "Assistant", icon: Bot, permission: "settings.read" },
  { href: "/audit", label: "Audit Logs", icon: ScrollText, permission: "audit.read" },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, isLoading, isError } = useMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (isError) {
      router.replace("/login");
    }
  }, [isError, router]);

  async function handleLogout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Session may already be gone; proceed to login either way.
    }
    toast.success("Signed out.");
    router.replace("/login");
    router.refresh();
  }

  const permissions = new Set(me?.permissions ?? []);
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || permissions.has(item.permission),
  );

  const initials = (me?.user.displayName || me?.user.username || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main navigation">
      {visibleItems.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-card px-4">
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Toggle navigation"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <Menu className="size-5" />
        </Button>
        <Link href="/" className="flex items-center gap-2">
          <Image src="/branding/logo.svg" alt="" width={28} height={28} />
          <span className="hidden font-semibold tracking-tight sm:inline">{APP_NAME}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <ThemeToggle />
          {isLoading ? (
            <Skeleton className="size-8 rounded-full" />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Account menu" className="rounded-full outline-none ring-ring focus-visible:ring-2">
                  <Avatar>
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">
                    {me?.user.displayName ?? me?.user.username}
                  </div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {me?.roles.map((r) => r.name).join(", ") || "No roles"}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/settings")}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={cn(
            // Admin console: keep the full nav visible from sm and up so
            // Rooms/Security/Automation/Integrations stay clickable on laptops.
            "fixed inset-y-14 left-0 z-30 w-60 shrink-0 border-r bg-sidebar transition-transform sm:static sm:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {nav}
        </aside>
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-20 bg-black/40 sm:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        ) : null}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
