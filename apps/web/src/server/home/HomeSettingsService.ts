import { NetslumError, homeModeSchema } from "@netslum/contracts";
import type { z } from "zod";
import type { CloudflareEnv } from "../../types.js";
import { canPublishSite } from "../auth/session.js";

/**
 * Phase 2 (plan §B6): private D1 home settings for local-PDS users.
 * External identities receive standard mode and no site resources.
 */
export class HomeSettingsService {
  constructor(private readonly env: CloudflareEnv) {}

  async requireLocalPds(did: string): Promise<void> {
    if (!(await canPublishSite(did, this.env))) {
      throw new NetslumError("LOCAL_PDS_REQUIRED", "Home settings are only available for local accounts", 403);
    }
  }

  async get(did: string): Promise<{ mode: "standard" | "authored"; activeHomePath: string | null; layoutSchema: Record<string, unknown> | null }> {
    const row = await this.env.DB.prepare("SELECT mode, active_home_path, layout_schema FROM home_settings WHERE did=?")
      .bind(did)
      .first<{ mode: "standard" | "authored"; active_home_path: string | null; layout_schema: string | null }>();
    let schema: Record<string, unknown> | null = null;
    if (row?.layout_schema) {
      try { schema = JSON.parse(row.layout_schema) as Record<string, unknown>; } catch { schema = null; }
    }
    return { mode: row?.mode ?? "standard", activeHomePath: row?.active_home_path ?? null, layoutSchema: schema };
  }

  async set(did: string, input: { mode: "standard" | "authored"; activeHomePath: string | null; layoutSchema?: Record<string, unknown> | null | undefined }): Promise<void> {
    const mode = homeModeSchema.parse(input.mode);
    const schemaJson = input.layoutSchema ? JSON.stringify(input.layoutSchema) : null;
    await this.env.DB.prepare(
      "INSERT INTO home_settings(did,mode,active_home_path,layout_schema,updated_at) VALUES(?,?,?,?,?) " +
      "ON CONFLICT(did) DO UPDATE SET mode=excluded.mode, active_home_path=excluded.active_home_path, layout_schema=COALESCE(excluded.layout_schema, home_settings.layout_schema), updated_at=excluded.updated_at"
    ).bind(did, mode, input.activeHomePath, schemaJson, Date.now()).run();
  }

  async setLayoutSchema(did: string, schema: Record<string, unknown> | null): Promise<void> {
    const schemaJson = schema ? JSON.stringify(schema) : null;
    await this.env.DB.prepare(
      "INSERT INTO home_settings(did,mode,active_home_path,layout_schema,updated_at) VALUES(?,'standard',null,?,?) " +
      "ON CONFLICT(did) DO UPDATE SET layout_schema=excluded.layout_schema, updated_at=excluded.updated_at"
    ).bind(did, schemaJson, Date.now()).run();
  }
}

export type HomeSettingsInput = z.infer<typeof homeModeSchema>;
