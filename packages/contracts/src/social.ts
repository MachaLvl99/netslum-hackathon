import { z } from "zod";
import { revisionSchema, sha256Hex } from "./sites.js";

export const atUriSchema = z.string().regex(/^at:\/\/did:[a-z0-9:%._-]+\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._~:@!$&'()*+,;=-]+$/).max(2048);
export const cidSchema = z.string().min(10).max(200).regex(/^[A-Za-z0-9]+$/);
export const feedQuerySchema = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(5).default(5) }).strict();
export const preparePostSchema = z.object({ text: z.string().max(4000), replyToUri: atUriSchema.optional(), expectedRevision: revisionSchema.nullable() }).strict();
export const publishPostSchema = z.object({ draftRevision: revisionSchema }).strict();
export const reactionSchema = z.object({ uri: atUriSchema, cid: cidSchema, action: z.enum(["like", "unlike", "repost", "unrepost"]) }).strict();

export type PostSummary = { uri: string; cid: string; author: { did: string; handle: string; displayName?: string }; text: string; createdAt: string; embeds?: Array<Record<string, unknown>> };

export function deterministicPostRkey(draftRevision: string): string {
  return `netslum-${draftRevision.slice(0, 24)}`;
}

export async function deterministicReactionRkey(actorDid: string, action: "like" | "unlike" | "repost" | "unrepost", uri: string): Promise<string> {
  const kind = action === "like" || action === "unlike" ? "like" : "repost";
  const digest = await sha256Hex(`${actorDid}\0${kind}\0${uri}`);
  return `netslum-${digest.slice(0, 24)}`;
}
