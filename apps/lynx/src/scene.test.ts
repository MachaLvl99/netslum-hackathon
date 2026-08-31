import { palette } from "@netslum/contracts";
import { describe, expect, it } from "vitest";
import { renderZoneScene, sceneParamsFromSeed, type SceneObject, zoneKeySeed } from "./scene.js";

const seedFor = async (key: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))), (b) => b.toString(16).padStart(2, "0")).join("");

describe("zone scene determinism", () => {
  it("derives identical params for the same key and size", async () => {
    const seed = await zoneKeySeed("hidden.archive.echo");
    expect(seed).toBe(await seedFor("hidden.archive.echo"));
    const a = sceneParamsFromSeed(seed, 1280);
    const b = sceneParamsFromSeed(seed, 1280);
    expect(a).toEqual(b);
    expect([...a.palette].sort()).toEqual([...Object.keys(palette)].sort());
  });

  it("derives different params for different keys", async () => {
    const a = sceneParamsFromSeed(await zoneKeySeed("hidden.archive.echo"), 1280);
    const b = sceneParamsFromSeed(await zoneKeySeed("silent.garden.rain"), 1280);
    expect(a.palette).not.toEqual(b.palette);
    expect([a.glowX, a.glowY]).not.toEqual([b.glowX, b.glowY]);
  });

  it("maps 0..999 object coordinates across the full canvas", async () => {
    const calls: Array<{ x: number; y: number }> = [];
    const ctx = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
      fillRect(x: number, y: number) { calls.push({ x, y }); },
      strokeRect() {},
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc() {}, rect() {}, ellipse() {}, quadraticCurveTo() {}, closePath() {},
      createRadialGradient() { return { addColorStop() {} } as unknown as CanvasGradient; }
    } as unknown as CanvasRenderingContext2D;
    const seed = await zoneKeySeed("hidden.archive.echo");
    const params = sceneParamsFromSeed(seed, 1280);
    const objects: SceneObject[] = [{ id: "1", type: "note", x: 999, y: 999, text: "corner" }];
    renderZoneScene(ctx, "hidden.archive.echo", seed, params, objects, 1280, 720);
    const body = calls.at(-1);
    expect(body).toBeDefined();
    // note body rect at (999,999) must reach the far right/bottom edge
    expect(body!.x).toBeGreaterThanOrEqual(1270 - 10.5);
    expect(body!.y).toBeGreaterThanOrEqual(720 - 8.5);
  });
});
