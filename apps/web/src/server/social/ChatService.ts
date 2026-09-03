import { Agent } from "@atproto/api";
import { NetslumError } from "@netslum/contracts";
import type { CloudflareEnv } from "../../types.js";
import { getOAuthClient } from "../auth/oauth.js";

const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";
const DECLARATION_COLLECTION = "chat.bsky.actor.declaration";

/**
 * Phase D (plan §D): direct messages on Bluesky Chat, live-proven by the A3
 * spike. No message bodies are cached in D1 — Chat remains authoritative.
 * All calls are proxied to did:web:api.bsky.chat#bsky_chat.
 */
export class ChatService {
  constructor(private readonly env: CloudflareEnv) {}

  private async chatAgent(actorDid: string): Promise<Agent> {
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    const agent = new Agent(session);
    agent.configureProxy(CHAT_PROXY);
    return agent;
  }

  async getStatus(actorDid: string): Promise<{ available: boolean }> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.actor.getStatus({}, { signal: AbortSignal.timeout(8000) })
      .then(() => ({ available: true }))
      .catch((error) => {
        if ((error as { status?: number }).status === 403) return { available: false };
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return response;
  }

  async listConversations(actorDid: string, cursor?: string, limit = 25): Promise<{ convos: Array<Record<string, unknown>>; cursor?: string }> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.convo.listConvos({ limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return { convos: response.data.convos as unknown as Array<Record<string, unknown>>, ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
  }

  async listRequests(actorDid: string, cursor?: string, limit = 25): Promise<{ requests: Array<Record<string, unknown>>; cursor?: string }> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.convo.listConvoRequests({ limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return { requests: response.data.requests as unknown as Array<Record<string, unknown>>, ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
  }

  async getConvoForMembers(actorDid: string, members: readonly string[]): Promise<Record<string, unknown>> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.convo.getConvoForMembers({ members: [...members] }, { signal: AbortSignal.timeout(8000) })
      .catch((error) => {
        const status = (error as { status?: number }).status ?? 0;
        if (status === 400) throw new NetslumError("CAPABILITY_UNAVAILABLE", String((error as Error).message ?? "Conversation unavailable").slice(0, 160), 403);
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return response.data.convo as unknown as Record<string, unknown>;
  }

  async getMessages(actorDid: string, convoId: string, cursor?: string, limit = 50): Promise<{ messages: Array<Record<string, unknown>>; cursor?: string }> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.convo.getMessages({ convoId, limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return { messages: response.data.messages as unknown as Array<Record<string, unknown>>, ...(response.data.cursor ? { cursor: response.data.cursor } : {}) };
  }

  async sendMessage(actorDid: string, convoId: string, text: string, lang?: string): Promise<{ messageId: string }> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.convo.sendMessage({
      convoId,
      message: { text, ...(lang ? { lang } : {}) }
    }, { signal: AbortSignal.timeout(8000) }).catch((error) => {
      const status = (error as { status?: number }).status ?? 0;
      if (status === 400) throw new NetslumError("CAPABILITY_UNAVAILABLE", String((error as Error).message ?? "Message not sent").slice(0, 200), 403);
      throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
    });
    return { messageId: response.data.id };
  }

  async updateRead(actorDid: string, convoId: string, messageId?: string): Promise<{ ok: true }> {
    const agent = await this.chatAgent(actorDid);
    const response = await agent.chat.bsky.convo.updateRead({
      convoId,
      ...(messageId !== undefined ? { messageId } : {})
    }, { signal: AbortSignal.timeout(8000) }).catch(() => {
      throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
    });
    void response;
    return { ok: true };
  }

  async react(actorDid: string, convoId: string, messageId: string, value: string, remove: boolean): Promise<{ ok: boolean }> {
    if (!/^\p{Extended_Pictographic}$/u.test(value)) {
      throw new NetslumError("INVALID_INPUT", "Reactions must be a single emoji", 400);
    }
    const agent = await this.chatAgent(actorDid);
    if (remove) {
      await agent.chat.bsky.convo.removeReaction({ convoId, messageId, value }, { signal: AbortSignal.timeout(8000) })
        .catch(() => {
          throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
        });
      return { ok: true };
    }
    await agent.chat.bsky.convo.addReaction({ convoId, messageId, value }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return { ok: true };
  }

  async deleteMessageForSelf(actorDid: string, convoId: string, messageId: string): Promise<{ ok: boolean }> {
    const agent = await this.chatAgent(actorDid);
    await agent.chat.bsky.convo.deleteMessageForSelf({ convoId, messageId }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return { ok: true };
  }

  async acceptConvo(actorDid: string, convoId: string): Promise<{ ok: boolean }> {
    const agent = await this.chatAgent(actorDid);
    await agent.chat.bsky.convo.acceptConvo({ convoId }, { signal: AbortSignal.timeout(8000) })
      .catch(() => {
        throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
      });
    return { ok: true };
  }

  async setMuteState(actorDid: string, convoId: string, mute: boolean): Promise<{ ok: boolean }> {
    const agent = await this.chatAgent(actorDid);
    if (mute) {
      await agent.chat.bsky.convo.muteConvo({ convoId }, { signal: AbortSignal.timeout(8000) })
        .catch(() => {
          throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
        });
    } else {
      await agent.chat.bsky.convo.unmuteConvo({ convoId }, { signal: AbortSignal.timeout(8000) })
        .catch(() => {
          throw new NetslumError("CHAT_UNAVAILABLE", "Chat service unavailable", 503, true);
        });
    }
    return { ok: true };
  }

  async ensureDeclaration(actorDid: string): Promise<{ allowIncoming: string | null }> {
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    const pds = new Agent(session);
    try {
      const existing = await pds.com.atproto.repo.getRecord({ repo: actorDid, collection: DECLARATION_COLLECTION, rkey: "self" }, { signal: AbortSignal.timeout(8000) });
      const value = existing.data.value as { allowIncoming?: string };
      return { allowIncoming: typeof value.allowIncoming === "string" ? value.allowIncoming : null };
    } catch (error) {
      const code = (error as { error?: string }).error;
      if (code !== "RecordNotFound") throw new NetslumError("UPSTREAM_UNAVAILABLE", "Declaration lookup failed", 502, true);
      return { allowIncoming: null };
    }
  }

  async updateDeclaration(actorDid: string, allowIncoming: "all" | "following" | "none"): Promise<{ allowIncoming: string }> {
    const client = await getOAuthClient(this.env);
    const session = await client.restore(actorDid).catch(() => undefined);
    if (!session) throw new NetslumError("AUTH_REQUIRED", "Please sign in again", 401);
    const pds = new Agent(session);
    await pds.com.atproto.repo.putRecord({
      repo: actorDid,
      collection: DECLARATION_COLLECTION,
      rkey: "self",
      record: {
        $type: DECLARATION_COLLECTION,
        allowIncoming
      }
    }, { signal: AbortSignal.timeout(8000) }).catch(() => {
      throw new NetslumError("UPSTREAM_UNAVAILABLE", "Failed to update chat declaration", 502);
    });
    return { allowIncoming };
  }
}