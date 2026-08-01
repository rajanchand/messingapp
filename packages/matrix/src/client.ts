import type {
  CreateOrModifyUserBody,
  CreateRoomBody,
  CreateRoomResponse,
  DeleteRoomResponse,
  EventReportDetail,
  FederationDestination,
  HomeserverPolicySnapshot,
  JoinedRoomsResponse,
  ListDevicesResponse,
  ListEventReportsResponse,
  ListFederationDestinationsResponse,
  ListMediaResponse,
  ListRoomMembersResponse,
  ListRoomsResponse,
  ListUsersParams,
  ListUsersResponse,
  PublicRoomsResponse,
  ResolveAliasResponse,
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
    const creationContent: Record<string, unknown> = {
      ...(body.creation_content ?? {}),
    };
    if (body.space) {
      creationContent.type = "m.space";
    }
    const payload: Record<string, unknown> = {
      name: body.name,
      topic: body.topic,
      preset: body.preset ?? "private_chat",
      visibility: body.visibility ?? "private",
      invite: body.invite,
      room_alias_name: body.room_alias_name,
      room_version: body.room_version,
    };
    if (Object.keys(creationContent).length > 0) {
      payload.creation_content = creationContent;
    }
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

  /** Convenience wrapper for space creation. */
  async createSpace(
    body: Omit<CreateRoomBody, "space"> & { space?: boolean },
  ): Promise<CreateRoomResponse> {
    return this.createRoom({ ...body, space: true, encryption: body.encryption ?? false });
  }

  // --- Public room directory / aliases ---

  async listPublicRooms(
    params: { limit?: number; since?: string; server?: string } = {},
  ): Promise<PublicRoomsResponse> {
    return this.request("GET", "/_matrix/client/v3/publicRooms", {
      query: {
        limit: params.limit ?? 25,
        since: params.since,
        server: params.server,
      },
    });
  }

  async setRoomDirectoryVisibility(
    roomId: string,
    visibility: "public" | "private",
  ): Promise<void> {
    await this.request(
      "PUT",
      `/_matrix/client/v3/directory/list/room/${encodeURIComponent(roomId)}`,
      { body: { visibility } },
    );
  }

  async getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: string }> {
    return this.request(
      "GET",
      `/_matrix/client/v3/directory/list/room/${encodeURIComponent(roomId)}`,
    );
  }

  async resolveAlias(alias: string): Promise<ResolveAliasResponse> {
    return this.request(
      "GET",
      `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
    );
  }

  async createAlias(alias: string, roomId: string): Promise<void> {
    await this.request("PUT", `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`, {
      body: { room_id: roomId },
    });
  }

  async deleteAlias(alias: string): Promise<void> {
    await this.request(
      "DELETE",
      `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
    );
  }

  /**
   * Best-effort homeserver policy snapshot. Real Synapse does not expose
   * homeserver.yaml via Admin API; mock servers return a synthetic policy.
   * Falls back to version + panel defaults when the endpoint is missing.
   */
  async getHomeserverPolicy(): Promise<HomeserverPolicySnapshot> {
    const version = await this.getServerVersion();
    try {
      const policy = await this.request<{
        registration_enabled?: boolean;
        federation_enabled?: boolean;
        guests_allowed?: boolean;
        public_room_directory_enabled?: boolean;
        rate_limits?: {
          messages_per_second?: number;
          registration_per_second?: number;
          login_per_second?: number;
          notes?: string;
        };
        source?: "synapse" | "mock" | "panel";
      }>("GET", "/_synapse/admin/v1/homeserver_policy");
      return {
        serverVersion: version.server_version,
        registrationEnabled: policy.registration_enabled ?? true,
        federationEnabled: policy.federation_enabled ?? true,
        guestsAllowed: policy.guests_allowed ?? false,
        publicRoomDirectoryEnabled: policy.public_room_directory_enabled ?? true,
        rateLimitSummary: {
          messagesPerSecond: policy.rate_limits?.messages_per_second,
          registrationPerSecond: policy.rate_limits?.registration_per_second,
          loginPerSecond: policy.rate_limits?.login_per_second,
          notes: policy.rate_limits?.notes,
        },
        source: policy.source ?? "synapse",
      };
    } catch (err) {
      if (err instanceof SynapseError && (err.status === 404 || err.errcode === "M_UNRECOGNIZED")) {
        return {
          serverVersion: version.server_version,
          registrationEnabled: true,
          federationEnabled: true,
          guestsAllowed: false,
          publicRoomDirectoryEnabled: true,
          rateLimitSummary: {
            notes:
              "Synapse Admin API does not expose homeserver.yaml. Use panel preferences + operator config sync.",
          },
          source: "panel",
        };
      }
      throw err;
    }
  }

  /** Mock / experimental: persist panel policy on servers that expose the endpoint. */
  async putHomeserverPolicy(policy: {
    registration_enabled?: boolean;
    federation_enabled?: boolean;
    guests_allowed?: boolean;
    public_room_directory_enabled?: boolean;
    rate_limits?: Record<string, unknown>;
  }): Promise<void> {
    await this.request("PUT", "/_synapse/admin/v1/homeserver_policy", { body: policy });
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

  // --- Event reports ---

  async listEventReports(
    params: {
      from?: number;
      limit?: number;
      dir?: "f" | "b";
      user_id?: string;
      room_id?: string;
    } = {},
  ): Promise<ListEventReportsResponse> {
    return this.request("GET", "/_synapse/admin/v1/event_reports", {
      query: {
        from: params.from ?? 0,
        limit: params.limit ?? 25,
        dir: params.dir,
        user_id: params.user_id,
        room_id: params.room_id,
      },
    });
  }

  async getEventReport(reportId: string | number): Promise<EventReportDetail> {
    return this.request("GET", `/_synapse/admin/v1/event_reports/${encodeURIComponent(String(reportId))}`);
  }

  async deleteEventReport(reportId: string | number): Promise<void> {
    await this.request(
      "DELETE",
      `/_synapse/admin/v1/event_reports/${encodeURIComponent(String(reportId))}`,
    );
  }

  // --- Media ---

  async listUserMedia(userId: string): Promise<ListMediaResponse> {
    return this.request(
      "GET",
      `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/media`,
    );
  }

  async listRoomMedia(roomId: string): Promise<ListMediaResponse> {
    return this.request(
      "GET",
      `/_synapse/admin/v1/room/${encodeURIComponent(roomId)}/media`,
    );
  }

  async quarantineMedia(serverName: string, mediaId: string): Promise<void> {
    await this.request(
      "POST",
      `/_synapse/admin/v1/media/quarantine/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
      { body: {} },
    );
  }

  async unquarantineMedia(serverName: string, mediaId: string): Promise<void> {
    await this.request(
      "POST",
      `/_synapse/admin/v1/media/unquarantine/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
      { body: {} },
    );
  }

  async deleteMedia(serverName: string, mediaId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/_synapse/admin/v1/media/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
    );
  }

  // --- Shadow ban / lock ---

  async setShadowBan(userId: string, shadowBanned: boolean): Promise<SynapseUserDetail> {
    return this.createOrModifyUser(userId, { shadow_banned: shadowBanned });
  }

  async setUserLocked(userId: string, locked: boolean): Promise<SynapseUserDetail> {
    return this.createOrModifyUser(userId, { locked });
  }

  // --- Federation ---

  async listFederationDestinations(
    params: { from?: number; limit?: number } = {},
  ): Promise<ListFederationDestinationsResponse> {
    return this.request("GET", "/_synapse/admin/v1/federation/destinations", {
      query: {
        from: params.from ?? 0,
        limit: params.limit ?? 25,
      },
    });
  }

  async getFederationDestination(destination: string): Promise<FederationDestination> {
    return this.request(
      "GET",
      `/_synapse/admin/v1/federation/destinations/${encodeURIComponent(destination)}`,
    );
  }

  // --- Server notices / room admin / power levels ---

  async sendServerNotice(
    userId: string,
    content: { body: string; msgtype?: string },
  ): Promise<{ event_id: string }> {
    return this.request("POST", "/_synapse/admin/v1/send_server_notice", {
      body: {
        user_id: userId,
        content: {
          msgtype: content.msgtype ?? "m.text",
          body: content.body,
        },
      },
    });
  }

  async makeRoomAdmin(roomId: string, userId: string): Promise<void> {
    await this.request(
      "POST",
      `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/make_room_admin`,
      { body: { user_id: userId } },
    );
  }

  async setRoomPowerLevels(
    roomId: string,
    content: Record<string, unknown>,
  ): Promise<void> {
    await this.setRoomState(roomId, "m.room.power_levels", "", content);
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
