import { DurableObject } from "cloudflare:workers";
import { NetslumError, parseZoneKey, zoneMutationSchema, type PaletteToken, type ZoneMutation, type ZoneObject, type ZoneSnapshot } from "@netslum/contracts";
import type { CloudflareEnv } from "../../types.js";

interface MetaRow { [key: string]: string | number | null; key: string; value: number; }
interface ObjectRow { [key: string]: string | number | null; id: string; type: "note" | "sigil" | "portal"; x: number; y: number; owner_did: string; payload_json: string; created_at: string; updated_at: string; }
interface RateRow { [key: string]: string | number | null; count: number; }

export class ZoneRoom extends DurableObject<CloudflareEnv> {
  private initialized = false;

  private initDatabase(): void {
    if (this.initialized) return;
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS zone_object (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        owner_did TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate (
        actor_did TEXT NOT NULL,
        bucket_minute INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (actor_did, bucket_minute)
      );
    `);
    const versionRow = [...sql.exec<MetaRow>("SELECT value FROM meta WHERE key='version'")][0];
    if (!versionRow) sql.exec("INSERT INTO meta(key, value) VALUES('version', 0)");
    this.initialized = true;
  }

  private getVersion(): number {
    this.initDatabase();
    const row = [...this.ctx.storage.sql.exec<MetaRow>("SELECT value FROM meta WHERE key='version'")][0];
    return row ? row.value : 0;
  }

  private rowToObject(row: ObjectRow): ZoneObject {
    const parsedPayload: unknown = JSON.parse(row.payload_json);
    const obj: ZoneObject = {
      id: row.id,
      type: row.type,
      x: row.x,
      y: row.y,
      ownerDid: row.owner_did,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.type === "note" && parsedPayload && typeof parsedPayload === "object" && "text" in parsedPayload && typeof parsedPayload.text === "string") {
      obj.text = parsedPayload.text;
    } else if (row.type === "sigil" && parsedPayload && typeof parsedPayload === "object" && "shape" in parsedPayload && "color" in parsedPayload) {
      if (typeof parsedPayload.shape === "string" && ["circle", "triangle", "square", "star", "wave"].includes(parsedPayload.shape)) {
        obj.shape = parsedPayload.shape as "circle" | "triangle" | "square" | "star" | "wave";
      }
      if (typeof parsedPayload.color === "string") {
        obj.color = parsedPayload.color as PaletteToken;
      }
    } else if (row.type === "portal" && parsedPayload && typeof parsedPayload === "object" && "targetZoneKey" in parsedPayload && typeof parsedPayload.targetZoneKey === "string") {
      obj.targetZoneKey = parsedPayload.targetZoneKey;
    }
    return obj;
  }

  private getSnapshot(zoneKey: string): ZoneSnapshot {
    this.initDatabase();
    const version = this.getVersion();
    const rows = [...this.ctx.storage.sql.exec<ObjectRow>("SELECT * FROM zone_object ORDER BY created_at ASC")];
    return { zoneKey, version, objects: rows.map((row) => this.rowToObject(row)) };
  }

  private checkRateLimit(actorDid: string): void {
    const sql = this.ctx.storage.sql;
    const nowMinute = Math.floor(Date.now() / 60_000);
    sql.exec("DELETE FROM rate WHERE bucket_minute < ?", nowMinute - 2);
    const row = [...sql.exec<RateRow>("SELECT count FROM rate WHERE actor_did = ? AND bucket_minute = ?", actorDid, nowMinute)][0];
    const currentCount = row?.count ?? 0;
    if (currentCount >= 10) throw new NetslumError("RATE_LIMITED", "Zone mutation rate limit exceeded (10/min)", 429);
    sql.exec("INSERT INTO rate (actor_did, bucket_minute, count) VALUES (?, ?, 1) ON CONFLICT(actor_did, bucket_minute) DO UPDATE SET count = count + 1", actorDid, nowMinute);
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { ws.close(1011, "Send failed"); }
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.initDatabase();
    const url = new URL(request.url);
    const match = /^\/api\/zones\/([^/]+)/.exec(url.pathname);
    const zoneKey = parseZoneKey(match ? (match[1] ?? "") : (url.pathname.split("/").pop() ?? ""));

    if (url.pathname.endsWith("/socket")) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      const snapshot = this.getSnapshot(zoneKey);
      server.send(JSON.stringify({ type: "snapshot", ...snapshot }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "GET") {
      return Response.json(this.getSnapshot(zoneKey));
    }

    if (request.method === "POST" && url.pathname.endsWith("/mutations")) {
      const actorDid = request.headers.get("X-Netslum-Actor");
      if (!actorDid) throw new NetslumError("AUTH_REQUIRED", "Authentication required for zone mutation", 401);
      const body: unknown = await request.json().catch(() => { throw new NetslumError("INVALID_INPUT", "Invalid JSON payload", 400); });
      const mutation: ZoneMutation = zoneMutationSchema.parse(body);

      const sql = this.ctx.storage.sql;
      const currentVersion = this.getVersion();
      if (mutation.expectedVersion !== currentVersion) {
        throw new NetslumError("CONFLICT", "Stale zone version", 409, true, { currentVersion });
      }

      this.checkRateLimit(actorDid);

      const changedIds: string[] = [];
      const nowIso = new Date().toISOString();

      this.ctx.storage.transactionSync(() => {
        const totalCount = [...sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM zone_object")][0]?.count ?? 0;
        const actorCount = [...sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM zone_object WHERE owner_did = ?", actorDid)][0]?.count ?? 0;

        let projectedTotal = totalCount;
        let projectedActor = actorCount;

        for (const op of mutation.operations) {
          if (op.op === "place") {
            if (projectedTotal >= 100) throw new NetslumError("ZONE_FULL", "Zone capacity reached (100 objects max)", 409);
            if (projectedActor >= 20) throw new NetslumError("ZONE_FULL", "Actor capacity reached in this zone (20 objects max)", 409);
            projectedTotal += 1;
            projectedActor += 1;

            const id = crypto.randomUUID();
            let payload: object = {};
            if (op.object.type === "note") payload = { text: op.object.text };
            else if (op.object.type === "sigil") payload = { shape: op.object.shape, color: op.object.color };
            else if (op.object.type === "portal") payload = { targetZoneKey: op.object.targetZoneKey };

            sql.exec(
              "INSERT INTO zone_object(id, type, x, y, owner_did, payload_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
              id, op.object.type, op.object.x, op.object.y, actorDid, JSON.stringify(payload), nowIso, nowIso
            );
            changedIds.push(id);
          } else if (op.op === "move") {
            const existing = [...sql.exec<ObjectRow>("SELECT * FROM zone_object WHERE id = ?", op.id)][0];
            if (!existing) throw new NetslumError("NOT_FOUND", "Object not found", 404);
            if (existing.owner_did !== actorDid) throw new NetslumError("FORBIDDEN", "Only the owner can move an object", 403);
            sql.exec("UPDATE zone_object SET x = ?, y = ?, updated_at = ? WHERE id = ?", op.x, op.y, nowIso, op.id);
            changedIds.push(op.id);
          } else if (op.op === "edit") {
            const existing = [...sql.exec<ObjectRow>("SELECT * FROM zone_object WHERE id = ?", op.id)][0];
            if (!existing) throw new NetslumError("NOT_FOUND", "Object not found", 404);
            if (existing.owner_did !== actorDid) throw new NetslumError("FORBIDDEN", "Only the owner can edit an object", 403);

            let newPayload: object;
            if (existing.type === "note" && "text" in op.value && typeof op.value.text === "string") {
              newPayload = { text: op.value.text };
            } else if (existing.type === "sigil" && "shape" in op.value && "color" in op.value) {
              newPayload = { shape: op.value.shape, color: op.value.color };
            } else if (existing.type === "portal" && "targetZoneKey" in op.value) {
              newPayload = { targetZoneKey: op.value.targetZoneKey };
            } else {
              throw new NetslumError("INVALID_INPUT", "Replacement value does not match object type", 400);
            }

            sql.exec("UPDATE zone_object SET payload_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(newPayload), nowIso, op.id);
            changedIds.push(op.id);
          } else if (op.op === "delete") {
            const existing = [...sql.exec<ObjectRow>("SELECT * FROM zone_object WHERE id = ?", op.id)][0];
            if (!existing) throw new NetslumError("NOT_FOUND", "Object not found", 404);
            if (existing.owner_did !== actorDid) throw new NetslumError("FORBIDDEN", "Only the owner can delete an object", 403);
            sql.exec("DELETE FROM zone_object WHERE id = ?", op.id);
            projectedTotal -= 1;
            projectedActor -= 1;
            changedIds.push(op.id);
          }
        }

        const nextVersion = currentVersion + 1;
        sql.exec("UPDATE meta SET value = ? WHERE key = 'version'", nextVersion);
      });

      const updatedSnapshot = this.getSnapshot(zoneKey);
      this.broadcast({ type: "mutation", ...updatedSnapshot });

      return Response.json({
        zoneKey,
        version: updatedSnapshot.version,
        changedIds
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    void _ws;
    void _message;
    await Promise.resolve();
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    void _reason;
    void _wasClean;
    ws.close(code, "Closed");
    await Promise.resolve();
  }
}
