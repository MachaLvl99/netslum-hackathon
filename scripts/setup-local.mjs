import crypto from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const webDevVars = path.join(root, "apps/web/.dev.vars");
const runtimeDevVars = path.join(root, "workers/site-runtime/.dev.vars");

if (!existsSync(webDevVars)) {
  console.log("==> Generating development keys for apps/web/.dev.vars...");
  const { privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256"
  });

  const jwk = privateKey.export({ format: "jwk" });
  jwk.kid = "netslum-local-key";
  jwk.alg = "ES256";
  jwk.key_ops = ["sign"];

  const storeKey = crypto.randomBytes(32).toString("base64");

  const content = `OAUTH_STORE_KEY="${storeKey}"
OAUTH_CLIENT_PRIVATE_JWK='${JSON.stringify(jwk)}'
SITE_ADMIN_DIDS="did:plc:admin123"
CLOUDFLARE_ACCOUNT_ID="local-account-id"
CLOUDFLARE_API_TOKEN="local-api-token"
SITE_ASSET_ORIGIN="http://127.0.0.1:8791"
SITE_RUNTIME_ORIGIN="http://127.0.0.1:8792"
`;

  writeFileSync(webDevVars, content, { encoding: "utf8", mode: 0o600 });
  console.log("    Created apps/web/.dev.vars");
} else {
  console.log("    apps/web/.dev.vars already exists, skipping.");
}

if (!existsSync(runtimeDevVars)) {
  const content = `SITE_RUNTIME_ORIGIN="http://127.0.0.1:8792"\n`;
  writeFileSync(runtimeDevVars, content, { encoding: "utf8", mode: 0o600 });
  console.log("    Created workers/site-runtime/.dev.vars");
} else {
  console.log("    workers/site-runtime/.dev.vars already exists, skipping.");
}

console.log("==> Local development setup complete.");
