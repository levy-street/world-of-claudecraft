import type * as THREE from 'three';
import type WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';

export type RenderBackendKind = 'webgl2' | 'webgpu';
export type RenderBackendPreference = 'webgl2' | 'webgpu';
export type ThreeRenderer = THREE.WebGLRenderer | WebGPURenderer;

export interface RenderBackend {
  readonly kind: RenderBackendKind;
  readonly renderer: ThreeRenderer;
  readonly experimental: boolean;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void | Promise<void>;
  dispose(): void;
}

export interface RenderBackendSelection {
  kind: RenderBackendKind;
  requested: RenderBackendPreference;
  fallback: boolean;
  reason: string;
}
