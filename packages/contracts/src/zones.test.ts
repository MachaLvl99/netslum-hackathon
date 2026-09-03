import { describe, expect, it } from "vitest";
import { parseZoneKey, zoneMutationSchema, zoneSeed } from "./index.js";

describe("Chaos Gate contracts", () => {
  it("accepts only ordered canonical keywords", () => {
    expect(parseZoneKey("hidden.archive.echo")).toBe("hidden.archive.echo");
    expect(() => parseZoneKey("archive.hidden.echo")).toThrow();
    expect(() => parseZoneKey("hidden.archive.echo.extra")).toThrow();
  });

  it("accepts the Paradise example zone keywords", () => {
    // "hidden forbidden holy ground" — the .hack-style example zone.
    expect(parseZoneKey("hidden.forbidden.holy_ground")).toBe("hidden.forbidden.holy_ground");
    expect(() => parseZoneKey("forbidden.hidden.holy_ground")).toThrow();
    expect(() => parseZoneKey("holy_ground.forbidden.hidden")).toThrow();
  });

  it("derives stable deterministic scenes", async () => {
    await expect(zoneSeed("electric.cathedral.dawn")).resolves.toEqual(await zoneSeed("electric.cathedral.dawn"));
    await expect(zoneSeed("electric.cathedral.dawn")).resolves.not.toEqual(await zoneSeed("silent.garden.rain"));
  });

  it("rejects extra mutation fields", () => {
    const parsed = zoneMutationSchema.safeParse({ expectedVersion: 0, operations: [{ op: "place", object: { type: "note", x: 1, y: 2, text: "echo", extra: true } }] });
    expect(parsed.success).toBe(false);
  });
});
