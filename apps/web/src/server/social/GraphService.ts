import { Agent } from "@atproto/api";
import { NetslumError, normalizeActorInput } from "@netslum/contracts";
import type { CloudflareEnv } from "../../types.js";
import { getOAuthClient } from "../auth/oauth.js";


/**
 * Phase 2 (plan §C2): follow/block/mute/report with viewer relationship state.
 * Graph records are lexicon key:"tid" collections, so idempotency is resolved
 * by listing the actor's records and matching the subject (the same approach
 * the reactions take; a mapping table adds nothing here because follows and
 * blocks are already addressable by subject lookup and are few in number).
 */
export class GraphService {
  constructor(private readonly env: CloudflareEnv) {}

  private async getAgent(actorDid?: string): Promise<Agent> {
    if (!actorDid) return new Agent(this.env.BSKY_PUBLIC_API);
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    return new Agent(session);
  }
  private async appviewAgent(actorDid?: string): Promise<Agent> {
    const agent = await this.getAgent(actorDid);
    if (actorDid) agent.configureProxy("did:web:api.bsky.app#bsky_appview");
    return agent;
  }


  async resolveActor(actorInput: string): Promise<{ did: string; handle: string }> {
    const agent = await this.getAgent();
    const actor = normalizeActorInput(actorInput);
    const response = await agent.getProfile({ actor }, { signal: AbortSignal.timeout(8000) }).catch(() => {
      throw new NetslumError("NOT_FOUND", "Actor not found", 404);
    });
    return { did: response.data.did, handle: response.data.handle };
  }

  async getRelationships(actorDid: string, subjects: readonly string[]): Promise<Array<Record<string, unknown>>> {
    const agent = await this.appviewAgent(actorDid);
    const response = await agent.app.bsky.graph.getRelationships({ actor: actorDid, others: [...subjects] }, { signal: AbortSignal.timeout(8000) }).catch(() => {
      throw new NetslumError("UPSTREAM_UNAVAILABLE", "Relationship lookup unavailable", 503, true);
    });
    return response.data.relationships as Array<Record<string, unknown>>;
  }


  private async findRecordBySubject(agent: Agent, actorDid: string, collection: string, subjectDid: string): Promise<string | null> {
    const list = await agent.com.atproto.repo.listRecords({ repo: actorDid, collection, limit: 100 }).catch(() => null);
    if (!list) return null;
    for (const rec of list.data.records) {
      const value = rec.value as { subject?: unknown };
      if (typeof value.subject === "string" && value.subject === subjectDid) return rec.uri.split("/").pop() ?? null;
    }
    return null;
  }


  /** follow/unfollow/block/unblock are repo records with PDS-assigned rkeys. */
  async setFollowState(actorDid: string, targetDid: string, follow: boolean): Promise<{ following: boolean }> {
    const agent = await this.getAgent(actorDid);
    const collection = "app.bsky.graph.follow";
    if (follow) {
      const existing = await this.findRecordBySubject(agent, actorDid, collection, targetDid);
      if (existing) return { following: true };
      const created = await agent.com.atproto.repo.createRecord({
        repo: actorDid,
        collection,
        record: { $type: collection, subject: targetDid, createdAt: new Date().toISOString() }
      }).catch((error) => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", `Follow failed: ${String((error as Error).message ?? error).slice(0, 120)}`, 502, true);
      });
      void created;
      return { following: true };
    }
    const rkey = await this.findRecordBySubject(agent, actorDid, collection, targetDid);
    if (rkey) {
      await agent.com.atproto.repo.deleteRecord({ repo: actorDid, collection, rkey }).catch(() => undefined);
    }
    return { following: false };
  }


  async setBlockState(actorDid: string, targetDid: string, block: boolean): Promise<{ blocking: boolean }> {
    const agent = await this.getAgent(actorDid);
    const collection = "app.bsky.graph.block";
    if (block) {
      const existing = await this.findRecordBySubject(agent, actorDid, collection, targetDid);
      if (existing) return { blocking: true };
      await agent.com.atproto.repo.createRecord({
        repo: actorDid,
        collection,
        record: { $type: collection, subject: targetDid, createdAt: new Date().toISOString() }
      }).catch((error) => {
        throw new NetslumError("UPSTREAM_UNAVAILABLE", `Block failed: ${String((error as Error).message ?? error).slice(0, 160)}`, 502);
      });
      return { blocking: true };
    }
    const rkey = await this.findRecordBySubject(agent, actorDid, collection, targetDid);
    if (rkey) {
      await agent.com.atproto.repo.deleteRecord({ repo: actorDid, collection, rkey }).catch(() => undefined);
    }
    return { blocking: false };
  }


  async setMuteState(actorDid: string, targetDid: string, mute: boolean): Promise<{ muted: boolean }> {
    // Mutes are AppView state (not repo records), so the call is proxied to
    // did:web:api.bsky.app#bsky_appview like every other app.bsky.* call.
    const agent = await this.appviewAgent(actorDid);
    try {
      if (mute) {
        await agent.app.bsky.graph.muteActor({ actor: targetDid }, { signal: AbortSignal.timeout(8000) });
        return { muted: true };
      }
      await agent.app.bsky.graph.unmuteActor({ actor: targetDid }, { signal: AbortSignal.timeout(8000) });
      return { muted: false };
    } catch (error) {
      throw new NetslumError("UPSTREAM_UNAVAILABLE", `Mute state failed: ${String((error as Error).message ?? error).slice(0, 160)}`, 502);
    }
  }
  async reportContent(actorDid: string, input: { subjectUri: string; subjectCid?: string; reasonType: string; comment?: string }): Promise<{ reported: true }> {
    const agent = await this.getAgent(actorDid);
    const subject: { uri: string; cid?: string } = { uri: input.subjectUri };
    if (input.subjectCid) subject.cid = input.subjectCid;
    const reportInput: Parameters<Agent["com"]["atproto"]["moderation"]["createReport"]>["0"] = {
      reasonType: input.reasonType,
      subject: { $type: "com.atproto.moderation.defs#subjectView", ...subject }
    };
    if (input.comment !== undefined) reportInput.reason = input.comment;
    const response = await agent.com.atproto.moderation.createReport(reportInput, { signal: AbortSignal.timeout(8000) }).catch((error) => {
      throw new NetslumError("UPSTREAM_UNAVAILABLE", `Report failed: ${String((error as Error).message ?? error).slice(0, 160)}`, 502);
    });
    void response;
    return { reported: true };
  }


  async searchActors(actorDid: string | undefined, query: string, limit: number, cursor?: string): Promise<{ actors: Array<{ did: string; handle: string; displayName?: string; description?: string; avatar?: string; followers?: number }>; cursor?: string }> {
    const agent = await this.appviewAgent(actorDid);
    const response = await agent.app.bsky.actor.searchActors({ q: query, limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) });
    const actors = response.data.actors.map((entry) => ({
      did: entry.did,
      handle: entry.handle,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.avatar ? { avatar: entry.avatar } : {}),
      ...(typeof (entry as { followersCount?: number }).followersCount === "number" ? { followers: (entry as { followersCount?: number }).followersCount } : {})
    }));
    return { actors, ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
  }

}