import type { ZoneRoom } from "./server/zones/ZoneRoom.js";

export interface CloudflareEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  SITE_FILES: R2Bucket;
  ZONES: DurableObjectNamespace<ZoneRoom>;
  STAGING_DISPATCHER?: DispatchNamespace;
  PUBLIC_URL: string;
  PDS_URL: string;
  BSKY_PUBLIC_API: string;
  SERVERLESS_ENABLED: string;
  SITE_ASSET_ORIGIN: string;
  SITE_RUNTIME_ORIGIN: string;
  OAUTH_STORE_KEY: string;
  OAUTH_CLIENT_PRIVATE_JWK: string;
  SITE_ADMIN_DIDS: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  PDS_HOSTNAME?: string;
}
