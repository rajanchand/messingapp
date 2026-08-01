/**
 * Minimal mock of the Synapse Admin API for local development, so the admin
 * app can be exercised end-to-end without a real homeserver.
 *
 * Usage:
 *   node scripts/mock-synapse.mjs                # listens on :8018
 *   MOCK_SYNAPSE_PORT=9000 node scripts/mock-synapse.mjs
 *
 * Point the app at it with:
 *   MATRIX_HOMESERVER=http://localhost:8018
 *   MATRIX_ADMIN_TOKEN=mock-admin-token
 *
 * This is a development tool only. It keeps everything in memory and
 * implements just the endpoints packages/matrix uses.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.MOCK_SYNAPSE_PORT ?? 8018);
const TOKEN = process.env.MOCK_SYNAPSE_TOKEN ?? "mock-admin-token";
const SERVER_NAME = process.env.MOCK_SYNAPSE_SERVER_NAME ?? "chat.zero-trust-security.org";

/** @type {Map<string, any>} */
const users = new Map();
/** @type {Map<string, any[]>} */
const devices = new Map();
/** @type {Map<string, any>} */
const rooms = new Map();
/** @type {Map<string, Map<string, any>>} roomId -> userId -> membership */
const roomMembers = new Map();
/** @type {Map<number, any>} */
const eventReports = new Map();
/** @type {Map<string, any>} media key = server/mediaId */
const mediaStore = new Map();
/** @type {Map<string, any>} */
const federationDestinations = new Map();
/** @type {Map<string, string>} alias -> roomId */
const aliases = new Map();
/** @type {Map<string, string>} roomId -> public|private */
const directoryVisibility = new Map();
/** Mutable mock homeserver policy */
let homeserverPolicy = {
  registration_enabled: false,
  federation_enabled: true,
  guests_allowed: false,
  public_room_directory_enabled: true,
  rate_limits: {
    messages_per_second: 10,
    registration_per_second: 1,
    login_per_second: 5,
    notes: "Mock Synapse policy — editable via Admin API.",
  },
};
let nextReportId = 1;

function seedUser(localpart, { admin = false, deactivated = false, displayname } = {}) {
  const userId = `@${localpart}:${SERVER_NAME}`;
  users.set(userId, {
    name: userId,
    displayname: displayname ?? localpart,
    threepids: [],
    avatar_url: null,
    admin,
    deactivated,
    erased: false,
    shadow_banned: false,
    creation_ts: Math.floor(Date.now() / 1000) - 86_400,
    user_type: null,
    locked: false,
  });
  devices.set(userId, [
    {
      device_id: `DEV${localpart.toUpperCase()}1`,
      display_name: "Element X (iOS)",
      last_seen_ip: "203.0.113.10",
      last_seen_ts: Date.now() - 3_600_000,
      user_id: userId,
    },
  ]);
}

function seedRoom(localpart, { name, encryption = true, members = [] } = {}) {
  const roomId = `!${localpart}:${SERVER_NAME}`;
  const creator = `@alice:${SERVER_NAME}`;
  rooms.set(roomId, {
    room_id: roomId,
    name: name ?? localpart,
    canonical_alias: `#${localpart}:${SERVER_NAME}`,
    topic: `${name ?? localpart} room`,
    avatar: null,
    joined_members: 0,
    joined_local_members: 0,
    version: "10",
    creator,
    encryption: encryption ? "m.megolm.v1.aes-sha2" : null,
    federatable: true,
    public: false,
    join_rules: "invite",
    guest_access: "can_join",
    history_visibility: "joined",
    state_events: 12,
    room_type: null,
  });
  const memberMap = new Map();
  for (const userId of members.length ? members : [creator, `@bob:${SERVER_NAME}`]) {
    memberMap.set(userId, {
      user_id: userId,
      display_name: users.get(userId)?.displayname ?? userId,
      avatar_url: null,
      membership: "join",
    });
  }
  roomMembers.set(roomId, memberMap);
  syncRoomCounts(roomId);
}

function syncRoomCounts(roomId) {
  const room = rooms.get(roomId);
  const members = roomMembers.get(roomId);
  if (!room || !members) return;
  const joined = [...members.values()].filter((m) => m.membership === "join");
  room.joined_members = joined.length;
  room.joined_local_members = joined.filter((m) => m.user_id.endsWith(`:${SERVER_NAME}`)).length;
}

seedUser("alice", { admin: true, displayname: "Alice" });
seedUser("bob", { displayname: "Bob" });
seedUser("carol", { displayname: "Carol", deactivated: true });
seedRoom("general", { name: "General" });
seedRoom("ops", { name: "Ops", encryption: false });
// Seed public directory + alias map from seeded rooms
for (const [roomId, room] of rooms) {
  if (room.canonical_alias) aliases.set(room.canonical_alias, roomId);
  directoryVisibility.set(roomId, room.public ? "public" : "private");
}
// Make general public for directory demos
{
  const general = rooms.get(`!general:${SERVER_NAME}`);
  if (general) {
    general.public = true;
    directoryVisibility.set(general.room_id, "public");
  }
}

eventReports.set(nextReportId, {
  id: nextReportId,
  user_id: `@bob:${SERVER_NAME}`,
  room_id: `!general:${SERVER_NAME}`,
  event_id: `$evt_report_1`,
  score: -100,
  reason: "Spam",
  received_ts: Date.now() - 86_400_000,
  sender: `@carol:${SERVER_NAME}`,
  event_json: { type: "m.room.message", content: { body: "[redacted]" } },
});
nextReportId += 1;
eventReports.set(nextReportId, {
  id: nextReportId,
  user_id: `@alice:${SERVER_NAME}`,
  room_id: `!ops:${SERVER_NAME}`,
  event_id: `$evt_report_2`,
  score: -50,
  reason: "Harassment",
  received_ts: Date.now() - 3_600_000,
  sender: `@bob:${SERVER_NAME}`,
  event_json: { type: "m.room.message", content: { body: "[redacted]" } },
});

mediaStore.set(`${SERVER_NAME}/abc123`, {
  media_id: "abc123",
  media_type: "image/png",
  media_length: 12_345,
  upload_name: "avatar.png",
  created_ts: Date.now() - 7_200_000,
  quarantined_by: null,
  user_id: `@alice:${SERVER_NAME}`,
  room_id: `!general:${SERVER_NAME}`,
});
mediaStore.set(`${SERVER_NAME}/def456`, {
  media_id: "def456",
  media_type: "image/jpeg",
  media_length: 99_000,
  upload_name: "photo.jpg",
  created_ts: Date.now() - 1_800_000,
  quarantined_by: `@alice:${SERVER_NAME}`,
  user_id: `@bob:${SERVER_NAME}`,
  room_id: `!ops:${SERVER_NAME}`,
});

federationDestinations.set("matrix.org", {
  destination: "matrix.org",
  retry_last_ts: null,
  retry_interval: null,
  failure_ts: null,
  last_successful_stream_ordering: 1000,
});
federationDestinations.set("example.com", {
  destination: "example.com",
  retry_last_ts: Date.now() - 60_000,
  retry_interval: 60_000,
  failure_ts: Date.now() - 120_000,
  last_successful_stream_ordering: null,
});

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { errcode: "M_NOT_FOUND", error: "Not found" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    json(res, 401, { errcode: "M_UNKNOWN_TOKEN", error: "Invalid access token" });
    return;
  }

  try {
    if (req.method === "GET" && path === "/_synapse/admin/v1/server_version") {
      json(res, 200, { server_version: "1.120.0 (mock)" });
      return;
    }

    if (req.method === "GET" && path === "/_synapse/admin/v2/users") {
      const from = Number(url.searchParams.get("from") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const name = url.searchParams.get("name")?.toLowerCase();
      const deactivatedParam = url.searchParams.get("deactivated");

      let all = [...users.values()];
      if (name) {
        all = all.filter(
          (u) =>
            u.name.toLowerCase().includes(name) ||
            (u.displayname ?? "").toLowerCase().includes(name),
        );
      }
      // Synapse semantics: deactivated=true includes deactivated users,
      // otherwise only active users are returned.
      if (deactivatedParam !== "true") {
        all = all.filter((u) => !u.deactivated);
      }
      const page = all.slice(from, from + limit);
      const body = { users: page, total: all.length };
      if (from + limit < all.length) body.next_token = String(from + limit);
      json(res, 200, body);
      return;
    }

    const userMatch = path.match(/^\/_synapse\/admin\/v2\/users\/([^/]+)$/);
    if (userMatch) {
      const userId = decodeURIComponent(userMatch[1]);
      if (req.method === "GET") {
        const user = users.get(userId);
        if (!user) return notFound(res);
        json(res, 200, user);
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        const existing = users.get(userId);
        const user = existing ?? {
          name: userId,
          displayname: userId.slice(1).split(":")[0],
          threepids: [],
          avatar_url: null,
          admin: false,
          deactivated: false,
          erased: false,
          shadow_banned: false,
          creation_ts: Math.floor(Date.now() / 1000),
          user_type: null,
          locked: false,
        };
        if (body.displayname !== undefined) user.displayname = body.displayname;
        if (body.admin !== undefined) user.admin = body.admin;
        if (body.deactivated !== undefined) user.deactivated = body.deactivated;
        if (body.locked !== undefined) user.locked = body.locked;
        if (body.shadow_banned !== undefined) user.shadow_banned = body.shadow_banned;
        if (body.threepids !== undefined) {
          user.threepids = Array.isArray(body.threepids)
            ? body.threepids.map((t) => ({
                medium: t.medium,
                address: t.address,
                added_at: Date.now(),
                validated_at: Date.now(),
              }))
            : [];
        }
        users.set(userId, user);
        if (!devices.has(userId)) devices.set(userId, []);
        json(res, existing ? 200 : 201, user);
        return;
      }
    }

    const deactivateMatch = path.match(/^\/_synapse\/admin\/v1\/deactivate\/([^/]+)$/);
    if (req.method === "POST" && deactivateMatch) {
      const userId = decodeURIComponent(deactivateMatch[1]);
      const user = users.get(userId);
      if (!user) return notFound(res);
      user.deactivated = true;
      devices.set(userId, []);
      json(res, 200, { id_server_unbind_result: "success" });
      return;
    }

    const resetMatch = path.match(/^\/_synapse\/admin\/v1\/reset_password\/([^/]+)$/);
    if (req.method === "POST" && resetMatch) {
      const userId = decodeURIComponent(resetMatch[1]);
      if (!users.has(userId)) return notFound(res);
      await readBody(req);
      json(res, 200, {});
      return;
    }

    const whoisMatch = path.match(/^\/_synapse\/admin\/v1\/whois\/([^/]+)$/);
    if (req.method === "GET" && whoisMatch) {
      const userId = decodeURIComponent(whoisMatch[1]);
      if (!users.has(userId)) return notFound(res);
      json(res, 200, { user_id: userId, devices: {} });
      return;
    }

    const devicesMatch = path.match(/^\/_synapse\/admin\/v2\/users\/([^/]+)\/devices$/);
    if (req.method === "GET" && devicesMatch) {
      const userId = decodeURIComponent(devicesMatch[1]);
      if (!users.has(userId)) return notFound(res);
      const list = devices.get(userId) ?? [];
      json(res, 200, { devices: list, total: list.length });
      return;
    }

    const deleteDevicesMatch = path.match(
      /^\/_synapse\/admin\/v2\/users\/([^/]+)\/delete_devices$/,
    );
    if (req.method === "POST" && deleteDevicesMatch) {
      const userId = decodeURIComponent(deleteDevicesMatch[1]);
      if (!users.has(userId)) return notFound(res);
      const body = await readBody(req);
      const remove = new Set(body.devices ?? []);
      devices.set(userId, (devices.get(userId) ?? []).filter((d) => !remove.has(d.device_id)));
      json(res, 200, {});
      return;
    }

    const deviceMatch = path.match(/^\/_synapse\/admin\/v2\/users\/([^/]+)\/devices\/([^/]+)$/);
    if (req.method === "DELETE" && deviceMatch) {
      const userId = decodeURIComponent(deviceMatch[1]);
      const deviceId = decodeURIComponent(deviceMatch[2]);
      if (!users.has(userId)) return notFound(res);
      devices.set(userId, (devices.get(userId) ?? []).filter((d) => d.device_id !== deviceId));
      json(res, 200, {});
      return;
    }

    const joinedRoomsMatch = path.match(/^\/_synapse\/admin\/v1\/users\/([^/]+)\/joined_rooms$/);
    if (req.method === "GET" && joinedRoomsMatch) {
      const userId = decodeURIComponent(joinedRoomsMatch[1]);
      if (!users.has(userId)) return notFound(res);
      const joined = [];
      for (const [roomId, members] of roomMembers) {
        if (members.get(userId)?.membership === "join") joined.push(roomId);
      }
      json(res, 200, { joined_rooms: joined, total: joined.length });
      return;
    }

    if (req.method === "GET" && path === "/_synapse/admin/v1/rooms") {
      const from = Number(url.searchParams.get("from") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const search = url.searchParams.get("search_term")?.toLowerCase();
      let all = [...rooms.values()];
      if (search) {
        all = all.filter(
          (r) =>
            (r.name ?? "").toLowerCase().includes(search) ||
            (r.canonical_alias ?? "").toLowerCase().includes(search) ||
            r.room_id.toLowerCase().includes(search),
        );
      }
      const page = all.slice(from, from + limit);
      json(res, 200, {
        rooms: page,
        total_rooms: all.length,
        offset: from,
        next_batch: from + limit < all.length ? from + limit : undefined,
      });
      return;
    }

    const roomAdminMatch = path.match(/^\/_synapse\/admin\/v1\/rooms\/([^/]+)$/);
    if (roomAdminMatch) {
      const roomId = decodeURIComponent(roomAdminMatch[1]);
      if (req.method === "GET") {
        const room = rooms.get(roomId);
        if (!room) return notFound(res);
        json(res, 200, room);
        return;
      }
    }

    const roomMembersMatch = path.match(/^\/_synapse\/admin\/v1\/rooms\/([^/]+)\/members$/);
    if (req.method === "GET" && roomMembersMatch) {
      const roomId = decodeURIComponent(roomMembersMatch[1]);
      if (!rooms.has(roomId)) return notFound(res);
      const from = Number(url.searchParams.get("from") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const all = [...(roomMembers.get(roomId)?.values() ?? [])];
      json(res, 200, { members: all.slice(from, from + limit), total: all.length });
      return;
    }

    const roomDeleteMatch = path.match(/^\/_synapse\/admin\/v2\/rooms\/([^/]+)$/);
    if (req.method === "DELETE" && roomDeleteMatch) {
      const roomId = decodeURIComponent(roomDeleteMatch[1]);
      if (!rooms.has(roomId)) return notFound(res);
      await readBody(req);
      const members = roomMembers.get(roomId) ?? new Map();
      const kicked = [...members.values()].filter((m) => m.membership === "join").length;
      rooms.delete(roomId);
      roomMembers.delete(roomId);
      json(res, 200, {
        kicked_users: kicked,
        failed_to_kick_users: 0,
        local_aliases: [],
      });
      return;
    }

    if (req.method === "POST" && path === "/_matrix/client/v3/createRoom") {
      const body = await readBody(req);
      const localpart = body.room_alias_name || randomBytes(4).toString("hex");
      const roomId = `!${localpart}:${SERVER_NAME}`;
      const creator = `@alice:${SERVER_NAME}`;
      const encryption =
        Array.isArray(body.initial_state) &&
        body.initial_state.some((e) => e.type === "m.room.encryption");
      const roomType = body.creation_content?.type === "m.space" ? "m.space" : null;
      rooms.set(roomId, {
        room_id: roomId,
        name: body.name ?? null,
        canonical_alias: body.room_alias_name ? `#${body.room_alias_name}:${SERVER_NAME}` : null,
        topic: body.topic ?? null,
        avatar: null,
        joined_members: 1,
        joined_local_members: 1,
        version: body.room_version ?? "10",
        creator,
        encryption: encryption ? "m.megolm.v1.aes-sha2" : null,
        federatable: true,
        public: body.visibility === "public",
        join_rules: body.preset === "public_chat" ? "public" : "invite",
        guest_access: "can_join",
        history_visibility: "joined",
        state_events: 8,
        room_type: roomType,
        aliases: body.room_alias_name ? [`#${body.room_alias_name}:${SERVER_NAME}`] : [],
      });
      if (body.room_alias_name) {
        aliases.set(`#${body.room_alias_name}:${SERVER_NAME}`, roomId);
      }
      if (body.visibility === "public") {
        directoryVisibility.set(roomId, "public");
      }
      const memberMap = new Map([
        [
          creator,
          {
            user_id: creator,
            display_name: "Alice",
            avatar_url: null,
            membership: "join",
          },
        ],
      ]);
      for (const invitee of body.invite ?? []) {
        memberMap.set(invitee, {
          user_id: invitee,
          display_name: users.get(invitee)?.displayname ?? invitee,
          avatar_url: null,
          membership: "invite",
        });
      }
      roomMembers.set(roomId, memberMap);
      syncRoomCounts(roomId);
      json(res, 200, { room_id: roomId });
      return;
    }

    // --- Public room directory ---
    if (req.method === "GET" && path === "/_matrix/client/v3/publicRooms") {
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const publicRooms = [...rooms.values()]
        .filter((r) => r.public || directoryVisibility.get(r.room_id) === "public")
        .map((r) => ({
          room_id: r.room_id,
          name: r.name,
          topic: r.topic,
          canonical_alias: r.canonical_alias,
          num_joined_members: r.joined_members,
          world_readable: false,
          guest_can_join: true,
          join_rule: r.join_rules,
          room_type: r.room_type,
        }));
      json(res, 200, {
        chunk: publicRooms.slice(0, limit),
        total_room_count_estimate: publicRooms.length,
      });
      return;
    }

    const dirListMatch = path.match(/^\/_matrix\/client\/v3\/directory\/list\/room\/([^/]+)$/);
    if (dirListMatch) {
      const roomId = decodeURIComponent(dirListMatch[1]);
      if (!rooms.has(roomId)) return notFound(res);
      if (req.method === "GET") {
        json(res, 200, { visibility: directoryVisibility.get(roomId) ?? (rooms.get(roomId).public ? "public" : "private") });
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        directoryVisibility.set(roomId, body.visibility === "public" ? "public" : "private");
        const room = rooms.get(roomId);
        if (room) room.public = body.visibility === "public";
        json(res, 200, {});
        return;
      }
    }

    const aliasMatch = path.match(/^\/_matrix\/client\/v3\/directory\/room\/([^/]+)$/);
    if (aliasMatch) {
      const alias = decodeURIComponent(aliasMatch[1]);
      if (req.method === "GET") {
        const roomId = aliases.get(alias);
        if (!roomId) return notFound(res);
        json(res, 200, { room_id: roomId, servers: [SERVER_NAME] });
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        aliases.set(alias, body.room_id);
        const room = rooms.get(body.room_id);
        if (room) {
          room.aliases = [...new Set([...(room.aliases ?? []), alias])];
          if (!room.canonical_alias) room.canonical_alias = alias;
        }
        json(res, 200, {});
        return;
      }
      if (req.method === "DELETE") {
        const roomId = aliases.get(alias);
        aliases.delete(alias);
        if (roomId && rooms.has(roomId)) {
          const room = rooms.get(roomId);
          room.aliases = (room.aliases ?? []).filter((a) => a !== alias);
          if (room.canonical_alias === alias) room.canonical_alias = room.aliases[0] ?? null;
        }
        json(res, 200, {});
        return;
      }
    }

    // --- Homeserver policy (mock only) ---
    if (path === "/_synapse/admin/v1/homeserver_policy") {
      if (req.method === "GET") {
        json(res, 200, { ...homeserverPolicy, source: "mock" });
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        Object.assign(homeserverPolicy, body);
        if (body.rate_limits) {
          homeserverPolicy.rate_limits = { ...homeserverPolicy.rate_limits, ...body.rate_limits };
        }
        json(res, 200, { ...homeserverPolicy, source: "mock" });
        return;
      }
    }

    const kickMatch = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/kick$/);
    if (req.method === "POST" && kickMatch) {
      const roomId = decodeURIComponent(kickMatch[1]);
      const members = roomMembers.get(roomId);
      if (!members) return notFound(res);
      const body = await readBody(req);
      const member = members.get(body.user_id);
      if (!member) return notFound(res);
      member.membership = "leave";
      syncRoomCounts(roomId);
      json(res, 200, {});
      return;
    }

    const banMatch = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/ban$/);
    if (req.method === "POST" && banMatch) {
      const roomId = decodeURIComponent(banMatch[1]);
      const members = roomMembers.get(roomId);
      if (!members) return notFound(res);
      const body = await readBody(req);
      members.set(body.user_id, {
        user_id: body.user_id,
        display_name: users.get(body.user_id)?.displayname ?? body.user_id,
        avatar_url: null,
        membership: "ban",
      });
      syncRoomCounts(roomId);
      json(res, 200, {});
      return;
    }

    const unbanMatch = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/unban$/);
    if (req.method === "POST" && unbanMatch) {
      const roomId = decodeURIComponent(unbanMatch[1]);
      const members = roomMembers.get(roomId);
      if (!members) return notFound(res);
      const body = await readBody(req);
      const member = members.get(body.user_id);
      if (member) member.membership = "leave";
      json(res, 200, {});
      return;
    }

    const inviteMatch = path.match(/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/invite$/);
    if (req.method === "POST" && inviteMatch) {
      const roomId = decodeURIComponent(inviteMatch[1]);
      const members = roomMembers.get(roomId);
      if (!members) return notFound(res);
      const body = await readBody(req);
      members.set(body.user_id, {
        user_id: body.user_id,
        display_name: users.get(body.user_id)?.displayname ?? body.user_id,
        avatar_url: null,
        membership: "invite",
      });
      json(res, 200, {});
      return;
    }

    const stateMatch = path.match(
      /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/state\/([^/]+)\/(.*)$/,
    );
    if (req.method === "PUT" && stateMatch) {
      const roomId = decodeURIComponent(stateMatch[1]);
      const eventType = decodeURIComponent(stateMatch[2]);
      const room = rooms.get(roomId);
      if (!room) return notFound(res);
      const body = await readBody(req);
      if (eventType === "m.room.name") room.name = body.name ?? null;
      if (eventType === "m.room.topic") room.topic = body.topic ?? null;
      if (eventType === "m.room.join_rules") room.join_rules = body.join_rule ?? room.join_rules;
      if (eventType === "m.room.canonical_alias") room.canonical_alias = body.alias ?? null;
      json(res, 200, { event_id: `$evt_${Date.now()}` });
      return;
    }

    const sendMatch = path.match(
      /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/,
    );
    if (req.method === "PUT" && sendMatch) {
      if (!rooms.has(decodeURIComponent(sendMatch[1]))) return notFound(res);
      await readBody(req);
      json(res, 200, { event_id: `$msg_${Date.now()}` });
      return;
    }

    // --- Event reports ---
    if (req.method === "GET" && path === "/_synapse/admin/v1/event_reports") {
      const all = [...eventReports.values()].sort((a, b) => b.received_ts - a.received_ts);
      json(res, 200, { event_reports: all, total: all.length });
      return;
    }
    const reportMatch = path.match(/^\/_synapse\/admin\/v1\/event_reports\/([^/]+)$/);
    if (reportMatch) {
      const id = Number(reportMatch[1]);
      const report = eventReports.get(id);
      if (!report) return notFound(res);
      if (req.method === "GET") {
        json(res, 200, report);
        return;
      }
      if (req.method === "DELETE") {
        eventReports.delete(id);
        json(res, 200, {});
        return;
      }
    }

    // --- Media ---
    const userMediaMatch = path.match(/^\/_synapse\/admin\/v1\/users\/([^/]+)\/media$/);
    if (req.method === "GET" && userMediaMatch) {
      const userId = decodeURIComponent(userMediaMatch[1]);
      const local = [...mediaStore.values()].filter((m) => m.user_id === userId);
      json(res, 200, { local, total: local.length });
      return;
    }
    const roomMediaMatch = path.match(/^\/_synapse\/admin\/v1\/room\/([^/]+)\/media$/);
    if (req.method === "GET" && roomMediaMatch) {
      const roomId = decodeURIComponent(roomMediaMatch[1]);
      const local = [...mediaStore.values()].filter((m) => m.room_id === roomId);
      json(res, 200, { local, total: local.length });
      return;
    }
    const quarantineMatch = path.match(
      /^\/_synapse\/admin\/v1\/media\/quarantine\/([^/]+)\/([^/]+)$/,
    );
    if (req.method === "POST" && quarantineMatch) {
      const key = `${decodeURIComponent(quarantineMatch[1])}/${decodeURIComponent(quarantineMatch[2])}`;
      const item = mediaStore.get(key);
      if (!item) return notFound(res);
      await readBody(req);
      item.quarantined_by = `@alice:${SERVER_NAME}`;
      json(res, 200, {});
      return;
    }
    const unquarantineMatch = path.match(
      /^\/_synapse\/admin\/v1\/media\/unquarantine\/([^/]+)\/([^/]+)$/,
    );
    if (req.method === "POST" && unquarantineMatch) {
      const key = `${decodeURIComponent(unquarantineMatch[1])}/${decodeURIComponent(unquarantineMatch[2])}`;
      const item = mediaStore.get(key);
      if (!item) return notFound(res);
      await readBody(req);
      item.quarantined_by = null;
      json(res, 200, {});
      return;
    }
    const deleteMediaMatch = path.match(/^\/_synapse\/admin\/v1\/media\/([^/]+)\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMediaMatch) {
      const key = `${decodeURIComponent(deleteMediaMatch[1])}/${decodeURIComponent(deleteMediaMatch[2])}`;
      if (!mediaStore.has(key)) return notFound(res);
      mediaStore.delete(key);
      json(res, 200, {});
      return;
    }

    // --- Federation ---
    if (req.method === "GET" && path === "/_synapse/admin/v1/federation/destinations") {
      const destinations = [...federationDestinations.values()];
      json(res, 200, { destinations, total: destinations.length });
      return;
    }
    const destMatch = path.match(/^\/_synapse\/admin\/v1\/federation\/destinations\/([^/]+)$/);
    if (req.method === "GET" && destMatch) {
      const dest = federationDestinations.get(decodeURIComponent(destMatch[1]));
      if (!dest) return notFound(res);
      json(res, 200, dest);
      return;
    }

    // --- Server notice ---
    if (req.method === "POST" && path === "/_synapse/admin/v1/send_server_notice") {
      await readBody(req);
      json(res, 200, { event_id: `$notice_${Date.now()}` });
      return;
    }

    // --- Make room admin ---
    const makeAdminMatch = path.match(
      /^\/_synapse\/admin\/v1\/rooms\/([^/]+)\/make_room_admin$/,
    );
    if (req.method === "POST" && makeAdminMatch) {
      const roomId = decodeURIComponent(makeAdminMatch[1]);
      if (!rooms.has(roomId)) return notFound(res);
      await readBody(req);
      json(res, 200, {});
      return;
    }

    notFound(res);
  } catch (err) {
    json(res, 500, { errcode: "M_UNKNOWN", error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`mock-synapse listening on http://localhost:${PORT} (token: ${TOKEN})`);
});
