import { ipToLong, parseCidr, isIpInCidr } from "./ip";

export { ipToLong, parseCidr, isIpInCidr };

/**
 * Returns true when `ip` matches any entry in `blocks` (exact IP or CIDR).
 * Expired blocks are ignored by the caller.
 */
export function isIpBlocked(ip: string | null | undefined, blocks: string[]): boolean {
  if (!ip) return false;
  for (const cidr of blocks) {
    if (isIpInCidr(ip, cidr)) return true;
  }
  return false;
}
