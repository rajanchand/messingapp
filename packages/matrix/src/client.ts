import type {
  CreateOrModifyUserBody,
  CreateRoomBody,
  CreateRoomResponse,
  DeleteRoomResponse,
  JoinedRoomsResponse,
  ListDevicesResponse,
  ListRoomMembersResponse,
  ListRoomsResponse,
  ListUsersParams,
  ListUsersResponse,
  ServerVersionResponse,
  SynapseRoomDetail,
  SynapseUserDetail,
  WhoisResponse,
} from "./types";

export class SynapseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errcode?: string,
  ) {
    super(message);
    this.name = "SynapseError";
  }
}

export interface SynapseClientOptions {
  /** Base URL of the homeserver, e.g. https://chat.zero-trust-security.org */
  baseUrl: string;
  /** Access token of a Synapse admin account. Server-side only. */
  adminToken: string;
  /** Injectable for testing. */
  fetchFn?: typeof fetch;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Max attempts for transient failures (429/5xx/network). */
  maxAttempts?: number;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Typed client for the Synapse Admin API. All calls are server-side; the
 * admin token must never reach a browser.
 */
export class SynapseClient {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(options: SynapseClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.adminToken = options.adminToken;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.fetchFn(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.adminToken}`,
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          const text = await response.text();
          return (text ? JSON.parse(text) : {}) as T;
        }

        let errcode: string | undefined;
        let message = `Synapse request failed with status ${response.status}`;
        try {
          const parsed = (await response.json()) as { errcode?: string; error?: string };
          errcode = parsed.errcode;
          if (parsed.error) message = parsed.error;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        const error = new SynapseError(message, response.status, errcode);
        if (!RETRYABLE_STATUS.has(response.status) || attempt === this.maxAttempts) {
          throw error;
        }
        lastError = error;
      } catch (err) {
        if (err instanceof SynapseError) {
          if (!RETRYABLE_STATUS.has(err.status) || attempt === this.maxAttempts) throw err;
          lastError = err;
        } else {
          // Network failure or timeout.
          if (attempt === this.maxAttempts) {
            throw new SynapseError(
              err instanceof Error ? err.message : "Network error contacting Synapse",
              0,
            );
          }
          lastError = err;
        }
      }
      await sleep(250 * 2 ** (attempt - 1));
    }
    // Unreachable, but satisfies the compiler.
    throw lastError instanceof Error ? lastError : new SynapseError("Synapse request failed", 0);
  }

  // --- Health / meta ---

  async getServerVersion(): Promise<ServerVersionResponse> {
    return this.request("GET", "/_synapse/admin/v1/server_version");
  }

  /** Synapse /health endpoint; returns true when the server responds OK. */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // --- Users ---

  async listUsers(params: ListUsersParams = {}): Promise<ListUsersResponse> {
    return this.request("GET", "/_synapse/admin/v2/users", {
      query: {
        from: params.from ?? 0,
        limit: params.limit ?? 25,
        name: params.name,
        guests: params.guests ?? false,
        deactivated: params.deactivated,
        admins: params.admins,
        order_by: params.order_by,
        dir: params.dir,
      },
    });
  }

  async getUser(userId: string): Promise<SynapseUserDetail> {
    return this.request("GET", `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`);
  }

  /** Creates the user if it does not exist, otherwise modifies it. */
  async createOrModifyUser(
    userId: string,
    body: CreateOrModifyUserBody,
  ): Promise<SynapseUserDetail> {
    return this.request("PUT", `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`, { body });
  }

  /** Deactivates an account. With erase=true, also erases per GDPR semantics. */
  async deactivateUser(userId: string, erase = false): Promise<void> {
    await this.request("POST", `/_synapse/admin/v1/deactivate/${encodeURIComponent(userId)}`, {
      body: { erase },
    });
  }

  async resetPassword(
    userId: string,
    newPassword: string,
    logoutDevices = true,
  ): Promise<void> {
    await this.request("POST", `/_synapse/admin/v1/reset_password/${encodeURIComponent(userId)}`, {
      body: { new_password: newPassword, logout_devices: logoutDevices },
    });
  }

  async whois(userId: string): Promise<WhoisResponse> {
    return this.request("GET", `/_synapse/admin/v1/whois/${encodeURIComponent(userId)}`);
  }

  // --- Devices ---

  async listDevices(userId: string): Promise<ListDevicesResponse> {
    return this.request("GET", `/_synapse/admin/v2/users/${encodeURIComponent(userId)}/devices`);
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/_synapse/admin/v2/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`,
    );
  }

  /** Deletes the given devices, invalidating their access tokens (logout). */
  async deleteDevices(userId: string, deviceIds: string[]): Promise<void> {
    await this.request(
      "POST",
      `/_synapse/admin/v2/users/${encodeURIComponent(userId)}/delete_devices`,
      { body: { devices: deviceIds } },
    );
  }

  /** Logs the user out everywhere by deleting all of their devices. */
  async logoutAllDevices(userId: string): Promise<number> {
    const { devices } = await this.listDevices(userId);
    if (devices.length === 0) return 0;
    await this.deleteDevices(
      userId,
      devices.map((d) => d.device_id),
    );
    return devices.length;
  }

  // --- Rooms ---

  async getUserJoinedRooms(userId: string): Promise<JoinedRoomsResponse> {
    return this.request(
      "GET",
      `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/joined_rooms`,
    );
  }

  async listRooms(
    params: { from?: number; limit?: number; search_term?: string } = {},
  ): Promise<ListRoomsResponse> {
    return this.request("GET", "/_synapse/admin/v1/rooms", {
      query: {
        from: params.from ?? 0,
        limit: params.limit ?? 25,
        search_term: params.search_term,
      },
    });
  }

  async getRoom(roomId: string): Promise<SynapseRoomDetail> {
    return this.request("GET", `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`);
  }

  async listRoomMembers(
    roomId: string,
    params: { from?: number; limit?: number } = {},
  ): Promise<ListRoomMembersResponse> {
    return this.request("GET", `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`, {
      query: {
        from: params.from ?? 0,
        limit: params.limit ?? 100,
      },
    });
  }

  /** Creates a room via the Client-Server API using the admin token. */
  async createRoom(body: CreateRoomBody): Promise<CreateRoomResponse> {
    const payload: Record<string, unknown> = {
      name: body.name,
      topic: body.topic,
      preset: body.preset ?? "private_chat",
      visibility: body.visibility ?? "private",
      invite: body.invite,
      room_alias_name: body.room_alias_name,
      room_version: body.room_version,
    };
    if (body.encryption) {
      payload.initial_state = [
        {
          type: "m.room.encryption",
          state_key: "",
          content: { algorithm: "m.megolm.v1.aes-sha2" },
        },
      ];
    }
    return this.request("POST", "/_matrix/client/v3/createRoom", { body: payload });
  }

  async deleteRoom(
    roomId: string,
    opts: { new_room_user_id?: string; block?: boolean; purge?: boolean; message?: string } = {},
  ): Promise<DeleteRoomResponse> {
    return this.request("DELETE", `/_synapse/admin/v2/rooms/${encodeURIComponent(roomId)}`, {
      body: {
        new_room_user_id: opts.new_room_user_id,
        block: opts.block ?? false,
        purge: opts.purge ?? true,
        message: opts.message ?? "Room closed by administrator",
      },
    });
  }

  async kickUser(roomId: string, userId: string, reason?: string): Promise<void> {
    await this.request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, {
      body: { user_id: userId, reason },
    });
  }

  async banUser(roomId: string, userId: string, reason?: string): Promise<void> {
    await this.request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/ban`, {
      body: { user_id: userId, reason },
    });
  }

  async unbanUser(roomId: string, userId: string): Promise<void> {
    await this.request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/unban`, {
      body: { user_id: userId },
    });
  }

  async inviteUser(roomId: string, userId: string): Promise<void> {
    await this.request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      body: { user_id: userId },
    });
  }

  async setRoomState(
    roomId: string,
    eventType: string,
    stateKey: string,
    content: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
      { body: content },
    );
  }

  async sendRoomMessage(roomId: string, body: string, msgtype = "m.text"): Promise<{ event_id: string }> {
    const txnId = `zts_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return this.request(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
      { body: { msgtype, body } },
    );
  }
}

let envClient: SynapseClient | undefined;

/** Singleton client configured from MATRIX_HOMESERVER / MATRIX_ADMIN_TOKEN. */
export function getSynapseClient(): SynapseClient {
  if (!envClient) {
    const baseUrl = process.env.MATRIX_HOMESERVER;
    const adminToken = process.env.MATRIX_ADMIN_TOKEN;
    if (!baseUrl) throw new Error("MATRIX_HOMESERVER is not set");
    if (!adminToken) throw new Error("MATRIX_ADMIN_TOKEN is not set");
    envClient = new SynapseClient({ baseUrl, adminToken });
  }
  return envClient;
}
