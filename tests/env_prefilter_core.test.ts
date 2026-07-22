import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveEnvironmentPrefilterPlan } from '../src/render/env_prefilter_core';

describe('resolveEnvironmentPrefilterPlan', () => {
  it('keeps constrained WebKit to one immediate PMREM and schedules no deferred allocations', () => {
    expect(resolveEnvironmentPrefilterPlan(true, 'marsh')).toEqual({
      immediate: ['marsh'],
      deferred: [],
    });
  });

  it('uses Vale as the safe constrained fallback for a biome without a dedicated environment', () => {
    expect(resolveEnvironmentPrefilterPlan(true, 'beach')).toEqual({
      immediate: ['vale'],
      deferred: [],
    });
  });

  it('retains every environment on unconstrained renderers', () => {
    expect(resolveEnvironmentPrefilterPlan(false, 'marsh')).toEqual({
      immediate: ['vale', 'marsh', 'peaks'],
      deferred: [],
    });
  });

  it('drives the renderer without a deferred PMREM timer', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('resolveEnvironmentPrefilterPlan(GFX.constrainedMemory, initial)');
    expect(source).toContain(
      'const entryBiomes: BiomeId[] = envPlan.immediate;\n      if (GFX.constrainedMemory)',
    );
    expect(source).toContain(
      'for (const b of entryBiomes) {\n        const eq = this.skyView.envTexture(b);\n        if (eq) this.envRTs.set(b, pmrem.fromEquirectangular(eq));\n      }',
    );
    expect(source.match(/fromEquirectangular\(/g)).toHaveLength(1);
    expect(source).not.toContain('DEFERRED_ENV_PREFILTER');
    expect(source).not.toContain('deferred env prefilter:');
  });
});
