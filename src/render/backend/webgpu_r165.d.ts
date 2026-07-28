// The r165 runtime forwards this WebGPU adapter option to requestAdapter, but
// the matching @types/three declaration omitted it.
declare module 'three/addons/renderers/webgpu/WebGPURenderer.js' {
  interface WebGPURendererParameters {
    powerPreference?: 'low-power' | 'high-performance';
  }
}
