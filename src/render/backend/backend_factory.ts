import { requestedRenderBackend, selectRenderBackend } from './backend_select_core';
import type { RenderBackend, RenderBackendKind, RenderBackendSelection } from './types';
import { createWebGlBackend } from './webgl_backend';
import { createWebGpuBackend } from './webgpu_backend';

export interface RenderBackendFactories {
  webgl2(): RenderBackend | Promise<RenderBackend>;
  webgpu(): RenderBackend | Promise<RenderBackend>;
}

export interface RenderBackendFactoryResult {
  backend: RenderBackend;
  selection: RenderBackendSelection;
  initializationFallback: boolean;
}

export async function createRenderBackendWithFallback(
  selection: RenderBackendSelection,
  factories: RenderBackendFactories,
): Promise<RenderBackendFactoryResult> {
  if (selection.kind === 'webgl2') {
    return {
      backend: await factories.webgl2(),
      selection,
      initializationFallback: false,
    };
  }
  try {
    return {
      backend: await factories.webgpu(),
      selection,
      initializationFallback: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'WebGPU initialization failed';
    return {
      backend: await factories.webgl2(),
      selection: {
        kind: 'webgl2',
        requested: selection.requested,
        fallback: true,
        reason: `WebGPU initialization failed: ${reason}`,
      },
      initializationFallback: true,
    };
  }
}

export interface BrowserBackendOptions {
  canvas: HTMLCanvasElement;
  search: string;
  forwardProfileCompatible: boolean;
  forceWebGl2: boolean;
}

export async function createBrowserRenderBackend(
  options: BrowserBackendOptions,
): Promise<RenderBackendFactoryResult> {
  const requested = requestedRenderBackend(options.search);
  const selection = selectRenderBackend(requested, {
    secureContext: globalThis.isSecureContext === true,
    navigatorGpu:
      typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu !== undefined,
    forwardProfileCompatible: options.forwardProfileCompatible,
    forceWebGl2: options.forceWebGl2,
  });
  return createRenderBackendWithFallback(selection, {
    webgl2: () => createWebGlBackend({ canvas: options.canvas }),
    webgpu: () => createWebGpuBackend({ canvas: options.canvas }),
  });
}

export function isRequestedBackend(
  result: RenderBackendFactoryResult,
  kind: RenderBackendKind,
): boolean {
  return result.backend.kind === kind && !result.selection.fallback;
}
