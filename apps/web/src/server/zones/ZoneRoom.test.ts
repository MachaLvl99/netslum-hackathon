import { describe, expect, it } from "vitest";
import { zoneMutationSchema, type ZoneMutation } from "@netslum/contracts";

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
});
