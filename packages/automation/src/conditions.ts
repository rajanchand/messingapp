/**
 * Condition evaluation for workflow definitions.
 * Supports simple field comparisons against a trigger payload.
 */

export type ConditionOp = "eq" | "neq" | "contains" | "exists" | "gt" | "lt";

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export interface ConditionGroup {
  /** All conditions must match (AND). Empty group = always true. */
  all?: Condition[];
  /** At least one condition must match (OR). */
  any?: Condition[];
}

function getPath(payload: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = payload;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function matchOne(condition: Condition, payload: Record<string, unknown>): boolean {
  const actual = getPath(payload, condition.field);
  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "contains":
      return typeof actual === "string" && typeof condition.value === "string"
        ? actual.includes(condition.value)
        : Array.isArray(actual)
          ? actual.includes(condition.value)
          : false;
    case "gt":
      return typeof actual === "number" && typeof condition.value === "number"
        ? actual > condition.value
        : false;
    case "lt":
      return typeof actual === "number" && typeof condition.value === "number"
        ? actual < condition.value
        : false;
    default:
      return false;
  }
}

export function evaluateConditions(
  group: ConditionGroup | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!group) return true;
  if (group.all?.length) {
    if (!group.all.every((c) => matchOne(c, payload))) return false;
  }
  if (group.any?.length) {
    if (!group.any.some((c) => matchOne(c, payload))) return false;
  }
  return true;
}
