import { describe, expect, it } from "vitest";
import {
  normalizeActorInput,
  presentHandle,
  preparePostSchemaV2,
  tenantToolManifestSchema,
  graphMutationSchema,
  homeSettingsSchema,
  LOCAL_PDS_SUFFIX
} from "./index.js";

describe("Phase 2 identity helpers", () => {
  it("resolves bare local labels to the local PDS handle", () => {
    expect(normalizeActorInput("alice")).toBe(`alice${LOCAL_PDS_SUFFIX}`);
    expect(normalizeActorInput("Alice")).toBe(`alice${LOCAL_PDS_SUFFIX}`);
    expect(normalizeActorInput("@alice")).toBe(`alice${LOCAL_PDS_SUFFIX}`);
    expect(normalizeActorInput(" alice ")).toBe(`alice${LOCAL_PDS_SUFFIX}`);
  });

  it("keeps dotted handles and DIDs global", () => {
    expect(normalizeActorInput("macha.sh")).toBe("macha.sh");
    expect(normalizeActorInput("did:plc:zhwjxr5vygefr6zdw5mw7frs")).toBe("did:plc:zhwjxr5vygefr6zdw5mw7frs");
  });

  it("presents local handles as short labels and external handles fully", () => {
    expect(presentHandle(`alice${LOCAL_PDS_SUFFIX}`)).toBe("@alice");
    expect(presentHandle("macha.sh")).toBe("macha.sh");
    expect(presentHandle(`a.b${LOCAL_PDS_SUFFIX}`)).toBe(`a.b${LOCAL_PDS_SUFFIX}`);
  });
});

describe("Phase 2 post preparation", () => {
  it("defaults destination to town and rejects unknown fields", () => {
    const parsed = preparePostSchemaV2.parse({ text: "hello slum", expectedRevision: null });
    expect(parsed.destination).toBe("town");
    expect(() => preparePostSchemaV2.parse({ text: "x", destination: "dm" })).toThrow();
    expect(() => preparePostSchemaV2.parse({ text: "x", nope: true })).toThrow();
  });

  it("bounds text, languages, and media references", () => {
    expect(() => preparePostSchemaV2.parse({ text: "a".repeat(4001) })).toThrow();
    expect(() => preparePostSchemaV2.parse({ text: "x", languages: ["en", "fr", "de", "ja"] })).toThrow();
    expect(() => preparePostSchemaV2.parse({ text: "x", mediaDraftIds: ["1", "2", "3", "4", "5"] })).toThrow();
  });
});

describe("Phase 2 graph and home contracts", () => {
  it("accepts only known graph actions", () => {
    expect(graphMutationSchema.parse({ action: "follow", actor: "alice" }).action).toBe("follow");
    expect(() => graphMutationSchema.parse({ action: "share", actor: "alice" })).toThrow();
  });

  it("requires local-PDS-shaped home settings", () => {
    expect(homeSettingsSchema.parse({ did: "did:plc:abc", mode: "authored", activeHomePath: "home.html", updatedAt: 1 }).mode).toBe("authored");
    expect(() => homeSettingsSchema.parse({ did: "did:plc:abc", mode: "guest", activeHomePath: null, updatedAt: 1 })).toThrow();
  });
});

describe("Tenant tool manifest validation", () => {
  const validTool = {
    name: "shrine-status",
    description: "Reads the shrine lamp state",
    inputSchema: { type: "object", properties: { lamp: { type: "string", enum: ["on", "off"] } }, required: ["lamp"], additionalProperties: false }
  };

  it("accepts a valid manifest", () => {
    const parsed = tenantToolManifestSchema.parse({ version: 1, tools: [validTool] });
    expect(parsed.tools).toHaveLength(1);
  });

  it("rejects oversize, malformed, and dangerous manifests", () => {
    expect(() => tenantToolManifestSchema.parse({ version: 2, tools: [validTool] })).toThrow();
    expect(() => tenantToolManifestSchema.parse({ version: 1, tools: [] })).toThrow();
    expect(() => tenantToolManifestSchema.parse({ version: 1, tools: Array.from({ length: 9 }, (_, i) => ({ ...validTool, name: `tool-${i}` })) })).toThrow();
    expect(() => tenantToolManifestSchema.parse({ version: 1, tools: [{ ...validTool, inputSchema: { type: "object", properties: { x: { $ref: "http://evil.test/schema" } }, additionalProperties: false } }] })).toThrow();
    expect(() => tenantToolManifestSchema.parse({ version: 1, tools: [{ ...validTool, inputSchema: { type: "object", properties: {}, additionalProperties: true } }] })).toThrow();
  });
});
