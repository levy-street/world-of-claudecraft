import * as THREE from 'three';
import type { RenderBackend } from './types';

export interface WebGlBackendOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  powerPreference?: WebGLPowerPreference;
}

export function createWebGlBackend(options: WebGlBackendOptions): RenderBackend {
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: options.antialias ?? false,
    powerPreference: options.powerPreference ?? 'high-performance',
  });
  return {
    kind: 'webgl2',
    renderer,
    experimental: false,
    setPixelRatio: (value) => renderer.setPixelRatio(value),
    setSize: (width, height, updateStyle) => renderer.setSize(width, height, updateStyle),
    render: (scene, camera) => renderer.render(scene, camera),
    dispose: () => renderer.dispose(),
  };
}
