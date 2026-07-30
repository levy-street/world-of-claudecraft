import { describe, expect, it, vi } from 'vitest';
import {
  isSoftwareRendererName,
  type ProbeCanvas,
  probeMajorPerformanceCaveat,
  SOFTWARE_RENDERER_PATTERN,
} from '../src/render/software_renderer';

// Real unmasked-renderer strings for software rasterizers. WARP (Microsoft Basic Render Driver) is
// the Windows D3D11 software fallback Chromium switched to when 141 removed the SwiftShader path.
const SOFTWARE_RENDERERS = [
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11-10.0.22621.3235)',
  'Google SwiftShader',
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  'Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)',
  'Apple Software Renderer',
];

// Real unmasked-renderer strings for actual GPUs: none carry a software token.
const HARDWARE_RENDERERS = [
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'NVIDIA GeForce RTX 3070 Laptop GPU',
];

function fakeCanvas(getContext: ProbeCanvas['getContext']): ProbeCanvas {
  return { getContext };
}

describe('isSoftwareRendererName', () => {
  it('flags every real software rasterizer adapter string, including WARP', () => {
    for (const name of SOFTWARE_RENDERERS) {
      expect(isSoftwareRendererName(name), name).toBe(true);
    }
  });

  it('does not flag real GPU adapters, undefined, null, or blank', () => {
    for (const name of HARDWARE_RENDERERS) {
      expect(isSoftwareRendererName(name), name).toBe(false);
    }
    expect(isSoftwareRendererName(undefined)).toBe(false);
    expect(isSoftwareRendererName(null)).toBe(false);
    expect(isSoftwareRendererName('')).toBe(false);
    expect(isSoftwareRendererName('   ')).toBe(false);
  });

  it('pins the exact shared token set (kept in step with gfx classifyGpuRenderer)', () => {
    expect(SOFTWARE_RENDERER_PATTERN.source).toBe(
      'swiftshader|llvmpipe|basic render|softpipe|microsoft basic|software',
    );
    expect(SOFTWARE_RENDERER_PATTERN.flags).toBe('i');
  });
});

describe('probeMajorPerformanceCaveat', () => {
  it('returns true when both webgl2 and webgl are refused (software)', () => {
    const getContext = vi.fn(() => null);
    expect(probeMajorPerformanceCaveat(fakeCanvas(getContext))).toBe(true);
    // both context types are tried, each with the caveat attribute set
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(getContext).toHaveBeenNthCalledWith(1, 'webgl2', { failIfMajorPerformanceCaveat: true });
    expect(getContext).toHaveBeenNthCalledWith(2, 'webgl', { failIfMajorPerformanceCaveat: true });
  });

  it('returns false and releases the probe context when webgl2 succeeds', () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext } : null,
    );
    const getContext = vi.fn((contextId: string) =>
      contextId === 'webgl2' ? { getExtension } : null,
    );
    expect(probeMajorPerformanceCaveat(fakeCanvas(getContext))).toBe(false);
    // stops at the first success (never asks for webgl) and releases the context so it does
    // not count against the per-domain live-context limit
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('returns false via the webgl fallback when webgl2 is refused but webgl succeeds', () => {
    // The arm that keeps a webgl2-less hardware machine (old driver, forced GL1) from
    // being misclassified as software: webgl2 refused, plain webgl accelerated.
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext } : null,
    );
    const getContext = vi.fn((contextId: string) =>
      contextId === 'webgl' ? { getExtension } : null,
    );
    expect(probeMajorPerformanceCaveat(fakeCanvas(getContext))).toBe(false);
    // webgl2 was tried first, the webgl fallback succeeded, and that context was released
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(getContext).toHaveBeenNthCalledWith(1, 'webgl2', { failIfMajorPerformanceCaveat: true });
    expect(getContext).toHaveBeenNthCalledWith(2, 'webgl', { failIfMajorPerformanceCaveat: true });
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('returns null when getContext itself throws', () => {
    const getContext = vi.fn(() => {
      throw new Error('context creation failed');
    });
    expect(probeMajorPerformanceCaveat(fakeCanvas(getContext))).toBeNull();
  });

  it('returns null in Node when there is no canvas and no document', () => {
    expect(typeof document).toBe('undefined');
    expect(probeMajorPerformanceCaveat()).toBeNull();
  });
});
