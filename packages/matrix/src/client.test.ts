import { describe, expect, it, vi } from "vitest";
import { SynapseClient, SynapseError } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchFn: typeof fetch) {
  return new SynapseClient({
    baseUrl: "https://chat.example.org/",
    adminToken: "syt_test_token",
    fetchFn,
    maxAttempts: 3,
  });
}

describe("SynapseClient", () => {
  it("sends the admin token as a bearer header and normalizes the base URL", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ server_version: "1.100.0" }));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    const version = await client.getServerVersion();
    expect(version.server_version).toBe("1.100.0");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chat.example.org/_synapse/admin/v1/server_version");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer syt_test_token");
  });

  it("serializes list-user query parameters", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ users: [], total: 0 }));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    await client.listUsers({ from: 50, limit: 25, name: "jane", deactivated: true });

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/_synapse/admin/v2/users");
    expect(parsed.searchParams.get("from")).toBe("50");
    expect(parsed.searchParams.get("limit")).toBe("25");
    expect(parsed.searchParams.get("name")).toBe("jane");
    expect(parsed.searchParams.get("deactivated")).toBe("true");
  });

  it("maps Synapse error bodies to SynapseError", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ errcode: "M_NOT_FOUND", error: "User not found" }, 404),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);
    await expect(client.getUser("@missing:example.org")).rejects.toMatchObject({
      name: "SynapseError",
      status: 404,
      errcode: "M_NOT_FOUND",
    });
    // 404 is not retryable.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, 502))
      .mockResolvedValueOnce(jsonResponse({ server_version: "1.100.0" }));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    const version = await client.getServerVersion();
    expect(version.server_version).toBe("1.100.0");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts on persistent 5xx", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "down" }, 503));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    await expect(client.getServerVersion()).rejects.toBeInstanceOf(SynapseError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("URL-encodes user IDs in paths", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ name: "@jane:example.org" }));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    await client.getUser("@jane:example.org");
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain("/_synapse/admin/v2/users/%40jane%3Aexample.org");
  });

  it("logoutAllDevices deletes every device", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ devices: [{ device_id: "A" }, { device_id: "B" }], total: 2 }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    const count = await client.logoutAllDevices("@jane:example.org");
    expect(count).toBe(2);

    const [url, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/delete_devices");
    expect(JSON.parse(init.body as string)).toEqual({ devices: ["A", "B"] });
  });

  it("lists and fetches rooms via Admin API", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ rooms: [], total_rooms: 0, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse({ room_id: "!r:example.org", name: "Ops" }));
    const client = makeClient(fetchFn as unknown as typeof fetch);
    await client.listRooms({ from: 10, limit: 5, search_term: "ops" });
    await client.getRoom("!r:example.org");

    const listUrl = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(listUrl.pathname).toBe("/_synapse/admin/v1/rooms");
    expect(listUrl.searchParams.get("search_term")).toBe("ops");
    expect((fetchFn.mock.calls[1] as unknown as [string])[0]).toContain(
      "/_synapse/admin/v1/rooms/!r%3Aexample.org",
    );
  });

  it("creates encrypted rooms and moderates members", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ room_id: "!new:example.org" }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ kicked_users: 1, failed_to_kick_users: 0, local_aliases: [] }));
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await client.createRoom({ name: "Secure", encryption: true, invite: ["@bob:example.org"] });
    const [, createInit] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const createBody = JSON.parse(createInit.body as string) as {
      initial_state?: { type: string }[];
    };
    expect(createBody.initial_state?.[0]?.type).toBe("m.room.encryption");

    await client.kickUser("!new:example.org", "@bob:example.org", "spam");
    await client.banUser("!new:example.org", "@bob:example.org");
    await client.deleteRoom("!new:example.org", { purge: true });

    expect((fetchFn.mock.calls[1] as unknown as [string])[0]).toContain("/kick");
    expect((fetchFn.mock.calls[2] as unknown as [string])[0]).toContain("/ban");
    expect((fetchFn.mock.calls[3] as unknown as [string])[0]).toContain(
      "/_synapse/admin/v2/rooms/",
    );
  });
});
