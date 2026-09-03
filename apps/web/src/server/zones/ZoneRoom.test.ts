import { describe, expect, it } from "vitest";
import { zoneMutationSchema, experienceSchema, type ZoneMutation } from "@netslum/contracts";

describe("Zone mutation logic and validations", () => {
  it("parses valid place, move, edit, and delete operations", () => {
    const validBatch: ZoneMutation = {
      expectedVersion: 0,
      operations: [
        {
          op: "place",
          object: { type: "note", x: 100, y: 200, text: "Hello Net Slum" }
        },
        {
          op: "place",
          object: { type: "sigil", x: 300, y: 400, shape: "star", color: "cyan" }
        },
        {
          op: "place",
          object: { type: "portal", x: 500, y: 600, targetZoneKey: "burning.market.static" }
        },
        {
          op: "move",
          id: "11111111-1111-4111-8111-111111111111",
          x: 150,
          y: 250
        },
        {
          op: "edit",
          id: "11111111-1111-4111-8111-111111111111",
          value: { text: "Updated Note" }
        },
        {
          op: "delete",
          id: "11111111-1111-4111-8111-111111111111"
        }
      ]
    };
    const parsed = zoneMutationSchema.safeParse(validBatch);
    expect(parsed.success).toBe(true);
  });

  it("rejects batches with 0 or >20 operations", () => {
    const empty = zoneMutationSchema.safeParse({ expectedVersion: 0, operations: [] });
    expect(empty.success).toBe(false);

    const oversizedOps = Array.from({ length: 21 }, () => ({
      op: "place",
      object: { type: "note", x: 10, y: 20, text: "note" }
    }));
    const oversized = zoneMutationSchema.safeParse({ expectedVersion: 0, operations: oversizedOps });
    expect(oversized.success).toBe(false);
  });

  it("validates coordinates must be integers within 0..999", () => {
    const outOfBounds = zoneMutationSchema.safeParse({
      expectedVersion: 0,
      operations: [{ op: "place", object: { type: "note", x: 1000, y: 200, text: "bad x" } }]
    });
    expect(outOfBounds.success).toBe(false);

    const negative = zoneMutationSchema.safeParse({
      expectedVersion: 0,
      operations: [{ op: "place", object: { type: "note", x: 10, y: -5, text: "negative y" } }]
    });
    expect(negative.success).toBe(false);
  });

  it("validates portal targets must be canonical 3-word keys", () => {
    const validPortal = zoneMutationSchema.safeParse({
      expectedVersion: 0,
      operations: [{ op: "place", object: { type: "portal", x: 100, y: 100, targetZoneKey: "silent.garden.rain" } }]
    });
    expect(validPortal.success).toBe(true);

    const invalidPortal = zoneMutationSchema.safeParse({
      expectedVersion: 0,
      operations: [{ op: "place", object: { type: "portal", x: 100, y: 100, targetZoneKey: "invalid.key" } }]
    });
    expect(invalidPortal.success).toBe(false);
  });

  it("accepts portal with experience and preserves it through payload round-trip", () => {
    // Schema acceptance: portal place with experience
    const withExperience = zoneMutationSchema.safeParse({
      expectedVersion: 0,
      operations: [{
        op: "place",
        object: {
          type: "portal",
          x: 500,
          y: 500,
          targetZoneKey: "burning.market.static",
          experience: { siteSlug: "macha", path: "index.html", title: "Macha District" }
        }
      }]
    });
    expect(withExperience.success).toBe(true);
    if (!withExperience.success) return;

    // Simulate the payload construction from ZoneRoom.place handler (line 158)
    const op = withExperience.data.operations[0]!;
    if (op.op !== "place") return;
    const obj = op.object;
    if (obj.type !== "portal") return;
    const payload = {
      targetZoneKey: obj.targetZoneKey,
      ...(obj.experience ? { experience: obj.experience } : {})
    };

    // Verify experience is stored in the serialized payload
    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.targetZoneKey).toBe("burning.market.static");
    expect(parsed.experience).toBeDefined();

    // Simulate the read path from rowToObject (lines 70-73)
    const candidate = experienceSchema.safeParse(parsed.experience);
    expect(candidate.success).toBe(true);
    if (candidate.success) {
      expect(candidate.data.siteSlug).toBe("macha");
      expect(candidate.data.path).toBe("index.html");
      expect(candidate.data.title).toBe("Macha District");
    }
  });

  it("portal without experience still works (backward compat)", () => {
    const withoutExperience = zoneMutationSchema.safeParse({
      expectedVersion: 0,
      operations: [{
        op: "place",
        object: { type: "portal", x: 100, y: 100, targetZoneKey: "silent.garden.rain" }
      }]
    });
    expect(withoutExperience.success).toBe(true);
    if (!withoutExperience.success) return;

    const op = withoutExperience.data.operations[0]!;
    if (op.op !== "place") return;
    const obj = op.object;
    if (obj.type !== "portal") return;
    const payload = {
      targetZoneKey: obj.targetZoneKey,
      ...(obj.experience ? { experience: obj.experience } : {})
    };
    expect(payload).toEqual({ targetZoneKey: "silent.garden.rain" });
    expect("experience" in payload).toBe(false);
  });
});
