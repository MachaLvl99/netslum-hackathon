import { spawn, spawnSync } from "node:child_process";

const children = [];
let exiting = false;

function shutdown(exitCode = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(exitCode);
}

function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: true
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!exiting) {
      const exitCode = code ?? 1;
      console.error(`==> Service exited unexpectedly (${command} ${args.join(" ")}): code ${exitCode}`);
      shutdown(exitCode);
    }
  });
  return child;
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
const portWeb = process.env.PORT_WEB ?? "8787";
const portAssets = process.env.PORT_ASSETS ?? "8791";
const portRuntime = process.env.PORT_RUNTIME ?? "8792";
const portEgress = process.env.PORT_EGRESS ?? "8793";

const inspectorWeb = process.env.INSPECTOR_WEB ?? "9229";
const inspectorAssets = process.env.INSPECTOR_ASSETS ?? "9230";
const inspectorRuntime = process.env.INSPECTOR_RUNTIME ?? "9231";
const inspectorEgress = process.env.INSPECTOR_EGRESS ?? "9232";

console.log("==> Building Lynx UI bundle...");
const build = spawnSync("pnpm", ["--filter", "@netslum/lynx", "build"], { stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log("==> Launching all 4 local services with shared persistence...");
run("pnpm", ["--filter", "@netslum/web", "exec", "wrangler", "dev", "--port", portWeb, "--inspector-port", inspectorWeb, "--var", `PUBLIC_URL:http://127.0.0.1:${portWeb}`, "--var", "SERVERLESS_ENABLED:false", "--var", `SITE_ASSET_ORIGIN:http://127.0.0.1:${portAssets}`, "--var", `SITE_RUNTIME_ORIGIN:http://127.0.0.1:${portRuntime}`, "--persist-to", "../../.wrangler/state"], process.cwd());
run("pnpm", ["--filter", "@netslum/site-runtime", "exec", "wrangler", "dev", "--config", "wrangler.assets.jsonc", "--port", portAssets, "--inspector-port", inspectorAssets, "--var", `SITE_RUNTIME_ORIGIN:http://127.0.0.1:${portRuntime}`, "--persist-to", "../../.wrangler/state"], process.cwd());
run("pnpm", ["--filter", "@netslum/site-runtime", "exec", "wrangler", "dev", "--config", "wrangler.runtime.jsonc", "--port", portRuntime, "--inspector-port", inspectorRuntime, "--persist-to", "../../.wrangler/state"], process.cwd());
run("pnpm", ["--filter", "@netslum/site-runtime", "exec", "wrangler", "dev", "--config", "wrangler.egress.jsonc", "--port", portEgress, "--inspector-port", inspectorEgress, "--persist-to", "../../.wrangler/state"], process.cwd());
