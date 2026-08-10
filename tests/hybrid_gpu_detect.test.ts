import { describe, expect, it } from 'vitest';
import { hybridGpuLikely, isIntegratedGpuRendererName } from '../src/game/hybrid_gpu_detect';

describe('isIntegratedGpuRendererName', () => {
  it('matches Intel integrated families (Iris Xe/Plus, UHD, HD Graphics)', () => {
    expect(isIntegratedGpuRendererName('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)')).toBe(true);
    expect(isIntegratedGpuRendererName('Intel(R) Iris(TM) Plus Graphics 655')).toBe(true);
    expect(isIntegratedGpuRendererName('Intel(R) UHD Graphics 620')).toBe(true);
    expect(isIntegratedGpuRendererName('Intel(R) HD Graphics 520')).toBe(true);
    expect(isIntegratedGpuRendererName('Intel(R) UHD Graphics 730')).toBe(true);
  });

  it('matches integrated AMD Radeon/Vega APU graphics', () => {
    expect(isIntegratedGpuRendererName('AMD Radeon(TM) Graphics')).toBe(true);
    expect(isIntegratedGpuRendererName('AMD Radeon(TM) Vega 8 Graphics')).toBe(true);
  });

  it('does not match discrete desktop GPUs', () => {
    expect(isIntegratedGpuRendererName('NVIDIA GeForce RTX 4070/PCIe/SSE2')).toBe(false);
    expect(isIntegratedGpuRendererName('AMD Radeon RX 580')).toBe(false);
  });

  it('does not match Apple Silicon', () => {
    expect(isIntegratedGpuRendererName('Apple M1')).toBe(false);
    expect(isIntegratedGpuRendererName('Apple M3 Pro')).toBe(false);
  });

  it('does not match old mobile SoCs (a different, excluded weak class)', () => {
    expect(isIntegratedGpuRendererName('Adreno (TM) 618')).toBe(false);
    expect(isIntegratedGpuRendererName('Mali-T880')).toBe(false);
  });

  it('does not match a software rasterizer', () => {
    expect(isIntegratedGpuRendererName('SwiftShader')).toBe(false);
    expect(isIntegratedGpuRendererName('llvmpipe')).toBe(false);
  });

  it('is false for undefined/empty', () => {
    expect(isIntegratedGpuRendererName(undefined)).toBe(false);
    expect(isIntegratedGpuRendererName('')).toBe(false);
  });
});

describe('hybridGpuLikely', () => {
  it('is true for an integrated GPU signature outside the desktop shell', () => {
    expect(
      hybridGpuLikely({ gpuRenderer: 'Intel(R) Iris(R) Xe Graphics', desktopShell: false }),
    ).toBe(true);
  });

  it('is false inside the desktop shell, whatever the adapter string', () => {
    expect(
      hybridGpuLikely({ gpuRenderer: 'Intel(R) Iris(R) Xe Graphics', desktopShell: true }),
    ).toBe(false);
  });

  it('is false on single-GPU hardware (Apple Silicon, discrete-only desktop)', () => {
    expect(hybridGpuLikely({ gpuRenderer: 'Apple M2', desktopShell: false })).toBe(false);
    expect(hybridGpuLikely({ gpuRenderer: 'NVIDIA GeForce RTX 4070', desktopShell: false })).toBe(
      false,
    );
  });

  it('is false when the adapter string is unavailable', () => {
    expect(hybridGpuLikely({ gpuRenderer: undefined, desktopShell: false })).toBe(false);
  });
});
