import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const HTMX_URLS = [
  "https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js",
  "https://cdn.jsdelivr.net/npm/htmx.org@1.9.12/dist/htmx.min.js",
];
const EXPECTED_SHA256 = "449317ade7881e949510db614991e195c3a099c4c791c24dacec55f9f4a2a452";
const OBJECT_KEY = "_netslum/htmx-1.9.12.min.js";
const BUCKET_NAME = "netslum-sites";

async function fetchHtmx() {
  for (const url of HTMX_URLS) {
    try {
      console.log(`==> Fetching HTMX 1.9.12 from ${url}...`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`    Failed with status ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (hash !== EXPECTED_SHA256) {
        throw new Error(`SHA256 digest mismatch! Expected ${EXPECTED_SHA256}, got ${hash}`);
      }
      console.log(`    SHA256 digest verified: ${hash}`);
      return buffer;
    } catch (err) {
      console.warn(`    Fetch from ${url} failed: ${err.message}`);
    }
  }
  throw new Error("Failed to download and verify HTMX 1.9.12 from all providers.");
}

async function main() {
  const bytes = await fetchHtmx();

  // Save copy to starter directory for offline fallback / reference
  const starterDir = path.join(root, "workers/site-runtime/starter");
  if (!existsSync(starterDir)) mkdirSync(starterDir, { recursive: true });
  const localCopyPath = path.join(starterDir, "htmx-1.9.12.min.js");
  writeFileSync(localCopyPath, bytes);
  console.log(`==> Saved local copy to ${localCopyPath}`);

  // Write to a temporary file for wrangler CLI
  const tempPath = path.join(os.tmpdir(), "htmx-1.9.12.min.js");
  writeFileSync(tempPath, bytes);

  const isRemote = process.argv.includes("--remote");
  const isLocal = process.argv.includes("--local") || !isRemote;

  if (isRemote) {
    console.log(`==> Uploading ${OBJECT_KEY} to remote R2 bucket ${BUCKET_NAME}...`);
    try {
      execFileSync(
        "pnpm",
        ["exec", "wrangler", "r2", "object", "put", `${BUCKET_NAME}/${OBJECT_KEY}`, `--file=${tempPath}`, "--remote"],
        { stdio: "inherit", cwd: root }
      );
      console.log(`    Uploaded successfully to remote ${BUCKET_NAME}/${OBJECT_KEY}`);
    } catch (err) {
      console.error(`    Remote upload failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (isLocal) {
    console.log(`==> Seeding ${OBJECT_KEY} to local R2 persistence...`);
    const persistPath = path.join(root, ".wrangler/state");
    try {
      execFileSync(
        "pnpm",
        ["exec", "wrangler", "r2", "object", "put", `${BUCKET_NAME}/${OBJECT_KEY}`, `--file=${tempPath}`, "--local", `--persist-to=${persistPath}`],
        { stdio: "inherit", cwd: root }
      );
      console.log(`    Local R2 object seeded successfully at ${BUCKET_NAME}/${OBJECT_KEY}`);
    } catch {
      console.log("    Wrangler local put was skipped or unsupported in standalone environment; local copy retained.");
    }
  }

  console.log("==> HTMX seeding complete.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
