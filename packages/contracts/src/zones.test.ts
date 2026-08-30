import { describe, expect, it } from "vitest";
import { parseZoneKey, zoneMutationSchema, zoneSeed } from "./index.js";

describe("Chaos Gate contracts", () => {
  it("accepts only ordered canonical keywords", () => {
    expect(parseZoneKey("hidden.archive.echo")).toBe("hidden.archive.echo");
    expect(() => parseZoneKey("archive.hidden.echo")).toThrow();
    expect(() => parseZoneKey("hidden.archive.echo.extra")).toThrow();
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
