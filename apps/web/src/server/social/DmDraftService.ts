import { NetslumError } from "@netslum/contracts";
import type { CloudflareEnv } from "../../types.js";
import { encryptJson, decryptJson } from "../auth/crypto.js";

const DM_DRAFT_TTL_MS = 10 * 60_000;

export interface PreparedMessage {
  convoId: string;
  recipientDids: string[];
  text: string;
  createdAt: number;
}

interface DraftRow { payload_enc: ArrayBuffer | null; }

/**
 * Phase D (plan §D): two-phase DM sends. prepare_message stores the encrypted
 * draft (minimum metadata) and returns a revision; send_prepared_message sends
 * exactly that revision and deletes it after success. Message bodies never
 * persist beyond the send, never enter logs, and never enter tenant code.
 */
export class DmDraftService {
  constructor(private readonly env: CloudflareEnv) {}

  private key(): string {
    if (!this.env.PRIVATE_DATA_KEY) throw new NetslumError("WORKER_FAILED", "Private data key is not configured", 500);
    return this.env.PRIVATE_DATA_KEY;
  }

  async prepare(actorDid: string, input: { convoId: string; recipientDids: string[]; text: string }): Promise<{ revision: string; sizeBytes: number; recipients: number }> {
    if (input.text.length === 0 || input.text.length > 4000) {
      throw new NetslumError("INVALID_INPUT", "Message text must be 1-4000 characters", 400);
    }
    if (input.recipientDids.length < 1 || input.recipientDids.length > 8) {
      throw new NetslumError("INVALID_INPUT", "1-8 recipients are required", 400);
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const revision = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const payload: PreparedMessage = {
      convoId: input.convoId,
      recipientDids: [...input.recipientDids],
      text: input.text,
      createdAt: Date.now()
    };
    const payloadEnc = await encryptJson(payload, this.key());
    await this.env.DB.prepare(
      "INSERT INTO dm_draft(revision,did,payload_enc,created_at,expires_at) VALUES(?,?,?,?,?) " +
      "ON CONFLICT(revision) DO NOTHING"
    ).bind(revision, actorDid, payloadEnc, Date.now(), Date.now() + DM_DRAFT_TTL_MS).run();
    return { revision, sizeBytes: new TextEncoder().encode(input.text).byteLength, recipients: input.recipientDids.length };
  }

  async load(actorDid: string, revision: string): Promise<PreparedMessage> {
    const row = await this.env.DB.prepare(
      "SELECT payload_enc FROM dm_draft WHERE revision=? AND did=? AND expires_at > ?"
    ).bind(revision, actorDid, Date.now()).first<DraftRow>();
    if (!row?.payload_enc) throw new NetslumError("NOT_FOUND", "Prepared message expired or missing", 404);
    return decryptJson<PreparedMessage>(row.payload_enc, this.key());
  }

  /** Consumes the prepared message after a successful send (§D idempotency). */
  async consume(actorDid: string, revision: string): Promise<void> {
    await this.env.DB.prepare("DELETE FROM dm_draft WHERE revision=? AND did=?").bind(revision, actorDid).run();
  }
}