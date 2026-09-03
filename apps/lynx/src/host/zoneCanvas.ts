import { renderZoneScene, sceneParamsFromSeed, zoneKeySeed, type SceneObject } from "../scene.js";
import { state, host } from "./state.js";

let zoneCanvas: HTMLCanvasElement | null = null;
let zoneCtx: CanvasRenderingContext2D | null = null;
const sceneSeeds = new Map<string, string>();

export function initZoneCanvas(): void {
  zoneCanvas = document.createElement("canvas");
  zoneCanvas.id = "netslum-zone-canvas";
  zoneCanvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none";
  document.body.append(zoneCanvas);

  host.style.position = "relative";
  host.style.zIndex = "1";

  zoneCtx = zoneCanvas.getContext("2d");
}

export function updateZoneScene(zoneKey: string, objects: unknown[]): void {
  if (!zoneCtx || !zoneCanvas) return;
  state.sceneKey = zoneKey;
  document.body.classList.toggle("zone-route", true);

  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(window.innerWidth);
  const height = Math.floor(window.innerHeight);

  if (zoneCanvas.width !== width * dpr || zoneCanvas.height !== height * dpr) {
    zoneCanvas.width = width * dpr;
    zoneCanvas.height = height * dpr;
  }

  const drawId = ++state.sceneDrawGeneration;
  void (async () => {
    let seed = sceneSeeds.get(zoneKey);
    if (!seed) {
      seed = await zoneKeySeed(zoneKey);
      sceneSeeds.set(zoneKey, seed);
    }
    if (state.sceneKey !== zoneKey || drawId !== state.sceneDrawGeneration || !zoneCtx) return;
    zoneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderZoneScene(zoneCtx, zoneKey, seed, sceneParamsFromSeed(seed, width), objects as SceneObject[], width, height);
  })();
}

export function clearZoneScene(): void {
  state.sceneKey = "";
  document.body.classList.toggle("zone-route", false);
  if (zoneCtx && zoneCanvas) zoneCtx.clearRect(0, 0, zoneCanvas.width, zoneCanvas.height);
}

export function zoneKeyForPath(pathname: string): string | null {
  if (pathname === "/gate") return "hidden.archive.echo";
  return pathname.startsWith("/zone/") ? pathname.slice("/zone/".length) : null;
}
