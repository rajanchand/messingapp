import { describe, expect, it } from "vitest";
import { isIpInCidr, isIpBlocked } from "./ip-block";

describe("IP block matching", () => {
  it("matches exact IPv4 and CIDR ranges", () => {
    expect(isIpInCidr("203.0.113.10", "203.0.113.10")).toBe(true);
    expect(isIpInCidr("203.0.113.50", "203.0.113.0/24")).toBe(true);
    expect(isIpInCidr("203.0.114.1", "203.0.113.0/24")).toBe(false);
  });

  it("checks a list of blocks", () => {
    expect(isIpBlocked("10.0.0.5", ["10.0.0.0/8", "192.168.1.1"])).toBe(true);
    expect(isIpBlocked("8.8.8.8", ["10.0.0.0/8"])).toBe(false);
    expect(isIpBlocked(null, ["10.0.0.0/8"])).toBe(false);
  });
});
