import { describe, expect, it } from 'vitest';
import {
  AUTO_FPS_FLOOR,
  AUTO_FPS_HEADROOM,
  type AutoDetectHints,
  classifyGpu,
  minTier,
  type RememberedAuto,
  recommendAutoTier,
  resolveAutoTier,
  tierRank,
} from '../src/render/gfx_autodetect';

const base: AutoDetectHints = { mobile: false, dpr: 1, softwareGl: false };
const angle = (gpu: string) => `ANGLE (${gpu}, OpenGL 4.5.0)`;

describe('classifyGpu', () => {
  it('flags software renderers', () => {
    expect(classifyGpu('ANGLE (Google, Vulkan 1.3 (SwiftShader Device))')).toBe('software');
    expect(classifyGpu('llvmpipe (LLVM 15.0.0, 256 bits)')).toBe('software');
  });

  it('buckets NVIDIA cards by generation', () => {
    expect(classifyGpu(angle('NVIDIA GeForce RTX 4070'))).toBe('strongDiscrete');
    expect(classifyGpu(angle('NVIDIA GeForce RTX 3080'))).toBe('strongDiscrete');
    expect(classifyGpu(angle('NVIDIA GeForce RTX 3070'))).toBe('strongDiscrete');
    // The bench machine: 3060 Ti is solid but classed mid (FPS-first caps at high regardless).
    expect(classifyGpu(angle('NVIDIA GeForce RTX 3060 Ti/PCIe/SSE2'))).toBe('midDiscrete');
    expect(classifyGpu(angle('NVIDIA GeForce GTX 1650'))).toBe('midDiscrete');
    expect(classifyGpu(angle('NVIDIA GeForce MX150'))).toBe('weak');
  });

  it('buckets AMD and Intel parts', () => {
    expect(classifyGpu(angle('AMD Radeon RX 6700 XT'))).toBe('strongDiscrete');
    expect(classifyGpu(angle('AMD Radeon RX 5700'))).toBe('midDiscrete');
    expect(classifyGpu(angle('AMD Radeon Vega 8 Graphics'))).toBe('integrated');
    expect(classifyGpu(angle('Intel(R) Arc(TM) A770 Graphics'))).toBe('midDiscrete');
    expect(classifyGpu(angle('Intel(R) Iris(R) Xe Graphics'))).toBe('integrated');
    expect(classifyGpu(angle('Intel(R) UHD Graphics 620'))).toBe('weak');
    expect(classifyGpu(angle('Intel(R) Iris(TM) Plus Graphics 655'))).toBe('weak');
  });

  it('buckets Apple Silicon and mobile SoCs', () => {
    expect(classifyGpu(angle('Apple M2 Pro'))).toBe('strongDiscrete');
    expect(classifyGpu(angle('Apple M1 Max'))).toBe('strongDiscrete');
    expect(classifyGpu(angle('Apple M1'))).toBe('midDiscrete');
    expect(classifyGpu('Adreno (TM) 730')).toBe('integrated');
    expect(classifyGpu('Mali-G57')).toBe('weak');
  });

  it('treats an empty or unrecognized string as unknown', () => {
    expect(classifyGpu(undefined)).toBe('unknown');
    expect(classifyGpu('')).toBe('unknown');
    expect(classifyGpu('Some Future GPU 9999')).toBe('unknown');
  });
});

describe('recommendAutoTier (FPS-first, never auto-ultra)', () => {
  it('maps GPU classes to tiers and never returns ultra', () => {
    expect(recommendAutoTier({ ...base, gpuRenderer: angle('NVIDIA GeForce RTX 4090') })).toBe(
      'high',
    );
    expect(recommendAutoTier({ ...base, gpuRenderer: angle('NVIDIA GeForce RTX 3060 Ti') })).toBe(
      'high',
    );
    expect(recommendAutoTier({ ...base, gpuRenderer: angle('Intel(R) Iris(R) Xe Graphics') })).toBe(
      'medium',
    );
    expect(recommendAutoTier({ ...base, gpuRenderer: angle('Intel(R) UHD Graphics 620') })).toBe(
      'low',
    );
    expect(recommendAutoTier({ ...base, gpuRenderer: 'SwiftShader', softwareGl: true })).toBe(
      'low',
    );
    expect(recommendAutoTier({ ...base, gpuRenderer: angle('Future GPU') })).toBe('medium');
  });

  it('forces low on phones and software GL regardless of the named GPU', () => {
    expect(recommendAutoTier({ ...base, mobile: true, gpuRenderer: angle('Apple M2') })).toBe(
      'low',
    );
    expect(
      recommendAutoTier({
        ...base,
        softwareGl: true,
        gpuRenderer: angle('NVIDIA GeForce RTX 4090'),
      }),
    ).toBe('low');
  });

  it('steps down one rung on high-DPI panels', () => {
    expect(
      recommendAutoTier({ ...base, gpuRenderer: angle('NVIDIA GeForce RTX 4070'), dpr: 2 }),
    ).toBe('medium');
    expect(
      recommendAutoTier({ ...base, gpuRenderer: angle('Intel(R) Iris(R) Xe Graphics'), dpr: 2 }),
    ).toBe('low');
  });

  it('caps memory- and core-starved machines', () => {
    expect(
      recommendAutoTier({
        ...base,
        gpuRenderer: angle('NVIDIA GeForce RTX 4070'),
        deviceMemory: 4,
      }),
    ).toBe('medium');
    expect(
      recommendAutoTier({
        ...base,
        gpuRenderer: angle('NVIDIA GeForce RTX 4070'),
        deviceMemory: 2,
      }),
    ).toBe('low');
    expect(
      recommendAutoTier({
        ...base,
        gpuRenderer: angle('NVIDIA GeForce RTX 4070'),
        hardwareConcurrency: 2,
      }),
    ).toBe('medium');
  });
});

describe('resolveAutoTier (cross-session step-down/up)', () => {
  const v = 14;
  const hints: AutoDetectHints = { ...base, gpuRenderer: angle('NVIDIA GeForce RTX 3060 Ti') }; // heuristic -> high

  it('ignores remembered samples from a different config version', () => {
    const stale: RememberedAuto = { v: 13, tier: 'low', fps: 20 };
    expect(resolveAutoTier(hints, stale, v)).toBe('high');
  });

  it('steps one rung down when last session ran below the floor', () => {
    const bad: RememberedAuto = { v, tier: 'high', fps: AUTO_FPS_FLOOR - 10 };
    expect(resolveAutoTier(hints, bad, v)).toBe('medium');
  });

  it('clamps to a remembered lower floor when the session was merely okay', () => {
    const okay: RememberedAuto = { v, tier: 'medium', fps: 75 };
    expect(resolveAutoTier(hints, okay, v)).toBe('medium');
  });

  it('lets a rung back up only with big headroom, never above the heuristic', () => {
    const fast: RememberedAuto = { v, tier: 'medium', fps: AUTO_FPS_HEADROOM + 20 };
    expect(resolveAutoTier(hints, fast, v)).toBe('high');
    const cap: RememberedAuto = { v, tier: 'high', fps: AUTO_FPS_HEADROOM + 50 };
    expect(resolveAutoTier(hints, cap, v)).toBe('high'); // never ultra
  });

  it('discards a remembered tier above the current heuristic as stale hardware', () => {
    const integrated: AutoDetectHints = {
      ...base,
      gpuRenderer: angle('Intel(R) Iris(R) Xe Graphics'),
    }; // -> medium
    const stale: RememberedAuto = { v, tier: 'high', fps: 30 };
    expect(resolveAutoTier(integrated, stale, v)).toBe('medium');
  });
});

describe('tier order helpers', () => {
  it('ranks and mins tiers', () => {
    expect(tierRank('low')).toBeLessThan(tierRank('medium'));
    expect(tierRank('high')).toBeLessThan(tierRank('ultra'));
    expect(minTier('high', 'medium')).toBe('medium');
    expect(minTier('low', 'ultra')).toBe('low');
  });
});
