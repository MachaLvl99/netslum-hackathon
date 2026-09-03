export type Object3DType =
  | "cube"
  | "sphere"
  | "torus"
  | "monolith"
  | "portal_ring"
  | "pyramid"
  | "cyber_grid"
  | "particles";

export interface WebGpuObject3D {
  id: string;
  type: Object3DType;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  color?: string | [number, number, number, number] | undefined;
  wireframe?: boolean | undefined;
  glow?: boolean | undefined;
  emissive?: string | undefined;
  spinSpeed?: [number, number, number] | undefined;
  name?: string | undefined;
}

export interface WebGpuSceneSpec {
  title?: string | undefined;
  background?: string | undefined;
  camera?: {
    position?: [number, number, number] | undefined;
    target?: [number, number, number] | undefined;
    fov?: number | undefined;
  } | undefined;
  light?: {
    position?: [number, number, number] | undefined;
    color?: string | undefined;
    intensity?: number | undefined;
  } | undefined;
  objects: WebGpuObject3D[];
  gridFloor?: boolean | undefined;
  bloom?: boolean | undefined;
  autoRotate?: boolean | undefined;
}

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}
