import "server-only";
import { getDb } from "@zts/database";
import { getRedis } from "@zts/security";
import { dispatchTriggerSafe } from "@zts/automation";

/** Non-blocking workflow trigger fan-out. Safe to call from request handlers. */
export function emitTrigger(
  triggerType: string,
  payload: Record<string, unknown>,
): void {
  try {
    dispatchTriggerSafe(getDb(), getRedis(), triggerType, payload);
  } catch {
    // Never break the primary request path.
  }
}
