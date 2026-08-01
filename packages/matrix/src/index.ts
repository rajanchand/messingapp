export { SynapseClient, SynapseError, getSynapseClient, type SynapseClientOptions } from "./client";
export type {
  SynapseUser,
  SynapseUserDetail,
  ListUsersResponse,
  ListUsersParams,
  CreateOrModifyUserBody,
  SynapseDevice,
  ListDevicesResponse,
  WhoisResponse,
  SynapseRoom,
  SynapseRoomDetail,
  ListRoomsResponse,
  ListRoomsParams,
  ListRoomMembersResponse,
  RoomMember,
  CreateRoomBody,
  CreateRoomResponse,
  DeleteRoomResponse,
  ServerVersionResponse,
  JoinedRoomsResponse,
} from "./types";

/** Builds a full Matrix ID from a localpart and the configured server name. */
export function buildMatrixUserId(localpart: string, serverName: string): string {
  return `@${localpart.toLowerCase()}:${serverName}`;
}

/** Validates a Matrix localpart per the spec's historical user ID grammar. */
export function isValidLocalpart(localpart: string): boolean {
  return /^[a-z0-9._=/-]{1,255}$/.test(localpart);
}
