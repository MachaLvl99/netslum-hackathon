import { describe, expect, it, vi } from "vitest";
import { registerNetslumTools, type SessionInfo } from "./webmcp.js";

interface CapturedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execute?: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  signal?: AbortSignal;
}

const captureTools = (session: SessionInfo, navigate = vi.fn()): { tools: CapturedTool[]; navigate: typeof navigate } => {
  const tools: CapturedTool[] = [];
  vi.stubGlobal("document", {
    cookie: "__Host-netslum-csrf=test-csrf-token",
    modelContext: {
      registerTool: (tool: CapturedTool, opts?: { signal?: AbortSignal }) => {
        tools.push({ ...tool, ...(opts?.signal ? { signal: opts.signal } : {}) });
        return Promise.resolve();
      }
    }
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn()
  });

  try {
    registerNetslumTools(
      navigate,
      session,
      new AbortController().signal
    );
  } finally {
    vi.unstubAllGlobals();
  }
  return { tools, navigate };
};

const DM_TOOL_NAMES = [
  "list_conversations",
  "read_conversation",
  "prepare_message",
  "send_prepared_message",
  "list_message_requests",
  "mark_conversation_read",
  "react_to_message",
  "delete_message_for_self"
];

const SITE_TOOL_NAMES = [
  "open_site_editor",
  "read_site_file",
  "save_site_file",
  "delete_site_file",
  "publish_site"
];

describe("WebMCP tool registration", () => {
  it("registers exactly the 3 public tools when unauthenticated", () => {
    const { tools } = captureTools({ authenticated: false });
    expect(tools.map((t) => t.name)).toEqual(["show_town_square", "open_chaos_gate", "show_profile"]);
  });

  it("registers 38 general tools when authenticated with no site publish or DM agent", () => {
    const { tools } = captureTools({ authenticated: true, did: "did:plc:test", handle: "test.bsky.social" });
    expect(tools).toHaveLength(38);
    for (const dmTool of DM_TOOL_NAMES) {
      expect(tools.some((t) => t.name === dmTool)).toBe(false);
    }
    for (const siteTool of SITE_TOOL_NAMES) {
      expect(tools.some((t) => t.name === siteTool)).toBe(false);
    }
  });

  it("registers 43 tools when canPublishSite is true and dmAgentEnabled is false", () => {
    const { tools } = captureTools({
      authenticated: true,
      did: "did:plc:test",
      handle: "alice.pds.netslum.macha.sh",
      canPublishSite: true,
      dmAgentEnabled: false
    });
    expect(tools).toHaveLength(43);
    for (const siteTool of SITE_TOOL_NAMES) {
      expect(tools.some((t) => t.name === siteTool)).toBe(true);
    }
    for (const dmTool of DM_TOOL_NAMES) {
      expect(tools.some((t) => t.name === dmTool)).toBe(false);
    }
  });

  it("registers all 51 tools when both canPublishSite and dmAgentEnabled are true", () => {
    const { tools } = captureTools({
      authenticated: true,
      did: "did:plc:test",
      handle: "alice.pds.netslum.macha.sh",
      canPublishSite: true,
      dmAgentEnabled: true
    });
    expect(tools).toHaveLength(51);
    for (const dmTool of DM_TOOL_NAMES) {
      expect(tools.some((t) => t.name === dmTool)).toBe(true);
    }
    for (const siteTool of SITE_TOOL_NAMES) {
      expect(tools.some((t) => t.name === siteTool)).toBe(true);
    }
  });

  it("every schema is a closed object with explicit required and an abort signal", () => {
    const { tools } = captureTools({
      authenticated: true,
      did: "did:plc:test",
      handle: "alice.pds.netslum.macha.sh",
      canPublishSite: true,
      dmAgentEnabled: true
    });
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      expect(tool.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("WebMCP tool schemas", () => {
  const { tools } = captureTools({
    authenticated: true,
    did: "did:plc:test",
    handle: "alice.pds.netslum.macha.sh",
    canPublishSite: true,
    dmAgentEnabled: true
  });
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  it("prepare_message schema specifies recipientDids and text", () => {
    const tool = toolMap.get("prepare_message");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["recipientDids", "text"]);
    const props = tool?.inputSchema.properties as Record<string, unknown>;
    expect(props.recipientDids).toBeDefined();
    expect(props.text).toBeDefined();
  });

  it("prepare_post schema is V2 with destination, quote, languages, and mediaDraftIds", () => {
    const tool = toolMap.get("prepare_post");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["text"]);
    const props = tool?.inputSchema.properties as Record<string, unknown>;
    expect(props.destination).toBeDefined();
    expect(props.replyToUri).toBeDefined();
    expect(props.quoteUri).toBeDefined();
    expect(props.quoteCid).toBeDefined();
    expect(props.languages).toBeDefined();
    expect(props.mediaDraftIds).toBeDefined();
    expect(props.expectedRevision).toBeDefined();
  });

  it("read_conversation schema specifies convoId", () => {
    const tool = toolMap.get("read_conversation");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["convoId"]);
  });

  it("missing F1 tool schemas are correctly configured", () => {
    const reqTool = toolMap.get("list_message_requests");
    expect(reqTool?.inputSchema.required).toEqual([]);

    const readTool = toolMap.get("mark_conversation_read");
    expect(readTool?.inputSchema.required).toEqual(["convoId"]);

    const reactTool = toolMap.get("react_to_message");
    expect(reactTool?.inputSchema.required).toEqual(["convoId", "messageId", "emoji"]);

    const delTool = toolMap.get("delete_message_for_self");
    expect(delTool?.inputSchema.required).toEqual(["convoId", "messageId"]);

    const searchFeeds = toolMap.get("search_feeds");
    expect(searchFeeds?.inputSchema.required).toEqual(["q"]);

    const showFeed = toolMap.get("show_feed");
    expect(showFeed?.inputSchema.required).toEqual(["feedUri"]);

    const showHome = toolMap.get("show_home");
    expect(showHome?.inputSchema.required).toEqual([]);

    const showDistrict = toolMap.get("show_district");
    expect(showDistrict?.inputSchema.required).toEqual(["slug"]);
  });
});

describe("WebMCP tool execution handlers", () => {
  it("prepare_message sends recipientDids and text to /api/dms/prepare", async () => {
    const { tools } = captureTools({ authenticated: true, dmAgentEnabled: true });
    const tool = tools.find((t) => t.name === "prepare_message");
    expect(tool).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ revision: "rev-abc123", sizeBytes: 24, recipients: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      cookie: "__Host-netslum-csrf=csrf123",
      modelContext: { registerTool: () => Promise.resolve() }
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });

    try {
      const result = await tool?.execute?.({
        recipientDids: ["did:plc:bob"],
        text: "hello bob"
      }) as { ok: boolean; data: { revision: string; sizeBytes: number; recipients: number } };

      expect(result.ok).toBe(true);
      expect(result.data.revision).toBe("rev-abc123");
      expect(fetchMock).toHaveBeenCalledWith("/api/dms/prepare", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipientDids: ["did:plc:bob"], text: "hello bob" })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("read_conversation maps sender from both sender.did and senderDid", async () => {
    const { tools } = captureTools({ authenticated: true, dmAgentEnabled: true });
    const tool = tools.find((t) => t.name === "read_conversation");
    expect(tool).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        messages: [
          { id: "m1", text: "msg from object sender", sender: { did: "did:plc:sender1" } },
          { id: "m2", text: "msg from scalar sender", senderDid: "did:plc:sender2" }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      cookie: "",
      modelContext: { registerTool: () => Promise.resolve() }
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });

    try {
      const result = await tool?.execute?.({ convoId: "convo-1" }) as {
        ok: boolean;
        data: Array<{ id: string; sender: string; textPreview: string }>;
      };

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([
        { id: "m1", sender: "did:plc:sender1", textPreview: "msg from object sender" },
        { id: "m2", sender: "did:plc:sender2", textPreview: "msg from scalar sender" }
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prepare_post V2 sends draft payload to /api/post-draft", async () => {
    const { tools } = captureTools({ authenticated: true });
    const tool = tools.find((t) => t.name === "prepare_post");
    expect(tool).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ draftRevision: "rev-post-123", graphemes: 10, bytes: 10 })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      cookie: "__Host-netslum-csrf=csrf123",
      modelContext: { registerTool: () => Promise.resolve() }
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });

    try {
      const result = await tool?.execute?.({
        text: "hello world",
        destination: "bluesky",
        languages: ["en"]
      }) as { ok: boolean; data: { draftRevision: string } };

      expect(result.ok).toBe(true);
      expect(result.data.draftRevision).toBe("rev-post-123");
      expect(fetchMock).toHaveBeenCalledWith("/api/post-draft", expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          text: "hello world",
          destination: "bluesky",
          expectedRevision: null,
          languages: ["en"]
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("react_to_message posts to /api/dms/react", async () => {
    const { tools } = captureTools({ authenticated: true, dmAgentEnabled: true });
    const tool = tools.find((t) => t.name === "react_to_message");
    expect(tool).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      cookie: "__Host-netslum-csrf=csrf123",
      modelContext: { registerTool: () => Promise.resolve() }
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });

    try {
      const result = await tool?.execute?.({
        convoId: "c1",
        messageId: "m1",
        action: "add",
        emoji: "👍"
      }) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith("/api/dms/react", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          convoId: "c1",
          messageId: "m1",
          value: "👍",
          remove: false
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("delete_message_for_self posts to /api/dms/delete-for-self", async () => {
    const { tools } = captureTools({ authenticated: true, dmAgentEnabled: true });
    const tool = tools.find((t) => t.name === "delete_message_for_self");
    expect(tool).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      cookie: "__Host-netslum-csrf=csrf123",
      modelContext: { registerTool: () => Promise.resolve() }
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });

    try {
      const result = await tool?.execute?.({
        convoId: "c1",
        messageId: "m1"
      }) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith("/api/dms/delete-for-self", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ convoId: "c1", messageId: "m1" })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("show_district navigates to district route", () => {
    const navigate = vi.fn();
    const { tools } = captureTools({ authenticated: true }, navigate);
    const tool = tools.find((t) => t.name === "show_district");
    expect(tool).toBeDefined();

    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    try {
      const result = tool?.execute?.({ slug: "alice" }) as unknown as { ok: boolean; url: string; data: { slug: string; url: string } };
      expect(result.ok).toBe(true);
      expect(navigate).toHaveBeenCalledWith("/district/alice");
      expect(result.data.slug).toBe("alice");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
