import "server-only";
import { ApiError } from "./http";

const MATRIX_USER_ID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-zA-Z0-9.-]+(?::\d+)?$/;
const MATRIX_ROOM_ID_RE = /^![^:]+:[a-zA-Z0-9.-]+(?::\d+)?$/;

/** Validates and returns the Matrix user ID from a route param. */
export function requireMatrixUserId(params: Record<string, string>): string {
  const raw = params.id;
  if (!raw) throw new ApiError(400, "validation", "User id is required.");
  const decoded = decodeURIComponent(raw);
  if (!MATRIX_USER_ID_RE.test(decoded)) {
    throw new ApiError(400, "validation", "Invalid Matrix user ID.");
  }
  return decoded;
}

/** Validates and returns the Matrix room ID from a route param. */
export function requireMatrixRoomId(params: Record<string, string>, key = "id"): string {
  const raw = params[key];
  if (!raw) throw new ApiError(400, "validation", "Room id is required.");
  const decoded = decodeURIComponent(raw);
  if (!MATRIX_ROOM_ID_RE.test(decoded)) {
    throw new ApiError(400, "validation", "Invalid Matrix room ID.");
  }
  return decoded;
}
