import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(projectRoot, "dist");
const webCorePackage = fileURLToPath(import.meta.resolve("@lynx-js/web-core/package.json"));
await mkdir(dist, { recursive: true });
await build({
  entryPoints: [path.join(projectRoot, "src/host.ts")],
  bundle: true,
  format: "esm",
  target: "es2024",
  outfile: path.join(dist, "host.js")
});
await cp(path.join(path.dirname(webCorePackage), "dist/client_prod/static"), path.join(dist, "static"), { recursive: true });
await cp(path.join(path.dirname(webCorePackage), "binary"), path.join(dist, "binary"), { recursive: true });
await cp(path.join(path.dirname(webCorePackage), "dist"), dist, { recursive: true });
await cp(path.join(path.dirname(webCorePackage), "dist/client"), dist, { recursive: true });
await cp(path.join(path.dirname(webCorePackage), "dist/common"), path.join(dist, "common"), { recursive: true });
const productionClientPath = path.join(dist, "static/js/client.js");
const productionClient = await readFile(productionClientPath, "utf8");
const sourceIdentityCheck = '"lynx:mtsready"===n.data&&n.source===t.contentWindow';
if (!productionClient.includes(sourceIdentityCheck)) throw new Error("Lynx iframe handshake changed; review compatibility patch");
await writeFile(productionClientPath, productionClient.replace(sourceIdentityCheck, '"lynx:mtsready"===n.data&&n.origin===globalThis.location.origin'));
