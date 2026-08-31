/**
 * Deterministic 2D Canvas scenes for Chaos Gate zones.
 * Per plan §4.2/§4.8: SHA-256 over the canonical zone key seeds texture
 * density, glow position, and palette ordering, so every client renders
 * the same scene. Host-owned (trusted) — rendered behind the Lynx view.
 */

import { palette as SCENE_PALETTE, type PaletteToken } from "@netslum/contracts";

export interface SceneObject {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  shape?: string;
  color?: string;
  targetZoneKey?: string;
}

const TOKENS = Object.keys(SCENE_PALETTE) as PaletteToken[];

/** SHA-256 hex of the key, lowercase. */
export async function zoneKeySeed(zoneKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(zoneKey));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deterministic 32-bit PRNG seeded from part of the hex seed. */
function mulberry32(seedHex: string, offset: number): () => number {
  let a = parseInt(seedHex.slice(offset, offset + 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ZoneSceneParams {
  /** Ordered palette tokens; index 0 is the primary glow. */
  palette: Array<keyof typeof SCENE_PALETTE>;
  /** 0..1 star/texture density. */
  density: number;
  /** Normalized glow position. */
  glowX: number;
  glowY: number;
  /** Grid cell size in px. */
  grid: number;
}

/** Derive all scene parameters deterministically from the seed. */
export function sceneParamsFromSeed(seed: string, width: number): ZoneSceneParams {
  const rand = mulberry32(seed, 0);
  const shuffled = [...TOKENS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const density = 0.25 + rand() * 0.5;
  const glowX = 0.15 + rand() * 0.7;
  const glowY = 0.15 + rand() * 0.7;
  const grid = Math.max(48, Math.round(width / 14 / 8) * 8);
  return { palette: shuffled, density, glowX, glowY, grid };
}

function drawSigilPath(ctx: CanvasRenderingContext2D, shape: string | undefined, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case "circle":
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case "square":
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
      break;
    case "triangle":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.87);
      ctx.lineTo(cx - r, cy + r * 0.87);
      ctx.closePath();
      break;
    case "star": {
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.44;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "wave":
      ctx.moveTo(cx - r, cy);
      ctx.quadraticCurveTo(cx - r / 2, cy - r, cx, cy);
      ctx.quadraticCurveTo(cx + r / 2, cy + r, cx + r, cy);
      break;
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

/**
 * Render the zone scene onto a 2D canvas. Pure function of
 * (zoneKey, objects, size) — same inputs always produce the same scene.
 */
export function renderZoneScene(
  ctx: CanvasRenderingContext2D,
  zoneKey: string,
  seed: string,
  params: ZoneSceneParams,
  objects: SceneObject[],
  width: number,
  height: number
): void {
  const { palette, density, glowX, glowY, grid } = params;
  const primary = SCENE_PALETTE[palette[0] ?? "cyan"];
  const secondary = SCENE_PALETTE[palette[1] ?? "violet"];
  const tertiary = SCENE_PALETTE[palette[2] ?? "magenta"];

  // Background wash
  ctx.fillStyle = "#070910";
  ctx.fillRect(0, 0, width, height);

  // Primary glow at deterministic position
  const glowR = Math.max(width, height) * 0.55;
  const g = ctx.createRadialGradient(glowX * width, glowY * height, 0, glowX * width, glowY * height, glowR);
  g.addColorStop(0, `${primary}2e`);
  g.addColorStop(0.4, `${primary}14`);
  g.addColorStop(1, "rgba(7,9,16,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Star field with deterministic density
  const rand = mulberry32(seed, 16);
  const starCount = Math.round(density * (width * height) / 1400);
  for (let i = 0; i < starCount; i++) {
    const sx = rand() * width;
    const sy = rand() * height;
    const sr = rand() * 1.6 + 0.3;
    ctx.fillStyle = i % 7 === 0 ? secondary : "#C8D1E1";
    ctx.globalAlpha = 0.12 + rand() * 0.5;
    ctx.fillRect(sx, sy, sr, sr);
  }
  ctx.globalAlpha = 1;

  // Grid lines
  ctx.strokeStyle = `${tertiary}30`;
  ctx.lineWidth = 1;
  for (let x = grid; x < width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = grid; y < height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Horizon scan line at deterministic height
  const scanY = Math.round(height * (0.3 + (parseInt(seed.slice(24, 32), 16) % 1000) / 2500));
  ctx.strokeStyle = `${primary}55`;
  ctx.beginPath();
  ctx.moveTo(0, scanY);
  ctx.lineTo(width, scanY);
  ctx.stroke();

  // Zone objects, mapped from the canonical 0..999 grid across the full canvas
  for (const obj of objects) {
    const cx = (obj.x / 999) * width;
    const cy = (obj.y / 999) * height;
    const color = obj.type === "sigil" && obj.color ? SCENE_PALETTE[obj.color as keyof typeof SCENE_PALETTE] : primary;
    if (obj.type === "portal") {
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 24, 34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `${secondary}33`;
      ctx.fill();
      continue;
    }
    if (obj.type === "note") {
      ctx.fillStyle = `${color}26`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.fillRect(cx - 10, cy - 8, 20, 16);
      ctx.strokeRect(cx - 10, cy - 8, 20, 16);
      ctx.fillStyle = color;
      ctx.fillRect(cx - 10, cy - 3, 12, 1.5);
      ctx.fillRect(cx - 10, cy, 8, 1.5);
      continue;
    }
    // sigil
    ctx.fillStyle = `${color}33`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    drawSigilPath(ctx, obj.shape, cx, cy, 12);
    ctx.fill();
    ctx.stroke();
  }
}
