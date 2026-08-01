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
        room_type: null,
      });
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

    notFound(res);
  } catch (err) {
    json(res, 500, { errcode: "M_UNKNOWN", error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`mock-synapse listening on http://localhost:${PORT} (token: ${TOKEN})`);
});
