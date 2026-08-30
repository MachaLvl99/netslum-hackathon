import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Parent = DefaultTreeAdapterMap["parentNode"];

export interface RewriteSiteHtmlOptions {
  baseUrl: string;
  siteId: string;
  revision: string;
  apiBase: string | null;
}


function findElement(node: Node, tagName: string): Element | undefined {
  if ("tagName" in node && node.tagName === tagName) return node;
  for (const child of ("childNodes" in node ? node.childNodes : [])) {
    const match = findElement(child, tagName);
    if (match) return match;
  }
  return undefined;
}

function removeAuthoredPolicy(node: Parent): void {
  node.childNodes = node.childNodes.filter((child) => {
    if (!("tagName" in child)) return true;
    if (child.tagName === "base") return false;
    if (child.tagName !== "meta") return true;
    const httpEquiv = child.attrs.find((attribute) => attribute.name.toLowerCase() === "http-equiv")?.value.toLowerCase();
    return httpEquiv !== "content-security-policy";
  });
  for (const child of node.childNodes) if ("childNodes" in child) removeAuthoredPolicy(child);
}

export function siteContentSecurityPolicy(baseUrl: string): string {
  const origin = new URL(baseUrl).origin;
  return `default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: blob:; connect-src https:; frame-src https:; form-action 'none'; object-src 'none'; base-uri ${origin}`;
}

export function rewriteSiteHtml(html: string, options: RewriteSiteHtmlOptions): string {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") throw new TypeError("Site base URL must use HTTPS");
  const document = parse(html);
  const head = findElement(document, "head");
  if (!head) throw new TypeError("parse5 did not create a document head");
  removeAuthoredPolicy(document);
  const bootstrap = JSON.stringify({ siteId: options.siteId, revision: options.revision, apiBase: options.apiBase }).replaceAll("<", "\\u003c");
  const fragment = parseFragment(`<meta http-equiv="Content-Security-Policy" content="${siteContentSecurityPolicy(options.baseUrl).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><base href="${base.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><script>Object.defineProperty(window,"__NETSLUM__",{value:Object.freeze(${bootstrap}),writable:false,configurable:false});</script>`);
  for (const node of [...fragment.childNodes].reverse()) {
    node.parentNode = head;
    head.childNodes.unshift(node);
  }
  return serialize(document);
}
