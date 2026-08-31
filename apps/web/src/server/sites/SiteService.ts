import { Agent } from "@atproto/api";
import {
  decodeCanonicalBase64,
  NetslumError,
  sha256Hex,
  sitePathSchema,
  siteRevision,
  slugSchema,
  validateSiteBundle,
  type SiteFile
} from "@netslum/contracts";
import { transform } from "esbuild";
import type { CloudflareEnv } from "../../types.js";
import { canPublishSite } from "../auth/session.js";
import { getOAuthClient } from "../auth/oauth.js";
import { CloudflareProvisioner } from "./CloudflareProvisioner.js";

interface SiteRow {
  did: string;
  slug: string;
  draft_revision: string;
  active_revision: string | null;
  active_worker: string | null;
  kv_namespace_id: string | null;
  at_uri: string | null;
  at_cid: string | null;
  publishing_revision: string | null;
  publishing_started_at: number | null;
  status: "active" | "suspended";
  updated_at: number;
}

interface ReleaseRow {
  did: string;
  revision: string;
  worker_name: string | null;
  status: "staged" | "active" | "superseded";
  created_at: number;
  published_at: number | null;
}

export class SiteService {
  private readonly provisioner: CloudflareProvisioner;

  constructor(private readonly env: CloudflareEnv) {
    this.provisioner = new CloudflareProvisioner(env);
  }

  private async resolveActorHandle(actorDid: string): Promise<string> {
    if (actorDid.startsWith("did:plc:")) {
      const response = await fetch(`https://plc.directory/${encodeURIComponent(actorDid)}`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new NetslumError("UPSTREAM_UNAVAILABLE", "Identity resolver unavailable", 503, true);
      const document = await response.json<{ alsoKnownAs?: string[] }>();
      const alias = document.alsoKnownAs?.find((value) => value.startsWith("at://"));
      if (alias) return alias.slice("at://".length);
      throw new NetslumError("INVALID_HANDLE", "Account has no handle for a site slug", 400);
    }
    if (actorDid.startsWith("did:web:")) {
      const segments = actorDid.slice("did:web:".length).split(":").map(decodeURIComponent);
      return segments[0] ?? actorDid;
    }
    throw new NetslumError("FORBIDDEN", "Unsupported DID method", 403);
  }

  private async getAgent(actorDid: string): Promise<Agent> {
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    return new Agent(session);
  }

  private async assertLocalPds(actorDid: string): Promise<void> {
    const allowed = await canPublishSite(actorDid, this.env);
    if (!allowed) {
      throw new NetslumError("LOCAL_PDS_REQUIRED", "Only accounts hosted on this PDS can publish personal sites", 403);
    }
  }

  async getOrCreateSite(actorDid: string, handle?: string): Promise<{ siteId: string; site: SiteRow }> {
    await this.assertLocalPds(actorDid);
    const siteId = `site-${(await sha256Hex(actorDid)).slice(0, 24)}`;
    const existing = await this.env.DB.prepare("SELECT * FROM site WHERE did = ?").bind(actorDid).first<SiteRow>();
    if (existing) return { siteId, site: existing };

    const firstLabel = (handle ?? (await this.resolveActorHandle(actorDid))).split(".")[0];
    if (!firstLabel || !slugSchema.safeParse(firstLabel).success) {
      throw new NetslumError("INVALID_HANDLE", "Handle label is invalid for personal site slug", 400);
    }

    const starterHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>@${firstLabel}</title>
  <style>body{background:#070910;color:#E8F0FF;font-family:monospace;padding:48px;}</style>
</head>
<body>
  <h1>@${firstLabel}</h1>
  <p>Welcome to my personal site on netslum.</p>
</body>
</html>`;
    const htmlBytes = new TextEncoder().encode(starterHtml);
    const htmlSha = await sha256Hex(htmlBytes);
    const initialFiles: SiteFile[] = [
      { path: "index.html", mimeType: "text/html", size: htmlBytes.byteLength, sha256: htmlSha }
    ];
    const initialRevision = await siteRevision(initialFiles);

    await this.env.SITE_FILES.put(`draft/${siteId}/${initialRevision}/index.html`, htmlBytes, {
      customMetadata: { mimeType: "text/html", sha256: htmlSha }
    });

    const now = Date.now();
    await this.env.DB.prepare(
      "INSERT INTO site(did, slug, draft_revision, status, updated_at) VALUES(?, ?, ?, 'active', ?)"
    ).bind(actorDid, firstLabel, initialRevision, now).run();

    const site: SiteRow = {
      did: actorDid,
      slug: firstLabel,
      draft_revision: initialRevision,
      active_revision: null,
      active_worker: null,
      kv_namespace_id: null,
      at_uri: null,
      at_cid: null,
      publishing_revision: null,
      publishing_started_at: null,
      status: "active",
      updated_at: now
    };
    return { siteId, site };
  }

  async listFiles(siteId: string, prefix: string): Promise<SiteFile[]> {
    const listed = await this.env.SITE_FILES.list({ prefix: prefix.endsWith("/") ? prefix : `${prefix}/` });
    const files: SiteFile[] = [];
    for (const object of listed.objects) {
      const path = object.key.slice(prefix.length + 1);
      const mimeType = object.customMetadata?.mimeType ?? "application/octet-stream";
      const sha256 = object.customMetadata?.sha256 ?? "";
      files.push({ path, mimeType, size: object.size, sha256 });
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getDraft(actorDid: string, handle?: string): Promise<{ slug: string; revision: string; files: SiteFile[] }> {
    const { siteId, site } = await this.getOrCreateSite(actorDid, handle);
    const files = await this.listFiles(siteId, `draft/${siteId}/${site.draft_revision}`);
    return { slug: site.slug, revision: site.draft_revision, files };
  }

  async readFile(
    actorDid: string,
    input: { path: string; offset?: number; maxChars?: number },
    handle?: string
  ): Promise<{ path: string; content: string; encoding: "utf8" | "base64"; revision: string; nextOffset?: number }> {
    const { siteId, site } = await this.getOrCreateSite(actorDid, handle);
    const parsedPath = sitePathSchema.parse(input.path);
    const key = `draft/${siteId}/${site.draft_revision}/${parsedPath}`;
    const object = await this.env.SITE_FILES.get(key);
    if (!object) throw new NetslumError("NOT_FOUND", `File not found: ${parsedPath}`, 404);

    const mimeType = object.customMetadata?.mimeType ?? "application/octet-stream";
    const isText = mimeType.startsWith("text/") || mimeType === "application/javascript" || mimeType === "application/json" || mimeType === "image/svg+xml";

    const offset = input.offset ?? 0;
    const maxChars = Math.min(input.maxChars ?? 1000, 1000);

    if (isText) {
      const fullText = await object.text();
      const slice = fullText.slice(offset, offset + maxChars);
      const hasMore = offset + maxChars < fullText.length;
      const result: { path: string; content: string; encoding: "utf8" | "base64"; revision: string; nextOffset?: number } = {
        path: parsedPath,
        content: slice,
        encoding: "utf8",
        revision: site.draft_revision
      };
      if (hasMore) result.nextOffset = offset + maxChars;
      return result;
    }

    const arrayBuffer = await object.arrayBuffer();
    const binary = String.fromCharCode(...new Uint8Array(arrayBuffer));
    const base64 = btoa(binary);
    const slice = base64.slice(offset, offset + maxChars);
    const hasMore = offset + maxChars < base64.length;
    const result: { path: string; content: string; encoding: "utf8" | "base64"; revision: string; nextOffset?: number } = {
      path: parsedPath,
      content: slice,
      encoding: "base64",
      revision: site.draft_revision
    };
    if (hasMore) result.nextOffset = offset + maxChars;
    return result;
  }

  async saveFile(
    actorDid: string,
    input: { path: string; content: string; encoding: "utf8" | "base64"; contentType: string; expectedRevision: string },
    handle?: string
  ): Promise<{ revision: string }> {
    const { siteId, site } = await this.getOrCreateSite(actorDid, handle);
    if (site.draft_revision !== input.expectedRevision) {
      throw new NetslumError("STALE_REVISION", "Draft revision mismatch", 409, false, { currentRevision: site.draft_revision });
    }
    const parsedPath = sitePathSchema.parse(input.path);

    const bytes = input.encoding === "utf8" ? new TextEncoder().encode(input.content) : decodeCanonicalBase64(input.content);
    if (bytes.byteLength > 524_288) throw new NetslumError("INVALID_INPUT", "File size exceeds 512 KiB limit", 400);

    const sha256 = await sha256Hex(bytes);
    const oldFiles = await this.listFiles(siteId, `draft/${siteId}/${site.draft_revision}`);
    const nextFiles: SiteFile[] = oldFiles.filter((file) => file.path !== parsedPath);
    nextFiles.push({ path: parsedPath, mimeType: input.contentType, size: bytes.byteLength, sha256 });
    validateSiteBundle(nextFiles);
    const nextRevision = await siteRevision(nextFiles);

    // Copy unchanged files to new draft revision
    for (const file of oldFiles) {
      if (file.path === parsedPath) continue;
      const oldObj = await this.env.SITE_FILES.get(`draft/${siteId}/${site.draft_revision}/${file.path}`);
      if (oldObj) {
        await this.env.SITE_FILES.put(`draft/${siteId}/${nextRevision}/${file.path}`, oldObj.body, {
          customMetadata: { mimeType: file.mimeType, sha256: file.sha256 }
        });
      }
    }

    // Write modified file
    await this.env.SITE_FILES.put(`draft/${siteId}/${nextRevision}/${parsedPath}`, bytes, {
      customMetadata: { mimeType: input.contentType, sha256 }
    });

    const update = await this.env.DB.prepare(
      "UPDATE site SET draft_revision = ?, updated_at = ? WHERE did = ? AND draft_revision = ?"
    ).bind(nextRevision, Date.now(), actorDid, input.expectedRevision).run();

    if (!update.meta.changes) {
      // Rollback draft copy on failure
      for (const file of nextFiles) {
        await this.env.SITE_FILES.delete(`draft/${siteId}/${nextRevision}/${file.path}`).catch(() => undefined);
      }
      throw new NetslumError("STALE_REVISION", "Draft was modified concurrently", 409, false, { currentRevision: site.draft_revision });
    }

    return { revision: nextRevision };
  }

  async deleteFile(
    actorDid: string,
    input: { path: string; expectedRevision: string },
    handle?: string
  ): Promise<{ revision: string }> {
    const { siteId, site } = await this.getOrCreateSite(actorDid, handle);
    if (site.draft_revision !== input.expectedRevision) {
      throw new NetslumError("STALE_REVISION", "Draft revision mismatch", 409, false, { currentRevision: site.draft_revision });
    }
    const parsedPath = sitePathSchema.parse(input.path);
    if (parsedPath === "index.html") {
      throw new NetslumError("INVALID_INPUT", "index.html cannot be deleted", 400);
    }

    const oldFiles = await this.listFiles(siteId, `draft/${siteId}/${site.draft_revision}`);
    const nextFiles = oldFiles.filter((file) => file.path !== parsedPath);
    validateSiteBundle(nextFiles);
    const nextRevision = await siteRevision(nextFiles);

    for (const file of nextFiles) {
      const oldObj = await this.env.SITE_FILES.get(`draft/${siteId}/${site.draft_revision}/${file.path}`);
      if (oldObj) {
        await this.env.SITE_FILES.put(`draft/${siteId}/${nextRevision}/${file.path}`, oldObj.body, {
          customMetadata: { mimeType: file.mimeType, sha256: file.sha256 }
        });
      }
    }

    const update = await this.env.DB.prepare(
      "UPDATE site SET draft_revision = ?, updated_at = ? WHERE did = ? AND draft_revision = ?"
    ).bind(nextRevision, Date.now(), actorDid, input.expectedRevision).run();

    if (!update.meta.changes) {
      for (const file of nextFiles) {
        await this.env.SITE_FILES.delete(`draft/${siteId}/${nextRevision}/${file.path}`).catch(() => undefined);
      }
      throw new NetslumError("STALE_REVISION", "Draft was modified concurrently", 409, false, { currentRevision: site.draft_revision });
    }

    return { revision: nextRevision };
  }

  async publish(
    actorDid: string,
    input: { revision: string },
    handle?: string
  ): Promise<{ url: string; revision: string; atUri: string; atCid: string; runtimeUrl: string | null }> {
    const { siteId, site } = await this.getOrCreateSite(actorDid, handle);
    const now = Date.now();

    // 1. Claim publication lock
    if (site.publishing_revision && site.publishing_started_at && now - site.publishing_started_at < 10 * 60_000) {
      throw new NetslumError("PUBLISH_IN_PROGRESS", "A publication is already in progress for this site", 409, true);
    }

    const claim = await this.env.DB.prepare(
      "UPDATE site SET publishing_revision = ?, publishing_started_at = ? WHERE did = ? AND (publishing_revision IS NULL OR publishing_started_at < ?)"
    ).bind(input.revision, now, actorDid, now - 10 * 60_000).run();

    if (!claim.meta.changes) {
      throw new NetslumError("PUBLISH_IN_PROGRESS", "Failed to claim publication lock", 409, true);
    }

    let stagedWorkerName: string | null = null;
    let stagedKvId: string | null = null;

    try {
      // 2. Validate files bundle
      const draftFiles = await this.listFiles(siteId, `draft/${siteId}/${input.revision}`);
      validateSiteBundle(draftFiles);
      const computedRevision = await siteRevision(draftFiles);
      if (computedRevision !== input.revision) {
        throw new NetslumError("STALE_REVISION", "Draft revision hash mismatch", 409);
      }

      const workerFile = draftFiles.find((f) => f.path === "_worker.js");
      const serverlessEnabled = this.env.SERVERLESS_ENABLED === "true";

      // 3. Staging validation if _worker.js exists and serverless is enabled
      if (workerFile) {
        const workerObj = await this.env.SITE_FILES.get(`draft/${siteId}/${input.revision}/_worker.js`);
        if (!workerObj) throw new NetslumError("NOT_FOUND", "Worker file missing", 404);
        const scriptCode = await workerObj.text();

        if (serverlessEnabled && this.env.STAGING_DISPATCHER) {
          stagedWorkerName = `${siteId}-stage-${input.revision.slice(0, 12)}`;
          stagedKvId = await this.provisioner.getOrCreateKvNamespace(`staging-${siteId}`);
          await this.provisioner.putDispatchScript("netslum-sites-staging", stagedWorkerName, scriptCode, stagedKvId);

          try {
            const stagedDispatcher = this.env.STAGING_DISPATCHER.get(stagedWorkerName);
            const valResp = await stagedDispatcher.fetch(new Request("https://staging.internal/__netslum_validate__", { signal: AbortSignal.timeout(5000) }));
            if (valResp.status >= 500) {
              throw new NetslumError("WORKER_FAILED", "Worker returned 5xx during staging validation", 502);
            }
          } catch (err) {
            if (err instanceof NetslumError) throw err;
            throw new NetslumError("WORKER_FAILED", "Worker validation failed or timed out", 502);
          }
        } else {
          try {
            await transform(scriptCode, { loader: "js", format: "esm" });
          } catch {
            throw new NetslumError("INVALID_INPUT", "Invalid _worker.js syntax", 400);
          }
        }
      }

      // 4. Copy draft files to immutable release keys
      for (const file of draftFiles) {
        const draftObj = await this.env.SITE_FILES.get(`draft/${siteId}/${input.revision}/${file.path}`);
        if (draftObj) {
          await this.env.SITE_FILES.put(`release/${siteId}/${input.revision}/${file.path}`, draftObj.body, {
            customMetadata: { mimeType: file.mimeType, sha256: file.sha256 }
          });
        }
      }

      // 5. Production worker deployment if serverless enabled
      let productionWorkerName: string | null = null;
      let persistentKvId: string | null = site.kv_namespace_id;

      if (serverlessEnabled) {
        if (!persistentKvId) {
          persistentKvId = await this.provisioner.getOrCreateKvNamespace(`kv-${siteId}`);
        }
        productionWorkerName = `${siteId}-${input.revision.slice(0, 12)}`;
        let scriptCode = "export default { fetch() { return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }); } };";
        if (workerFile) {
          const workerObj = await this.env.SITE_FILES.get(`draft/${siteId}/${input.revision}/_worker.js`);
          if (workerObj) scriptCode = await workerObj.text();
        }
        await this.provisioner.putDispatchScript("netslum-sites-production", productionWorkerName, scriptCode, persistentKvId);
      }

      // 6. Upload blobs to AT Protocol repository
      const agent = await this.getAgent(actorDid);
      const lexiconFiles = [];

      for (const file of draftFiles) {
        const releaseObj = await this.env.SITE_FILES.get(`release/${siteId}/${input.revision}/${file.path}`);
        if (!releaseObj) throw new NetslumError("NOT_FOUND", `Release file missing: ${file.path}`, 404);
        const bytes = new Uint8Array(await releaseObj.arrayBuffer());
        const uploaded = await agent.uploadBlob(bytes, { encoding: file.mimeType });
        lexiconFiles.push({
          path: file.path,
          mimeType: file.mimeType,
          size: file.size,
          sha256: file.sha256,
          blob: uploaded.data.blob
        });
      }

      // 7. Write AT Protocol record
      const publishedAt = new Date().toISOString();
      const record = {
        $type: "sh.macha.netslumSite",
        version: 1,
        slug: site.slug,
        revision: input.revision,
        files: lexiconFiles,
        publishedAt
      };

      let atUri = site.at_uri;
      let atCid = site.at_cid;

      const existingRecord = await agent.com.atproto.repo.getRecord({
        repo: actorDid,
        collection: "sh.macha.netslumSite",
        rkey: "self"
      }).catch(() => undefined);

      if (existingRecord) {
        const swapCid = existingRecord.data.cid;
        const putResp = await agent.com.atproto.repo.putRecord({
          repo: actorDid,
          collection: "sh.macha.netslumSite",
          rkey: "self",
          swapRecord: swapCid ?? null,
          record
        }).catch(() => {
          throw new NetslumError("RECORD_CONFLICT", "Out-of-band record conflict on AT Protocol PDS", 409, false);
        });
        atUri = putResp.data.uri;
        atCid = putResp.data.cid;
      } else {
        const createResp = await agent.com.atproto.repo.createRecord({
          repo: actorDid,
          collection: "sh.macha.netslumSite",
          rkey: "self",
          record
        });
        atUri = createResp.data.uri;
        atCid = createResp.data.cid;
      }

      // 8. D1 Atomic cutover
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE site SET
            active_revision = ?,
            active_worker = ?,
            kv_namespace_id = ?,
            at_uri = ?,
            at_cid = ?,
            publishing_revision = NULL,
            publishing_started_at = NULL,
            status = 'active',
            updated_at = ?
          WHERE did = ? AND publishing_revision = ?`
        ).bind(input.revision, productionWorkerName, persistentKvId, atUri, atCid, Date.now(), actorDid, input.revision),
        this.env.DB.prepare(
          "UPDATE site_release SET status = 'superseded' WHERE did = ? AND status = 'active'"
        ).bind(actorDid),
        this.env.DB.prepare(
          "INSERT INTO site_release(did, revision, worker_name, status, created_at, published_at) VALUES(?, ?, ?, 'active', ?, ?)"
        ).bind(actorDid, input.revision, productionWorkerName, now, Date.now())
      ]);

      // 9. Best-effort cleanup of older releases & superseded workers
      if (site.active_worker && site.active_worker !== productionWorkerName && serverlessEnabled) {
        await this.provisioner.deleteDispatchScript("netslum-sites-production", site.active_worker).catch(() => undefined);
      }
      const releases = await this.env.DB.prepare(
        "SELECT revision FROM site_release WHERE did = ? ORDER BY created_at DESC"
      ).bind(actorDid).all<ReleaseRow>();
      if (releases.results.length > 5) {
        const toDelete = releases.results.slice(5);
        for (const rel of toDelete) {
          const filesToDelete = await this.listFiles(siteId, `release/${siteId}/${rel.revision}`);
          for (const f of filesToDelete) {
            await this.env.SITE_FILES.delete(`release/${siteId}/${rel.revision}/${f.path}`).catch(() => undefined);
          }
        }
      }

      const publicUrl = `${this.env.PUBLIC_URL.replace(/\/$/, "")}/@${site.slug}`;
      const runtimeUrl = productionWorkerName && serverlessEnabled ? `${this.env.SITE_RUNTIME_ORIGIN}/${siteId}/api` : null;

      return {
        url: publicUrl,
        revision: input.revision,
        atUri: atUri ?? "",
        atCid: atCid ?? "",
        runtimeUrl
      };
    } finally {
      // Delete temporary staging resources
      if (stagedWorkerName) {
        await this.provisioner.deleteDispatchScript("netslum-sites-staging", stagedWorkerName).catch(() => undefined);
      }
      if (stagedKvId) {
        await this.provisioner.deleteKvNamespace(stagedKvId).catch(() => undefined);
      }
      // Clear publishing claim if cutover didn't complete
      await this.env.DB.prepare(
        "UPDATE site SET publishing_revision = NULL, publishing_started_at = NULL WHERE did = ? AND publishing_revision = ?"
      ).bind(actorDid, input.revision).run().catch(() => undefined);
    }
  }

  async suspendSite(operatorDid: string, targetDid: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new NetslumError("INVALID_INPUT", "Reason is required for suspension", 400);
    const actionId = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE site SET status = 'suspended', updated_at = ? WHERE did = ?").bind(Date.now(), targetDid),
      this.env.DB.prepare("INSERT INTO site_admin_action(id, site_did, operator_did, action, reason, created_at) VALUES(?, ?, ?, 'suspend', ?, ?)").bind(actionId, targetDid, operatorDid, reason, Date.now())
    ]);
  }

  async restoreSite(operatorDid: string, targetDid: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new NetslumError("INVALID_INPUT", "Reason is required for restoration", 400);
    const actionId = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE site SET status = 'active', updated_at = ? WHERE did = ?").bind(Date.now(), targetDid),
      this.env.DB.prepare("INSERT INTO site_admin_action(id, site_did, operator_did, action, reason, created_at) VALUES(?, ?, ?, 'restore', ?, ?)").bind(actionId, targetDid, operatorDid, reason, Date.now())
    ]);
  }
}
