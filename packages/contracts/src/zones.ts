import { z } from "zod";

export const zonePrefixes = ["hidden", "burning", "silent", "wandering", "broken", "electric"] as const;
export const zonePlaces = ["archive", "garden", "cathedral", "market", "labyrinth", "harbor"] as const;
export const zoneStates = ["dawn", "echo", "rain", "static", "dream", "void"] as const;
export const palette = {
  cyan: "#57E6FF", violet: "#8B5CFF", magenta: "#FF4FD8", amber: "#FFBF47",
  mint: "#62F6B5", cobalt: "#4E7BFF", coral: "#FF6B6B", silver: "#C8D1E1"
} as const;
export const featuredZones = [
  "hidden.archive.echo", "burning.market.static", "silent.garden.rain",
  "wandering.harbor.dream", "broken.labyrinth.void", "electric.cathedral.dawn"
] as const;

export const zoneKeySchema = z.string().refine((value) => {
  const [prefix, place, state, extra] = value.split(".");
  return extra === undefined && zonePrefixes.includes(prefix as never) && zonePlaces.includes(place as never) && zoneStates.includes(state as never);
}, "Invalid Chaos Gate key");

const coordinate = z.number().int().min(0).max(999);
const noteValue = z.object({ type: z.literal("note"), x: coordinate, y: coordinate, text: z.string().min(1).max(280) }).strict();
const sigilValue = z.object({ type: z.literal("sigil"), x: coordinate, y: coordinate, shape: z.enum(["circle", "triangle", "square", "star", "wave"]), color: z.enum(Object.keys(palette) as [keyof typeof palette, ...(keyof typeof palette)[]]) }).strict();
const portalValue = z.object({ type: z.literal("portal"), x: coordinate, y: coordinate, targetZoneKey: zoneKeySchema }).strict();

export const zoneOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("place"), object: z.discriminatedUnion("type", [noteValue, sigilValue, portalValue]) }).strict(),
  z.object({ op: z.literal("move"), id: z.uuid(), x: coordinate, y: coordinate }).strict(),
  z.object({ op: z.literal("edit"), id: z.uuid(), value: z.union([
    z.object({ text: z.string().min(1).max(280) }).strict(),
    z.object({ shape: sigilValue.shape.shape, color: sigilValue.shape.color }).strict(),
    z.object({ targetZoneKey: zoneKeySchema }).strict()
  ]) }).strict(),
  z.object({ op: z.literal("delete"), id: z.uuid() }).strict()
]);

export const zoneMutationSchema = z.object({ expectedVersion: z.number().int().nonnegative(), operations: z.array(zoneOperationSchema).min(1).max(20) }).strict();
export type PaletteToken = keyof typeof palette;
export type ZoneOperation = z.infer<typeof zoneOperationSchema>;
export type ZoneMutation = z.infer<typeof zoneMutationSchema>;
export type ZoneObject = {
  id: string; type: "note" | "sigil" | "portal"; x: number; y: number; ownerDid: string;
  createdAt: string; updatedAt: string; text?: string; shape?: "circle" | "triangle" | "square" | "star" | "wave";
  color?: keyof typeof palette; targetZoneKey?: string;
};
export type ZoneSnapshot = { zoneKey: string; version: number; objects: ZoneObject[] };

export function parseZoneKey(value: string): string {
  return zoneKeySchema.parse(value);
}

export async function zoneSeed(value: string): Promise<{ density: number; glowX: number; glowY: number; paletteOffset: number }> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parseZoneKey(value))));
  return { density: 16 + (bytes[0] ?? 0) % 28, glowX: bytes[1] ?? 0, glowY: bytes[2] ?? 0, paletteOffset: (bytes[3] ?? 0) % 8 };
}
