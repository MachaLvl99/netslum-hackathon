import type { GeometryData, Object3DType } from "./types.js";

/**
 * 3D Geometry Generators for WebGPU & Canvas 3D rendering.
 */

export function createCubeGeometry(size = 1): GeometryData {
  const s = size / 2;
  const positions = new Float32Array([
    // Front face
    -s, -s,  s,   s, -s,  s,   s,  s,  s,  -s,  s,  s,
    // Back face
    -s, -s, -s,  -s,  s, -s,   s,  s, -s,   s, -s, -s,
    // Top face
    -s,  s, -s,  -s,  s,  s,   s,  s,  s,   s,  s, -s,
    // Bottom face
    -s, -s, -s,   s, -s, -s,   s, -s,  s,  -s, -s,  s,
    // Right face
     s, -s, -s,   s,  s, -s,   s,  s,  s,   s, -s,  s,
    // Left face
    -s, -s, -s,  -s, -s,  s,  -s,  s,  s,  -s,  s, -s
  ]);

  const normals = new Float32Array([
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
    1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
    -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0
  ]);

  const indices = new Uint16Array([
    0, 1, 2,    0, 2, 3,    // Front
    4, 5, 6,    4, 6, 7,    // Back
    8, 9, 10,   8, 10, 11,  // Top
    12, 13, 14, 12, 14, 15, // Bottom
    16, 17, 18, 16, 18, 19, // Right
    20, 21, 22, 20, 22, 23  // Left
  ]);

  return { positions, normals, indices };
}

export function createPyramidGeometry(base = 1, height = 1.2): GeometryData {
  const s = base / 2;
  const h = height;

  const positions = new Float32Array([
    // Apex
    0, h, 0,
    // Base 4 corners
    -s, 0,  s,
     s, 0,  s,
     s, 0, -s,
    -s, 0, -s
  ]);

  const normals = new Float32Array([
    0, 1, 0,
    -0.5, 0.5,  0.5,
     0.5, 0.5,  0.5,
     0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5
  ]);

  const indices = new Uint16Array([
    0, 1, 2, // Front
    0, 2, 3, // Right
    0, 3, 4, // Back
    0, 4, 1, // Left
    1, 4, 3, 1, 3, 2 // Base
  ]);

  return { positions, normals, indices };
}

export function createMonolithGeometry(w = 0.5, h = 1.8, d = 0.2): GeometryData {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const positions = new Float32Array([
    -hw, -hh,  hd,   hw, -hh,  hd,   hw,  hh,  hd,  -hw,  hh,  hd,
    -hw, -hh, -hd,  -hw,  hh, -hd,   hw,  hh, -hd,   hw, -hh, -hd,
    -hw,  hh, -hd,  -hw,  hh,  hd,   hw,  hh,  hd,   hw,  hh, -hd,
    -hw, -hh, -hd,   hw, -hh, -hd,   hw, -hh,  hd,  -hw, -hh,  hd,
     hw, -hh, -hd,   hw,  hh, -hd,   hw,  hh,  hd,   hw, -hh,  hd,
    -hw, -hh, -hd,  -hw, -hh,  hd,  -hw,  hh,  hd,  -hw,  hh, -hd
  ]);

  const normals = new Float32Array([
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
    1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
    -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0
  ]);

  const indices = new Uint16Array([
    0, 1, 2,    0, 2, 3,
    4, 5, 6,    4, 6, 7,
    8, 9, 10,   8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23
  ]);

  return { positions, normals, indices };
}

export function createPortalRingGeometry(radius = 1.4, tube = 0.15, segments = 24): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const radialSegments = segments;
  const tubularSegments = 12;

  for (let j = 0; j <= radialSegments; j++) {
    for (let i = 0; i <= tubularSegments; i++) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const v = (j / radialSegments) * Math.PI * 2;

      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = (radius + tube * Math.cos(v)) * Math.sin(u);
      const z = tube * Math.sin(v);

      positions.push(x, y, z);

      const nx = Math.cos(v) * Math.cos(u);
      const ny = Math.cos(v) * Math.sin(u);
      const nz = Math.sin(v);
      normals.push(nx, ny, nz);
    }
  }

  for (let j = 1; j <= radialSegments; j++) {
    for (let i = 1; i <= tubularSegments; i++) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}

export function createSphereGeometry(radius = 1, segments = 16): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let lat = 0; lat <= segments; lat++) {
    const theta = (lat * Math.PI) / segments;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= segments; lon++) {
      const phi = (lon * 2 * Math.PI) / segments;
      const x = Math.cos(phi) * sinTheta;
      const y = cosTheta;
      const z = Math.sin(phi) * sinTheta;

      positions.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
    }
  }

  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const first = lat * (segments + 1) + lon;
      const second = first + segments + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}

export function getGeometryForType(type: Object3DType): GeometryData {
  switch (type) {
    case "cube":
      return createCubeGeometry(1.2);
    case "pyramid":
      return createPyramidGeometry(1.4, 1.5);
    case "monolith":
      return createMonolithGeometry(0.7, 2.0, 0.25);
    case "portal_ring":
    case "torus":
      return createPortalRingGeometry(1.3, 0.18, 28);
    case "sphere":
      return createSphereGeometry(1.0, 16);
    default:
      return createCubeGeometry(1.2);
  }
}
