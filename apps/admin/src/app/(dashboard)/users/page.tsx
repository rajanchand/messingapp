"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { MoreHorizontal, Plus, Search, ShieldCheck, UserX } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { usePermissions } from "@/lib/hooks/use-me";
import { formatDate, formatRelative } from "@/lib/utils";
import type { UsersListResponse, MatrixUser, RoleInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE = 25;

const createUserSchema = z.object({
  localpart: z
    .string()
    .min(1, "Username is required")
    .max(255)
    .regex(/^[a-z0-9._=/-]+$/, "Lowercase letters, digits and . _ = - / only"),
  displayName: z.string().min(1, "Name is required").max(256),
  email: z.string().email("Valid email is required").max(320),
  phone: z.string().max(32).optional(),
  employeeId: z.string().max(64).optional(),
  department: z.string().max(128).optional(),
  subdepartment: z.string().max(128).optional(),
  roleSlug: z.string().max(64).optional(),
  password: z.string().optional(),
  generateTemporary: z.boolean(),
  admin: z.boolean(),
  sendWelcomeEmail: z.boolean(),
}).superRefine((v, ctx) => {
  if (!v.generateTemporary && (!v.password || v.password.length < 12)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["password"],
      message: "At least 12 characters, or enable generate temporary password",
    });
  }
});
type CreateUserInput = z.infer<typeof createUserSchema>;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const canCreate = permissions.has("users.create");
  const canDisable = permissions.has("users.disable");
  const canErase = permissions.has("users.delete");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "deactivated" | "all">("active");
  const [from, setFrom] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MatrixUser | null>(null);
  const [eraseOnDeactivate, setEraseOnDeactivate] = useState(false);

  const debouncedSearch = useDebounced(search, 300);

  const usersQuery = useQuery({
    queryKey: ["users", { search: debouncedSearch, status, from }],
    queryFn: () =>
      api.get<UsersListResponse>(
        `/api/users?search=${encodeURIComponent(debouncedSearch)}&status=${status}&from=${from}&limit=${PAGE_SIZE}`,
      ),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"deactivate" | "revoke" | null>(null);

  const createForm = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      admin: false,
      sendWelcomeEmail: true,
      generateTemporary: true,
      roleSlug: "user",
      phone: "",
      employeeId: "",
      department: "",
      subdepartment: "",
      password: "",
    },
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<{ roles: RoleInfo[] }>("/api/roles"),
    enabled: createOpen && (permissions.has("roles.read") || canCreate),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateUserInput) =>
      api.post<{
        welcomeEmail?: { sent: boolean; skippedReason?: string; error?: string };
        temporaryPassword?: string;
      }>("/api/users", input),
    onSuccess: (data) => {
      const email = data.welcomeEmail;
      if (data.temporaryPassword) {
        toast.success("User created with temporary password.", {
          description: data.temporaryPassword,
          duration: 20_000,
        });
      } else if (email?.sent) {
        toast.success("User created. Welcome email sent with login details.");
      } else if (email?.skippedReason) {
        toast.success("User created.");
        toast.message("Welcome email skipped", { description: email.skippedReason });
      } else if (email?.error) {
        toast.success("User created.");
        toast.error(`Welcome email failed: ${email.error}`);
      } else {
        toast.success("User created.");
      }
      setCreateOpen(false);
      createForm.reset({
        admin: false,
        sendWelcomeEmail: true,
        generateTemporary: true,
        roleSlug: "user",
        phone: "",
        employeeId: "",
        department: "",
        subdepartment: "",
        password: "",
      });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create user.");
    },
  });

  async function runBulkAction() {
    const userIds = [...selected];
    if (userIds.length === 0 || !bulkAction) return;
    if (bulkAction === "deactivate") {
      const result = await api.post<{ status: string; approvalId?: string }>(
        "/api/users/bulk/deactivate",
        { userIds, erase: false },
      );
      toast.success(
        result.status === "pending_approval"
          ? "Mass deactivate queued for dual-approval."
          : "Bulk deactivate submitted.",
      );
    } else {
      const result = await api.post<{ status: string }>("/api/users/bulk/revoke-devices", {
        userIds,
      });
      toast.success(
        result.status === "pending_approval"
          ? "Device revoke queued for dual-approval."
          : "Devices revoked.",
      );
    }
    setSelected(new Set());
    setBulkAction(null);
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }
  async function deactivateUser(user: MatrixUser) {
    const result = await api.post<{ status: string; approvalId?: string; message?: string }>(
      `/api/users/${encodeURIComponent(user.name)}/deactivate`,
      { erase: eraseOnDeactivate },
    );
    if (result.status === "pending_approval") {
      toast.success("Erase queued for second-admin approval.", {
        description: "Open Approvals for a different admin to confirm.",
      });
    } else {
      toast.success(
        eraseOnDeactivate ? `${user.name} deactivated and erased.` : `${user.name} deactivated.`,
      );
    }
    setEraseOnDeactivate(false);
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;
  const roleOptions = rolesQuery.data?.roles ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Matrix accounts on your homeserver. {total > 0 ? `${total} total.` : ""}
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Create user
          </Button>
        ) : null}
      </div>

      {canDisable && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkAction("revoke")}>
            Revoke devices
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkAction("deactivate")}>
            Mass deactivate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search users…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFrom(0);
            }}
            aria-label="Search users"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setFrom(0);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deactivated">Deactivated</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canDisable ? <TableHead className="w-10" /> : null}
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Created</TableHead>
              <TableHead className="hidden md:table-cell">Last seen</TableHead>
              <TableHead className="w-10" aria-label="Actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={canDisable ? 6 : 5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canDisable ? 6 : 5}
                  className="h-32 text-center text-muted-foreground"
                >
                  {usersQuery.isError
                    ? "Failed to load users from the homeserver."
                    : "No users found."}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.name}>
                  {canDisable ? (
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={selected.has(user.name)}
                        disabled={user.deactivated}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(user.name);
                            else next.delete(user.name);
                            return next;
                          });
                        }}
                        aria-label={`Select ${user.name}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Link
                      href={`/users/${encodeURIComponent(user.name)}`}
                      className="group flex flex-col"
                    >
                      <span className="font-medium group-hover:underline">
                        {user.displayname || user.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{user.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.deactivated ? (
                        <Badge variant="destructive">Deactivated</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                      {user.admin ? (
                        <Badge variant="secondary">
                          <ShieldCheck className="mr-1 size-3" />
                          Admin
                        </Badge>
                      ) : null}
                      {user.locked ? <Badge variant="warning">Locked</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {formatDate(user.creation_ts)}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {user.last_seen_ts ? formatRelative(user.last_seen_ts) : "—"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${user.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/users/${encodeURIComponent(user.name)}`}>View details</Link>
                        </DropdownMenuItem>
                        {canDisable && !user.deactivated ? (
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={() => setDeactivateTarget(user)}
                          >
                            <UserX />
                            Deactivate
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {users.length === 0 ? 0 : from + 1}–{from + users.length} of {total}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={from === 0}
            onClick={() => setFrom(Math.max(0, from - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={from + PAGE_SIZE >= total}
            onClick={() => setFrom(from + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Creates a Matrix account and optionally emails the username and temporary
              password with Element X sign-in instructions.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))}
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="localpart">Username</Label>
                <Input id="localpart" placeholder="jane.doe" {...createForm.register("localpart")} />
                {createForm.formState.errors.localpart ? (
                  <p className="text-sm text-destructive">
                    {createForm.formState.errors.localpart.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="displayName">Name</Label>
                <Input
                  id="displayName"
                  placeholder="Jane Doe"
                  {...createForm.register("displayName")}
                />
                {createForm.formState.errors.displayName ? (
                  <p className="text-sm text-destructive">
                    {createForm.formState.errors.displayName.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jane.doe@company.org"
                  {...createForm.register("email")}
                />
                {createForm.formState.errors.email ? (
                  <p className="text-sm text-destructive">
                    {createForm.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 555 0100"
                  {...createForm.register("phone")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employeeId">Employee ID / identifier</Label>
                <Input
                  id="employeeId"
                  placeholder="EMP-1042"
                  {...createForm.register("employeeId")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  placeholder="Engineering"
                  {...createForm.register("department")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subdepartment">Sub-department</Label>
                <Input
                  id="subdepartment"
                  placeholder="Platform"
                  {...createForm.register("subdepartment")}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="roleSlug">Platform role</Label>
                <Select
                  value={createForm.watch("roleSlug") || "user"}
                  onValueChange={(v) => createForm.setValue("roleSlug", v)}
                >
                  <SelectTrigger id="roleSlug" aria-label="Platform role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.length === 0 ? (
                      <SelectItem value="user">User</SelectItem>
                    ) : (
                      roleOptions.map((role) => (
                        <SelectItem key={role.slug} value={role.slug}>
                          {role.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    {...createForm.register("generateTemporary")}
                  />
                  Generate temporary password automatically
                </label>
                {!createForm.watch("generateTemporary") ? (
                  <>
                    <Label htmlFor="new-password">Initial password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      {...createForm.register("password")}
                    />
                    {createForm.formState.errors.password ? (
                      <p className="text-sm text-destructive">
                        {createForm.formState.errors.password.message}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...createForm.register("admin")} />
              Grant Synapse server admin
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                {...createForm.register("sendWelcomeEmail")}
              />
              Email username &amp; password with Element X change-password instructions
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivateTarget(null);
            setEraseOnDeactivate(false);
          }
        }}
        title={`Deactivate ${deactivateTarget?.name}?`}
        description={
          <div className="space-y-3">
            <p>
              The user will be logged out of all devices and unable to sign in. This can be reversed
              later by reactivating the account with a new password.
            </p>
            {canErase ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={eraseOnDeactivate}
                  onChange={(e) => setEraseOnDeactivate(e.target.checked)}
                />
                <span>
                  Permanently erase profile data (GDPR). Queues dual-approval for a second
                  admin.{" "}
                  <span className="font-medium text-destructive">Irreversible once approved.</span>
                </span>
              </label>
            ) : null}
          </div>
        }
        confirmLabel={eraseOnDeactivate ? "Deactivate & erase" : "Deactivate"}
        destructive
        requireReauth
        onConfirm={() => (deactivateTarget ? deactivateUser(deactivateTarget) : Promise.resolve())}
      />

      <ConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => !open && setBulkAction(null)}
        title={
          bulkAction === "deactivate"
            ? `Mass deactivate ${selected.size} users?`
            : `Revoke devices for ${selected.size} users?`
        }
        description={
          bulkAction === "deactivate"
            ? "Creates a dual-approval request. A second admin must approve before Synapse deactivates these accounts."
            : selected.size >= 5
              ? "Large batch — queued for dual-approval."
              : "Logs out all devices for the selected users immediately (sudo)."
        }
        confirmLabel={bulkAction === "deactivate" ? "Request approval" : "Revoke devices"}
        destructive={bulkAction === "deactivate"}
        requireReauth
        onConfirm={runBulkAction}
      />
    </div>
  );
}
