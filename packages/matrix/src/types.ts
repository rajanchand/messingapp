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
  user_type?: string | null;
}

export interface ListRoomsParams {
  from?: number;
  limit?: number;
  search_term?: string;
  order_by?: string;
  dir?: "f" | "b";
}
