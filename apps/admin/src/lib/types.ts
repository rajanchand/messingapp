/** Shared client-side types mirroring API responses. */

export interface MatrixUser {
  name: string;
  displayname: string | null;
  avatar_url: string | null;
  admin: boolean;
  deactivated: boolean;
  locked: boolean;
  shadow_banned?: boolean;
  is_guest: boolean;
  user_type: string | null;
  creation_ts: number;
  last_seen_ts?: number | null;
}

export interface UsersListResponse {
  users: MatrixUser[];
  total: number;
  nextToken: string | null;
}

export interface UserDetailResponse {
  user: MatrixUser & {
    threepids?: { medium: string; address: string }[];
  };
  deviceCount: number;
  rooms: string[];
  roomCount: number;
  roles: { slug: string; name: string }[];
  profile?: {
    matrixUserId: string;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    employeeId: string | null;
    department: string | null;
    subdepartment: string | null;
    primaryRoleSlug: string | null;
  } | null;
}

export interface MatrixDevice {
  device_id: string;
  display_name: string | null;
  last_seen_ip: string | null;
  last_seen_ts: number | null;
}

export interface RoleInfo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  userAgent: string | null;
  result: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MatrixRoom {
  room_id: string;
  name: string | null;
  topic?: string | null;
  canonical_alias: string | null;
  joined_members: number;
  encryption: string | null;
  public: boolean;
  join_rules?: string | null;
  creator?: string;
  room_type?: string | null;
}

export interface RoomsListResponse {
  rooms: MatrixRoom[];
  total: number;
  nextFrom: number | null;
}

export interface RoomMember {
  user_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  membership: string;
}

export interface RoomDetailResponse {
  room: MatrixRoom;
  members: RoomMember[];
  memberCount: number;
}

export interface SecurityOverviewResponse {
  summary: {
    failedLogins24h: number;
    lockouts24h: number;
    activeSessions: number;
    ipBlocks: number;
  };
  events: {
    id: string;
    type: string;
    severity: string;
    userId: string | null;
    ip: string | null;
    metadata: unknown;
    createdAt: string;
  }[];
  sessions: {
    id: string;
    userId: string;
    username: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }[];
  ipBlocks: {
    id: string;
    cidr: string;
    reason: string | null;
    createdAt: string;
    expiresAt: string | null;
  }[];
  suspiciousIps: { ip: string; failures: number }[];
}
