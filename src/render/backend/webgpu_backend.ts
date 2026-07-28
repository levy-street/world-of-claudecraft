import type * as THREE from 'three';
import type { RenderBackend } from './types';

export interface WebGpuBackendOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
}

export async function createWebGpuBackend(options: WebGpuBackendOptions): Promise<RenderBackend> {
  const { default: WebGPURenderer } = await import(
    'three/addons/renderers/webgpu/WebGPURenderer.js'
  );
  const renderer = new WebGPURenderer({
    canvas: options.canvas,
    antialias: options.antialias ?? false,
    powerPreference: 'high-performance',
  });
  try {
    await renderer.init();
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  return {
    kind: 'webgpu',
    renderer,
    experimental: true,
    setPixelRatio: (value) => renderer.setPixelRatio(value),
    setSize: (width, height, updateStyle) => renderer.setSize(width, height, updateStyle),
    render: (scene: THREE.Scene, camera: THREE.Camera) => renderer.renderAsync(scene, camera),
    dispose: () => renderer.dispose(),
  };
}
