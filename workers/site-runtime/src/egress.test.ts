import { describe, expect, it } from "vitest";
import { deniedHostname, deniedUrl } from "./egress.js";

describe("tenant egress policy", () => {
  it.each(["localhost", "api.localhost", "127.0.0.1", "10.2.3.4", "172.20.1.1", "192.168.2.1", "::1", "pds.netslum.macha.sh", "x.workers.dev"])("denies %s", (host) => {
    expect(deniedHostname(host)).toBe(true);
  });

  it("allows public HTTPS but not plaintext HTTP", () => {
    expect(deniedUrl(new URL("https://example.com/resource"))).toBe(false);
    expect(deniedUrl(new URL("http://example.com/resource"))).toBe(true);
  });
});
