const DENIED_SUFFIXES = ["macha.sh", "workers.dev", "localhost", "local", "internal"] as const;

function deniedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (DENIED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return true;
  const [a = 0, b = 0] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function deniedUrl(url: URL): boolean {
  return url.protocol !== "https:" || deniedHostname(url.hostname);
}

export default {
  async fetch(initialRequest: Request): Promise<Response> {
    let request = initialRequest;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const url = new URL(request.url);
      if (deniedUrl(url)) return Response.json({ code: "EGRESS_DENIED" }, { status: 403 });
      const response = await fetch(request, { redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects === 5) return Response.json({ code: "REDIRECT_LIMIT" }, { status: 508 });
      const target = new URL(location, url);
      if (deniedUrl(target)) return Response.json({ code: "EGRESS_DENIED" }, { status: 403 });
      const changeToGet = response.status === 303 || ((response.status === 301 || response.status === 302) && request.method === "POST");
      const headers = new Headers(request.headers);
      if (url.origin !== target.origin) headers.delete("authorization");
      if (changeToGet) { headers.delete("content-type"); headers.delete("content-length"); }
      const init: RequestInit = { method: changeToGet ? "GET" : request.method, headers, redirect: "manual" };
      if (!changeToGet && request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
      request = new Request(target, init);
    }
    return Response.json({ code: "REDIRECT_LIMIT" }, { status: 508 });
  }
} satisfies ExportedHandler;

export { deniedHostname, deniedUrl };
