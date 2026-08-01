/** Types for the Synapse Admin API responses we consume. */

export interface SynapseUser {
  name: string;
  displayname: string | null;
  avatar_url: string | null;
  admin: boolean;
  deactivated: boolean;
  locked: boolean;
  is_guest: boolean;
  user_type: string | null;
  erased?: boolean;
  shadow_banned?: boolean;
  creation_ts: number;
  last_seen_ts?: number | null;
}

export interface SynapseUserDetail extends SynapseUser {
  threepids?: { medium: string; address: string; added_at: number; validated_at: number }[];
  external_ids?: { auth_provider: string; external_id: string }[];
  consent_version?: string | null;
}

export interface ListUsersResponse {
  users: SynapseUser[];
  next_token?: string;
  total: number;
}

export interface SynapseDevice {
  device_id: string;
  display_name: string | null;
  last_seen_ip: string | null;
  last_seen_ts: number | null;
  user_id: string;
}

export interface ListDevicesResponse {
  devices: SynapseDevice[];
  total: number;
}

export interface WhoisResponse {
  user_id: string;
  devices: Record<
    string,
    {
      sessions: {
        connections: { ip: string; last_seen: number; user_agent: string }[];
      }[];
    }
  >;
}

export interface SynapseRoom {
  room_id: string;
  name: string | null;
  canonical_alias: string | null;
  joined_members: number;
  joined_local_members: number;
  version: string;
  creator: string;
  encryption: string | null;
  federatable: boolean;
  public: boolean;
  join_rules: string | null;
  guest_access: string | null;
  history_visibility: string | null;
  state_events: number;
  room_type?: string | null;
  topic?: string | null;
}

export interface ListRoomsResponse {
  rooms: SynapseRoom[];
  offset: number;
  total_rooms: number;
  next_batch?: number;
  prev_batch?: number;
}

export interface SynapseRoomDetail extends SynapseRoom {
  aliases?: string[];
  avatar?: string | null;
}

export interface RoomMember {
  user_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  membership: "join" | "invite" | "leave" | "ban" | "knock" | string;
}

export interface ListRoomMembersResponse {
  members: RoomMember[];
  total: number;
}

export interface CreateRoomBody {
  name?: string;
  topic?: string;
  preset?: "private_chat" | "public_chat" | "trusted_private_chat";
  room_alias_name?: string;
  visibility?: "public" | "private";
  invite?: string[];
  encryption?: boolean;
  room_version?: string;
  /** When true, creates an `m.space` room. */
  space?: boolean;
  creation_content?: Record<string, unknown>;
}

export interface CreateRoomResponse {
  room_id: string;
}

export interface DeleteRoomResponse {
  kicked_users: number;
  failed_to_kick_users: number;
  local_aliases: string[];
  new_room_id?: string;
}

export interface PublicRoom {
  room_id: string;
  name?: string | null;
  topic?: string | null;
  canonical_alias?: string | null;
  num_joined_members: number;
  world_readable: boolean;
  guest_can_join: boolean;
  join_rule?: string | null;
  avatar_url?: string | null;
  room_type?: string | null;
}

export interface PublicRoomsResponse {
  chunk: PublicRoom[];
  next_batch?: string;
  total_room_count_estimate?: number;
}

export interface ResolveAliasResponse {
  room_id: string;
  servers: string[];
}

export interface HomeserverPolicySnapshot {
  serverVersion: string;
  /** Panel-side / mock signals — Synapse does not expose full config via Admin API. */
  registrationEnabled: boolean;
  federationEnabled: boolean;
  guestsAllowed: boolean;
  publicRoomDirectoryEnabled: boolean;
  rateLimitSummary: {
    messagesPerSecond?: number;
    registrationPerSecond?: number;
    loginPerSecond?: number;
    notes?: string;
  };
  source: "synapse" | "mock" | "panel";
}

export interface ServerVersionResponse {
  server_version: string;
}

export interface JoinedRoomsResponse {
  joined_rooms: string[];
  total: number;
}

export interface ListUsersParams {
  from?: number;
  limit?: number;
  /** Substring match against user ID localpart and display name. */
  name?: string;
  guests?: boolean;
  deactivated?: boolean;
  admins?: boolean;
  order_by?:
    | "name"
    | "displayname"
    | "is_guest"
    | "admin"
    | "deactivated"
    | "creation_ts"
    | "last_seen_ts";
  dir?: "f" | "b";
}

export interface CreateOrModifyUserBody {
  password?: string;
  logout_devices?: boolean;
  displayname?: string;
  avatar_url?: string;
  threepids?: { medium: string; address: string }[];
  admin?: boolean;
  deactivated?: boolean;
  locked?: boolean;
  shadow_banned?: boolean;
  user_type?: string | null;
}

export interface EventReportSummary {
  id: number;
  user_id: string;
  room_id: string | null;
  event_id: string | null;
  score: number | null;
  reason: string | null;
  received_ts: number;
}

export interface ListEventReportsResponse {
  event_reports: EventReportSummary[];
  total: number;
  next_token?: string;
}

export interface EventReportDetail extends EventReportSummary {
  sender?: string | null;
  event_json?: Record<string, unknown>;
}

export interface MediaInfo {
  media_id: string;
  media_type?: string | null;
  media_length?: number | null;
  upload_name?: string | null;
  created_ts?: number | null;
  last_access_ts?: number | null;
  quarantined_by?: string | null;
  safe_from_quarantine?: boolean;
}

export interface ListMediaResponse {
  local?: MediaInfo[];
  remote?: MediaInfo[];
  total?: number;
}

export interface FederationDestination {
  destination: string;
  retry_last_ts?: number | null;
  retry_interval?: number | null;
  failure_ts?: number | null;
  last_successful_stream_ordering?: number | null;
}

export interface ListFederationDestinationsResponse {
  destinations: FederationDestination[];
  total: number;
  next_token?: string;
}

export interface ListRoomsParams {
  from?: number;
  limit?: number;
  search_term?: string;
  order_by?: string;
  dir?: "f" | "b";
}
