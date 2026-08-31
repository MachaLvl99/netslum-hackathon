import { describe, expect, it, vi } from "vitest";
import { registerNetslumTools } from "./webmcp.js";

interface CapturedTool {
  name: string;
  inputSchema: Record<string, unknown>;
  signal?: AbortSignal;
}

const captureTools = (authenticated: boolean): CapturedTool[] => {
  const tools: CapturedTool[] = [];
  vi.stubGlobal("document", {
    modelContext: {
      registerTool: (tool: CapturedTool, opts?: { signal?: AbortSignal }) => {
        tools.push({ ...tool, signal: opts?.signal });
        return Promise.resolve();
      }
    }
  });
  try {
    registerNetslumTools(
      () => {},
      authenticated
        ? { authenticated: true, did: "did:plc:test", handle: "test.pds.netslum.macha.sh", canPublishSite: true }
        : { authenticated: false },
      new AbortController().signal
    );
  } finally {
    vi.unstubAllGlobals();
  }
  return tools;
};

describe("WebMCP tool registration", () => {
  it("registers exactly the 3 public tools when unauthenticated", () => {
    const tools = captureTools(false);
    expect(tools.map((t) => t.name)).toEqual(["show_town_square", "open_chaos_gate", "show_profile"]);
  });

  it("registers all 12 tools when authenticated", () => {
    const tools = captureTools(true);
    expect(tools).toHaveLength(12);
  });

  it("every schema is a closed object with explicit required and an abort signal", () => {
    const tools = captureTools(true);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      expect(tool.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
