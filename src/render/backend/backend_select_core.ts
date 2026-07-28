import type { RenderBackendPreference, RenderBackendSelection } from './types';

export interface RenderBackendCapabilities {
  secureContext: boolean;
  navigatorGpu: boolean;
  forwardProfileCompatible: boolean;
  forceWebGl2: boolean;
}

export function requestedRenderBackend(search: string): RenderBackendPreference {
  const requested = new URLSearchParams(search).get('renderer');
  return requested?.toLowerCase() === 'webgpu' ? 'webgpu' : 'webgl2';
}

export function selectRenderBackend(
  requested: RenderBackendPreference,
  capabilities: RenderBackendCapabilities,
): RenderBackendSelection {
  if (requested === 'webgl2') {
    return {
      kind: 'webgl2',
      requested,
      fallback: false,
      reason: 'WebGL2 is the production default',
    };
  }
  if (capabilities.forceWebGl2) {
    return {
      kind: 'webgl2',
      requested,
      fallback: true,
      reason: 'WebGPU is disabled by the runtime kill switch',
    };
  }
  if (!capabilities.secureContext) {
    return {
      kind: 'webgl2',
      requested,
      fallback: true,
      reason: 'WebGPU requires a secure context',
    };
  }
  if (!capabilities.navigatorGpu) {
    return {
      kind: 'webgl2',
      requested,
      fallback: true,
      reason: 'WebGPU is unavailable in this browser',
    };
  }
  if (!capabilities.forwardProfileCompatible) {
    return {
      kind: 'webgl2',
      requested,
      fallback: true,
      reason: 'This scene requires the WebGL2 compatibility profile',
    };
  }
  return {
    kind: 'webgpu',
    requested,
    fallback: false,
    reason: 'Explicit experimental WebGPU request is supported',
  };
}
