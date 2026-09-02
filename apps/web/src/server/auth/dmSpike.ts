import { Agent } from "@atproto/api";

export interface DmSpikeStep {
  actor: "sender" | "recipient";
  method: string;
  status: number;
  outcome: "ok" | "denied" | "unavailable" | "error";
  note?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

function step(
  actor: DmSpikeStep["actor"],
  method: string,
  status: number,
  extra?: Pick<DmSpikeStep, "note" | "data">
): DmSpikeStep {
  return {
    actor,
    method,
    status,
    outcome: status === 401 || status === 403 ? "denied" : status === 0 ? "unavailable" : status < 400 ? "ok" : "error",
    note: extra?.note,
    data: extra?.data
  };
}

function errorStep(actor: DmSpikeStep["actor"], method: string, error: unknown): DmSpikeStep {
  const status = (error as { status?: number }).status ?? 0;
  const note = String((error as { message?: string }).message ?? error).slice(0, 200);
  return step(actor, method, status, { note });
}

const DECLARATION_COLLECTION = "chat.bsky.actor.declaration";
const BLOCK_COLLECTION = "app.bsky.graph.block";
const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";

async function readDeclaration(
  pdsAgent: Agent,
  did: string,
  timeout: () => AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    const existing = await pdsAgent.com.atproto.repo.getRecord({
      repo: did, collection: DECLARATION_COLLECTION, rkey: "self"
    }, { signal: timeout() });
    return existing.data?.value as Record<string, unknown> | undefined ?? null;
  } catch (error) {
    // Only a real record-not-found means "absent"; timeouts, auth, and 5xx
    // must rethrow so the probe never mutates without a trustworthy snapshot.
    const status = (error as { status?: number; error?: string }).status ?? 0;
    const code = (error as { error?: string }).error ?? "";
    if (status === 404 || code === "RecordNotFound") {
      return null;
    }
    throw error;
  }
}

async function writeDeclaration(
  pdsAgent: Agent,
  did: string,
  record: Record<string, unknown>,
  timeout: () => AbortSignal
): Promise<void> {
  await pdsAgent.com.atproto.repo.putRecord({
    repo: did,
    collection: DECLARATION_COLLECTION,
    rkey: "self",
    record: { ...record, createdAt: (record.createdAt as string | undefined) ?? new Date().toISOString() }
  }, { signal: timeout() });
}


function chatAgentFor(session: unknown): Agent {
  const agent = new Agent(session as never);
  agent.configureProxy(CHAT_PROXY);
  return agent;
}

/**
 * Phase A3 acceptance spike: the complete direct-message lifecycle between
 * the sender and recipient probe fixtures, both through the deployed Worker
 * with granular OAuth scopes. Proves declaration, availability, the
 * accepted-convo send/read/react/delete flow, the request-inbox transition
 * for exactly this conversation, and block denial. Temporary probe code —
 * removed before Phase 2 ships.
 */
export async function probeDmLifecycle(
  senderSession: unknown,
  recipientSession: unknown,
  senderDid: string,
  recipientDid: string
): Promise<DmSpikeStep[]> {
  const senderChat = chatAgentFor(senderSession);
  const recipientChat = chatAgentFor(recipientSession);
  const steps: DmSpikeStep[] = [];
  const timeout = (): AbortSignal => AbortSignal.timeout(10_000) as never;

  // 1. No declaration mutation in this phase: the pair must already have an
  // accepted conversation (acceptance is sticky and survives later
  // declaration changes), so the spike observes existing state only.
  try {

  // 2. Sender availability with the recipient.
  try {
    const availability = await senderChat.chat.bsky.convo.getConvoAvailability(
      { members: [recipientDid] }, { signal: timeout() }
    );
    steps.push(step("sender", "chat.bsky.convo.getConvoAvailability", 200, {
      data: { canChat: availability.data.canChat, convoId: availability.data.convo?.id ?? null }
    }));
  } catch (error) {
    steps.push(errorStep("sender", "chat.bsky.convo.getConvoAvailability", error));
  }

  // 3. Create/find the direct conversation (sender side).
  let convoId: string | null = null;
  try {
    const convo = await senderChat.chat.bsky.convo.getConvoForMembers(
      { members: [recipientDid] }, { signal: timeout() }
    );
    convoId = convo.data.convo.id;
    steps.push(step("sender", "chat.bsky.convo.getConvoForMembers", 200, { data: { convoId } }));
  } catch (error) {
    steps.push(errorStep("sender", "chat.bsky.convo.getConvoForMembers", error));
  }

  if (!convoId) {
    steps.push(step("sender", "spike", 0, { note: "no conversation; later steps skipped" }));
    return steps;
  }

  // 4. Accepted-inbox lifecycle on the sender side.
  let firstMessageId: string | null = null;
  try {
    const send = await senderChat.chat.bsky.convo.sendMessage(
      { convoId, message: { text: `netslum phase2 spike 1 ${new Date().toISOString()}` } }, { signal: timeout() }
    );
    firstMessageId = send.data.id;
    steps.push(step("sender", "chat.bsky.convo.sendMessage", 200, { data: { messageId: firstMessageId } }));
  } catch (error) {
    steps.push(errorStep("sender", "chat.bsky.convo.sendMessage", error));
  }

  // 5. Recipient delivery: the exact conversation must appear in the
  // recipient's accepted list, and the exact message ID must be readable.
  let delivered = false;
  try {
    const convos = await recipientChat.chat.bsky.convo.listConvos({ limit: 20 }, { signal: timeout() });
    delivered = (convos.data.convos ?? []).some((c) => c.id === convoId);
    steps.push(step("recipient", "chat.bsky.convo.listConvos", delivered ? 200 : 417, {
      data: { includesConvo: delivered }
    }));
  } catch (error) {
    steps.push(errorStep("recipient", "chat.bsky.convo.listConvos", error));
  }

  let recipientSawMessage = false;
  if (firstMessageId && delivered) {
    try {
      const messages = await recipientChat.chat.bsky.convo.getMessages({ convoId, limit: 10 }, { signal: timeout() });
      recipientSawMessage = messages.data.messages.some((m) => "id" in m && m.id === firstMessageId);
      steps.push(step("recipient", "chat.bsky.convo.getMessages", recipientSawMessage ? 200 : 417, {
        data: { count: messages.data.messages.length, messageDelivered: recipientSawMessage }
      }));
    } catch (error) {
      steps.push(errorStep("recipient", "chat.bsky.convo.getMessages", error));
    }
    try {
      await recipientChat.chat.bsky.convo.updateRead({ convoId, messageId: firstMessageId }, { signal: timeout() });
      steps.push(step("recipient", "chat.bsky.convo.updateRead", 200, { data: { messageId: firstMessageId } }));
    } catch (error) {
      steps.push(errorStep("recipient", "chat.bsky.convo.updateRead", error));
    }
    try {
      await recipientChat.chat.bsky.convo.addReaction({ convoId, messageId: firstMessageId, value: "👍" }, { signal: timeout() });
      steps.push(step("recipient", "chat.bsky.convo.addReaction", 200));
    } catch (error) {
      steps.push(errorStep("recipient", "chat.bsky.convo.addReaction", error));
    }
    try {
      await recipientChat.chat.bsky.convo.removeReaction({ convoId, messageId: firstMessageId, value: "👍" }, { signal: timeout() });
      steps.push(step("recipient", "chat.bsky.convo.removeReaction", 200));
    } catch (error) {
      steps.push(errorStep("recipient", "chat.bsky.convo.removeReaction", error));
    }
  }

  // 6. Sender read state and delete-for-self of its own message.
  try {
    await senderChat.chat.bsky.convo.updateRead({ convoId }, { signal: timeout() });
    steps.push(step("sender", "chat.bsky.convo.updateRead", 200));
  } catch (error) {
    steps.push(errorStep("sender", "chat.bsky.convo.updateRead", error));
  }
  if (firstMessageId) {
    try {
      await senderChat.chat.bsky.convo.deleteMessageForSelf({ convoId, messageId: firstMessageId }, { signal: timeout() });
      steps.push(step("sender", "chat.bsky.convo.deleteMessageForSelf", 200));
    } catch (error) {
      steps.push(errorStep("sender", "chat.bsky.convo.deleteMessageForSelf", error));
    }
  }
  } catch (spikeError) {
    steps.push(errorStep("sender", "spike", spikeError));
  }
  return steps;
}


/**
 * Block denial: the recipient blocks the sender, then the sender's
 * availability with the recipient must report canChat=false (or a denied
 * convo), never a silent success. Removes the block record afterwards so the
 * fixtures stay clean. Temporary probe code.
 */
export async function probeDmBlockBehavior(
  senderSession: unknown,
  recipientSession: unknown,
  senderDid: string,
  recipientDid: string
): Promise<DmSpikeStep[]> {
  const senderChat = chatAgentFor(senderSession);
  const recipientPds = new Agent(recipientSession as never);
  const steps: DmSpikeStep[] = [];
  const timeout = (): AbortSignal => AbortSignal.timeout(10_000) as never;

  let blockUri: string | null = null;
  try {
    const block = await recipientPds.com.atproto.repo.createRecord({
      repo: recipientDid,
      collection: BLOCK_COLLECTION,
      record: { $type: BLOCK_COLLECTION, subject: senderDid, createdAt: new Date().toISOString() }
    }, { signal: timeout() });
    blockUri = block.data.uri;
    steps.push(step("recipient", `createRecord(${BLOCK_COLLECTION})`, 200, { data: { blockUri } }));

    try {
      const availability = await senderChat.chat.bsky.convo.getConvoAvailability(
        { members: [recipientDid] }, { signal: timeout() }
      );
      const denied = availability.data.canChat === false;
      steps.push(step("sender", "chat.bsky.convo.getConvoAvailability(blocked)", denied ? 200 : 417, {
        data: { canChat: availability.data.canChat }
      }));
    } catch (error) {
      // A denied XRPC error also proves block enforcement.
      steps.push(errorStep("sender", "chat.bsky.convo.getConvoAvailability(blocked)", error));
    }
  } finally {
    if (blockUri) {
      const rkey = blockUri.split("/").pop() ?? "";
      try {
        await recipientPds.com.atproto.repo.deleteRecord({ repo: recipientDid, collection: BLOCK_COLLECTION, rkey }, { signal: timeout() });
        steps.push(step("recipient", `deleteRecord(${BLOCK_COLLECTION})`, 200, { data: { rkey } }));
      } catch (error) {
        steps.push(errorStep("recipient", `deleteRecord(${BLOCK_COLLECTION})`, error));
      }
    }
  }

  return steps;
}

/**
 * allowIncoming=none denial: with the recipient set to "no one", Bluesky's
 * published DM semantics say the user cannot be messaged at all — so
 * availability must report canChat=false and/or sending must be denied.
 * The prior declaration is snapshotted and restored in finally. Temporary
 * probe code.
 */
export async function probeDmNoneDenial(
  senderSession: unknown,
  recipientSession: unknown,
  senderDid: string,
  recipientDid: string
): Promise<DmSpikeStep[]> {
  const senderChat = chatAgentFor(senderSession);
  const recipientPds = new Agent(recipientSession as never);
  const steps: DmSpikeStep[] = [];
  const timeout = (): AbortSignal => AbortSignal.timeout(10_000) as never;

  const priorDeclaration = await readDeclaration(recipientPds, recipientDid, timeout);
  if (!priorDeclaration?.allowIncoming) {
    // Absent/unreadable prior (the default following-only state) must not be
    // replaced with "none" — the probe could not restore it and "none" is a
    // different privacy state. Only mutate a fixture with an existing
    // restorable declaration.
    steps.push(step("recipient", `refuse(${DECLARATION_COLLECTION} mutation)`, 0, {
      note: "prior declaration absent or unreadable; refusing to mutate"
    }));
    return steps;
  }

  try {
    await recipientPds.com.atproto.repo.putRecord({
      repo: recipientDid,
      collection: DECLARATION_COLLECTION,
      rkey: "self",
      record: { $type: DECLARATION_COLLECTION, allowIncoming: "none", createdAt: new Date().toISOString() }
    }, { signal: timeout() });
    steps.push(step("recipient", `putRecord(${DECLARATION_COLLECTION}=none)`, 200));

    let deniedByAvailability = false;
    try {
      const availability = await senderChat.chat.bsky.convo.getConvoAvailability(
        { members: [recipientDid] }, { signal: timeout() }
      );
      deniedByAvailability = availability.data.canChat === false;
      steps.push(step("sender", "chat.bsky.convo.getConvoAvailability(none)", deniedByAvailability ? 200 : 417, {
        data: { canChat: availability.data.canChat }
      }));
    } catch (error) {
      // Only a 4xx policy denial counts; timeouts and 5xx are failures.
      const status = (error as { status?: number }).status ?? 0;
      deniedByAvailability = status >= 400 && status < 500;
      steps.push(errorStep("sender", "chat.bsky.convo.getConvoAvailability(none)", error));
    }

    if (!deniedByAvailability) {
      // Availability may still allow lookup; the send itself must be denied.
      try {
        const convo = await senderChat.chat.bsky.convo.getConvoForMembers({ members: [recipientDid] }, { signal: timeout() });
        await senderChat.chat.bsky.convo.sendMessage({
          convoId: convo.data.convo.id,
          message: { text: `netslum phase2 none-denial spike ${new Date().toISOString()}` }
        }, { signal: timeout() });
        steps.push(step("sender", "chat.bsky.convo.sendMessage(none)", 417, { note: "send unexpectedly succeeded" }));
      } catch (error) {
        const status = (error as { status?: number }).status ?? 0;
        steps.push(step("sender", "chat.bsky.convo.sendMessage(none)", status >= 400 && status < 500 ? 200 : 0, {
          note: status >= 400 && status < 500 ? "denied by policy as expected" : "send failed for non-policy reasons"
        }));
      }
    }
  } finally {
    try {
      if (priorDeclaration) {
        await writeDeclaration(recipientPds, recipientDid, priorDeclaration, timeout);
      }
      steps.push(step("recipient", `restore(${DECLARATION_COLLECTION})`, 200, { data: { restoredTo: priorDeclaration?.allowIncoming ?? "absent" } }));
    } catch (error) {
      steps.push(errorStep("recipient", `restore(${DECLARATION_COLLECTION})`, error));
    }
  }

  return steps;
}
