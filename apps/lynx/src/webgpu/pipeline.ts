import type { WebGpuSceneSpec } from "./types.js";
import { getGeometryForType } from "./geometry.js";

/**
 * WGSL Shader Code for Cyber 3D Objects in WebGPU.
 */
export const CYBER_WGSL_SHADER = `
struct Uniforms {
  modelViewProjectionMatrix : mat4x4<f32>,
  normalMatrix : mat4x4<f32>,
  color : vec4<f32>,
  lightDir : vec4<f32>,
  time : f32,
  wireframe : f32,
  glow : f32,
  padding : f32,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
};

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) fragNormal : vec3<f32>,
  @location(1) fragPos : vec3<f32>,
};

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;
  output.Position = uniforms.modelViewProjectionMatrix * vec4<f32>(input.position, 1.0);
  output.fragNormal = (uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz;
  output.fragPos = input.position;
  return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(input.fragNormal);
  let L = normalize(uniforms.lightDir.xyz);
  let V = vec3<f32>(0.0, 0.0, 1.0);

  // Diffuse
  let diff = max(dot(N, L), 0.15);

  // Cyber Fresnel edge glow
  let fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5) * uniforms.glow;

  // Base color
  var baseColor = uniforms.color.rgb;
  let finalRgb = baseColor * diff + baseColor * fresnel * 0.8;

  return vec4<f32>(finalRgb, uniforms.color.a);
}
`;

export interface WebGpuEngineInstance {
  updateScene(scene: WebGpuSceneSpec): void;
  destroy(): void;
}


/**
 * Creates and mounts a live 3D WebGPU / Canvas rendering engine on a canvas element.
 */
export function initWebGpuEngine(
  canvas: HTMLCanvasElement,
  initialScene: WebGpuSceneSpec
): WebGpuEngineInstance {
  let activeScene = { ...initialScene };
  let animId = 0;
  let isDestroyed = false;
  let rotationTime = 0;

  // Matrix math helpers

  // 2D Projection Fallback Renderer (guaranteed to run anywhere)
  function renderCanvas2DFallback(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = activeScene.background || "#070910";
    ctx.fillRect(0, 0, width, height);

    // Cyber grid floor
    if (activeScene.gridFloor !== false) {
      ctx.strokeStyle = "rgba(87, 230, 255, 0.12)";
      ctx.lineWidth = 1;
      const horizon = height * 0.65;
      const vanishingX = width * 0.5;

      for (let x = -width; x <= width * 2; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(vanishingX, horizon);
        ctx.stroke();
      }
      for (let y = horizon + 10; y < height; y += (y - horizon) * 0.45 + 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    const cx = width / 2;
    const cy = height / 2 - 10;
    const scale = Math.min(width, height) * 0.28;

    for (const obj of activeScene.objects) {
      const geo = getGeometryForType(obj.type);
      const pos = obj.position ?? [0, 0, 0];
      const spin = obj.spinSpeed ?? [0.015, 0.02, 0.0];
      const rx = (obj.rotation?.[0] ?? 0) + rotationTime * (spin[0] ?? 0.015);
      const ry = (obj.rotation?.[1] ?? 0) + rotationTime * (spin[1] ?? 0.02);
      const objScale = obj.scale ?? [1, 1, 1];
      const color = typeof obj.color === "string" ? obj.color : "#57E6FF";

      // 3D Wireframe projection
      ctx.strokeStyle = color;
      ctx.lineWidth = obj.wireframe ? 1.5 : 2.0;
      ctx.shadowColor = color;
      ctx.shadowBlur = obj.glow !== false ? 12 : 0;

      const projectedPoints: Array<{ x: number; y: number; z: number }> = [];
      const numVertices = Math.floor(geo.positions.length / 3);
      const sx = objScale[0] ?? 1;
      const sy = objScale[1] ?? 1;
      const sz = objScale[2] ?? 1;
      const posX = pos[0] ?? 0;
      const posY = pos[1] ?? 0;
      const posZ = pos[2] ?? 0;

      for (let i = 0; i < numVertices; i++) {
        const rawX = geo.positions[i * 3] ?? 0;
        const rawY = geo.positions[i * 3 + 1] ?? 0;
        const rawZ = geo.positions[i * 3 + 2] ?? 0;
        const x = rawX * sx;
        const y = rawY * sy;
        const z = rawZ * sz;

        // Rotate Y
        const cosY = Math.cos(ry);
        const sinY = Math.sin(ry);
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;

        // Rotate X
        const cosX = Math.cos(rx);
        const sinX = Math.sin(rx);
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        // Perspective depth projection
        const depth = z2 + 4.0 + posZ;
        const fov = 300 / Math.max(0.1, depth);
        const px = cx + (x1 + posX) * scale * (fov / 300);
        const py = cy - (y2 + posY) * scale * (fov / 300);

        projectedPoints.push({ x: px, y: py, z: depth });
      }

      // Draw wireframe edges from index buffer
      ctx.beginPath();
      for (let i = 0; i < geo.indices.length; i += 3) {
        const i0 = geo.indices[i]!;
        const i1 = geo.indices[i + 1]!;
        const i2 = geo.indices[i + 2]!;

        const p0 = projectedPoints[i0];
        const p1 = projectedPoints[i1];
        const p2 = projectedPoints[i2];

        if (p0 && p1 && p2) {
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p0.x, p0.y);
        }
      }
      ctx.stroke();
    }
  }

  // Check WebGPU availability and bootstrap
  let webgpuDevice: unknown = null;
  let webgpuContext: unknown = null;

  async function tryInitWebGpu(): Promise<boolean> {
    const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<unknown> }> } };
    if (!nav.gpu) return false;
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) return false;
      webgpuDevice = await adapter.requestDevice();
      webgpuContext = canvas.getContext("webgpu");
      return !!(webgpuDevice && webgpuContext);
    } catch {
      return false;
    }
  }

  void (async () => {
    const hasWebGpu = await tryInitWebGpu();
    const ctx2d = !hasWebGpu ? canvas.getContext("2d") : null;

    function frame(): void {
      if (isDestroyed) return;
      rotationTime += 1;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 400;
      const h = canvas.clientHeight || 280;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      if (ctx2d) {
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderCanvas2DFallback(ctx2d, w, h);
      } else if (ctx2d === null && canvas.getContext("2d")) {
        const fallback = canvas.getContext("2d");
        if (fallback) {
          fallback.setTransform(dpr, 0, 0, dpr, 0, 0);
          renderCanvas2DFallback(fallback, w, h);
        }
      }

      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);
  })();

  return {
    updateScene: (newScene: WebGpuSceneSpec) => {
      activeScene = { ...newScene };
    },
    destroy: () => {
      isDestroyed = true;
      if (animId) cancelAnimationFrame(animId);
    }
  };
}
