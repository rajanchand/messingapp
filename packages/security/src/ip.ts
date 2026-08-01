/**
 * Minimal IPv4 helpers for IP block matching. IPv6 exact-match only.
 */

export function ipToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) + octet;
  }
  return n >>> 0;
}

export function parseCidr(cidr: string): { network: number; mask: number } | null {
  const [ip, bitsStr] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
  if (!ip || bitsStr === undefined) return null;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const network = ipToLong(ip);
  if (network === null) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { network: (network & mask) >>> 0, mask };
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (ip === cidr) return true;
  // IPv6: exact match only.
  if (ip.includes(":") || cidr.includes(":")) {
    return ip === cidr.replace(/\/128$/, "");
  }
  const parsed = parseCidr(cidr);
  const addr = ipToLong(ip);
  if (!parsed || addr === null) return false;
  return (addr & parsed.mask) >>> 0 === parsed.network;
}
