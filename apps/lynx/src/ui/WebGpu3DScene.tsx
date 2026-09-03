import { useState, useEffect } from "@lynx-js/react";
import { Box } from "./Box.js";
import { Text } from "./typography.js";
import { getGeometryForType } from "../webgpu/geometry.js";
import type { WebGpuObject3D } from "../webgpu/types.js";

export interface WebGpu3DSceneProps {
  title?: string | undefined;
  objects?: WebGpuObject3D[] | undefined;
  gridFloor?: boolean | undefined;
  height?: string | number | undefined;
  autoRotate?: boolean | undefined;
}

interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
}

interface ProjectedEdge {
  x1: number;
  y1: number;
  length: number;
  angle: number;
  color: string;
  depth: number;
  glow: boolean;
}

/**
 * WebGpu3DScene — High-performance real-time 3D wireframe & mesh engine
 * for Lynx, projecting 3D models with perspective, depth sorting, and cyber glow.
 */
export function WebGpu3DScene({
  title = "3D WEBGPU CYBER MATRIX",
  objects = [],
  gridFloor = true,
  height = "260px",
  autoRotate = true
}: WebGpu3DSceneProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!autoRotate) return;
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 3600);
    }, 45);
    return () => clearInterval(timer);
  }, [autoRotate]);

  // Viewport dimensions
  const viewWidth = 440;
  const viewHeight = 220;
  const cx = viewWidth / 2;
  const cy = viewHeight / 2 - 5;
  const baseScale = 80;

  const defaultObjs: WebGpuObject3D[] = objects.length > 0 ? objects : [
    { id: "def-1", type: "portal_ring", name: "CHAOS_WARP_RING", color: "#57E6FF", glow: true, spinSpeed: [0.015, 0.025, 0.0] },
    { id: "def-2", type: "torus", name: "ENERGY_CORE", color: "#00FF9D", glow: true, spinSpeed: [-0.02, 0.018, 0.01] },
    { id: "def-3", type: "monolith", name: "TWILIGHT_OBELISK", color: "#B388FF", glow: true, spinSpeed: [0.0, 0.012, 0.0] }
  ];

  // Calculate 3D projections for all objects
  const allEdges: ProjectedEdge[] = [];
  const allNodes: Array<{ x: number; y: number; color: string; size: number }> = [];

  defaultObjs.forEach((obj, objIdx) => {
    const geo = getGeometryForType(obj.type);
    const pos = obj.position || (defaultObjs.length > 1 ? [(objIdx - (defaultObjs.length - 1) / 2) * 1.3, 0, 0] : [0, 0, 0]);
    const spin = obj.spinSpeed || [0.018, 0.025, 0.01];
    const rx = (obj.rotation?.[0] || 0) + tick * (spin[0] ?? 0.018);
    const ry = (obj.rotation?.[1] || 0) + tick * (spin[1] ?? 0.025);
    const rz = (obj.rotation?.[2] || 0) + tick * (spin[2] ?? 0.01);
    const objScale = obj.scale || [1, 1, 1];
    const color = typeof obj.color === "string" ? obj.color : "#57E6FF";
    const glow = obj.glow !== false;

    const projectedPoints: ProjectedPoint[] = [];
    const numVertices = Math.floor(geo.positions.length / 3);

    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const cosZ = Math.cos(rz);
    const sinZ = Math.sin(rz);

    const sx = objScale[0] ?? 1;
    const sy = objScale[1] ?? 1;
    const sz = objScale[2] ?? 1;
    const posX = pos[0] ?? 0;
    const posY = pos[1] ?? 0;
    const posZ = pos[2] ?? 0;

    for (let i = 0; i < numVertices; i++) {
      const rawX = (geo.positions[i * 3] ?? 0) * sx;
      const rawY = (geo.positions[i * 3 + 1] ?? 0) * sy;
      const rawZ = (geo.positions[i * 3 + 2] ?? 0) * sz;

      // Rotate around X, Y, Z
      const x1 = rawX * cosZ - rawY * sinZ;
      const y1 = rawX * sinZ + rawY * cosZ;
      const z1 = rawZ;

      const x2 = x1 * cosY + z1 * sinY;
      const y2 = y1;
      const z2 = -x1 * sinY + z1 * cosY;

      const x3 = x2;
      const y3 = y2 * cosX - z2 * sinX;
      const z3 = y2 * sinX + z2 * cosX;

      // Camera perspective projection
      const worldX = x3 + posX;
      const worldY = y3 + posY;
      const worldZ = z3 + posZ + 3.6;

      const fov = 320 / Math.max(0.1, worldZ);
      const px = cx + worldX * baseScale * (fov / 320);
      const py = cy - worldY * baseScale * (fov / 320);

      projectedPoints.push({ x: px, y: py, z: worldZ });

      // Add vertex glowing node for prominent vertices
      if (i % 3 === 0 && glow) {
        allNodes.push({ x: px, y: py, color, size: Math.max(3, Math.min(6, Math.floor(18 / worldZ))) });
      }
    }

    // Helper to add edge
    function addEdge(pA: ProjectedPoint, pB: ProjectedPoint) {
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1 || len > 280) return;
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const avgDepth = (pA.z + pB.z) / 2;
      allEdges.push({ x1: pA.x, y1: pA.y, length: len, angle: ang, color, depth: avgDepth, glow });
    }

    // Connect wireframe edges from index buffer
    for (let i = 0; i < geo.indices.length; i += 3) {
      const p0 = projectedPoints[geo.indices[i]!];
      const p1 = projectedPoints[geo.indices[i + 1]!];
      const p2 = projectedPoints[geo.indices[i + 2]!];

      if (p0 && p1 && p2) {
        addEdge(p0, p1);
        addEdge(p1, p2);
        addEdge(p2, p0);
      }
    }
  });

  // Perspective Horizon Grid lines
  const horizonY = cy + 55;
  const gridLines: Array<{ key: string; x1: number; y1: number; length: number; angle: number }> = [];
  if (gridFloor) {
    for (let gx = -60; gx <= viewWidth + 60; gx += 50) {
      const x2 = cx + (gx - cx) * 0.15;
      const y2 = horizonY;
      const dx = x2 - gx;
      const dy = y2 - viewHeight;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      gridLines.push({ key: `vg-${gx}`, x1: gx, y1: viewHeight, length: len, angle: ang });
    }
  }

  return (
    <Box
      direction="column"
      background="surface"
      border={{ color: "brand", size: "1px" }}
      round="medium"
      elevation="glow"
      pad="medium"
      gap="small"
      width="100%"
    >
      {/* Header bar */}
      <Box direction="row" justify="between" align="center" border={{ side: "bottom", color: "borderSubtle" }} pad={{ bottom: "small" }}>
        <Box direction="row" align="center" gap="small">
          <Text size="medium" weight="bold" color="brand" mono>
            ❖ {title}
          </Text>
          <Box background="brandGlow" border={{ color: "brand", size: "1px" }} round="full" pad={{ horizontal: "xsmall", vertical: "none" }}>
            <Text size="xsmall" weight="bold" color="brand" mono>
              WEBGPU 3D
            </Text>
          </Box>
        </Box>
        <Text size="xsmall" color="accentPhosphor" mono>
          {defaultObjs.map((o) => o.name || o.type).join(" // ")}
        </Text>
      </Box>

      {/* 3D Viewport */}
      <Box
        height={height}
        background="background"
        border={{ color: "borderSubtle", size: "1px" }}
        round="small"
        position="relative"
        overflow="hidden"
        style="box-shadow:inset 0 0 28px rgba(7,9,16,0.95);"
      >
        {/* Cyber Horizon Grid Floor */}
        {gridLines.map((g) => (
          <view
            key={g.key}
            style={`position:absolute;left:${g.x1}px;top:${g.y1}px;width:${g.length}px;height:1px;transform:rotate(${g.angle}deg);transform-origin:0 0;background-color:rgba(87,230,255,0.14);pointer-events:none;`}
          />
        ))}

        {/* 3D Wireframe Edges */}
        {allEdges.slice(0, 160).map((edge, eIdx) => {
          const opacity = Math.max(0.25, Math.min(1.0, 1.4 - (edge.depth - 2) * 0.25));
          const glowShadow = edge.glow ? `box-shadow:0 0 6px ${edge.color};` : "";
          return (
            <view
              key={`edge-${eIdx}`}
              style={`position:absolute;left:${edge.x1}px;top:${edge.y1}px;width:${edge.length}px;height:${edge.glow ? 1.8 : 1.2}px;transform:rotate(${edge.angle}deg);transform-origin:0 0;background-color:${edge.color};opacity:${opacity};${glowShadow}pointer-events:none;`}
            />
          );
        })}

        {/* Glowing 3D Vertices */}
        {allNodes.slice(0, 40).map((node, nIdx) => (
          <view
            key={`node-${nIdx}`}
            style={`position:absolute;left:${node.x - node.size / 2}px;top:${node.y - node.size / 2}px;width:${node.size}px;height:${node.size}px;border-radius:9999px;background-color:${node.color};box-shadow:0 0 10px ${node.color};pointer-events:none;`}
          />
        ))}

        {/* Center Energy Pulse Node */}
        <view
          style={`position:absolute;left:${cx - 3}px;top:${cy - 3}px;width:6px;height:6px;border-radius:9999px;background-color:#57E6FF;box-shadow:0 0 12px #57E6FF;pointer-events:none;`}
        />

        {/* Viewport Overlay HUD */}
        <Box position="absolute" top="8px" left="8px" direction="row" gap="xxsmall">
          <Text size="xsmall" color="textSubtle" mono>
            DEPTH: REALTIME // ROT: {(tick % 360).toString().padStart(3, "0")}°
          </Text>
        </Box>

        <Box position="absolute" bottom="8px" right="8px">
          <Text size="xsmall" color="brand" mono>
            [ 3D MATRIX ACTIVE ]
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
