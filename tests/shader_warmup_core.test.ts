// The decisions behind the self-warming shader cache (src/render/shader_warmup_core.ts).
//
// Two of them are load-bearing and get per-dimension coverage here. The IDENTITY
// is what keeps a corpus from another build, tier, GPU or extension set from
// being warmed at all: every input must move it, or a stale corpus would be
// submitted for programs this session never links. The PLAN is what keeps the
// submission off one frame: about 19 ms of main-thread work per program, so a
// plan that ever hands out two indices for one call is a freeze.
import { describe, expect, it } from 'vitest';
import {
  createShaderCorpusRecord,
  createWarmupPlan,
  isShaderCorpusRecord,
  nextWarmupIndex,
  readWarmupQuery,
  SHADER_CORPUS_PROGRAM_LIMIT,
  SHADER_CORPUS_VERSION,
  type ShaderCorpusIdentityInputs,
  selectCorpusPrograms,
  shaderCorpusIdentity,
  stopWarmup,
  warmupApplies,
  warmupProgress,
} from '../src/render/shader_warmup_core';

const IDENTITY: ShaderCorpusIdentityInputs = {
  buildId: 'a1b2c3d4e5f6',
  tier: 'ultra',
  adapter: 'NVIDIA GeForce RTX 3090',
  extensions: ['EXT_color_buffer_float', 'KHR_parallel_shader_compile'],
};

const pair = (n: number) => ({ vertex: `vertex ${n}`, fragment: `fragment ${n}` });

describe('shaderCorpusIdentity', () => {
  it('is stable for the same inputs', () => {
    expect(shaderCorpusIdentity(IDENTITY)).toBe(shaderCorpusIdentity({ ...IDENTITY }));
    expect(shaderCorpusIdentity(IDENTITY)).toContain('NVIDIA GeForce RTX 3090');
  });

  it('changes when the build changes', () => {
    expect(shaderCorpusIdentity({ ...IDENTITY, buildId: 'f6e5d4c3b2a1' })).not.toBe(
      shaderCorpusIdentity(IDENTITY),
    );
  });

  it('changes when the graphics tier changes', () => {
    expect(shaderCorpusIdentity({ ...IDENTITY, tier: 'high' })).not.toBe(
      shaderCorpusIdentity(IDENTITY),
    );
  });

  it('changes when the adapter changes', () => {
    expect(shaderCorpusIdentity({ ...IDENTITY, adapter: 'Mesa Intel(R) Graphics' })).not.toBe(
      shaderCorpusIdentity(IDENTITY),
    );
  });

  it('changes when an extension is added, dropped, or reordered', () => {
    const base = shaderCorpusIdentity(IDENTITY);
    expect(
      shaderCorpusIdentity({
        ...IDENTITY,
        extensions: [...IDENTITY.extensions, 'EXT_float_blend'],
      }),
    ).not.toBe(base);
    expect(shaderCorpusIdentity({ ...IDENTITY, extensions: ['EXT_color_buffer_float'] })).not.toBe(
      base,
    );
    expect(
      shaderCorpusIdentity({ ...IDENTITY, extensions: [...IDENTITY.extensions].reverse() }),
    ).not.toBe(base);
  });

  it('carries the record version, so a shape change invalidates every corpus', () => {
    expect(shaderCorpusIdentity(IDENTITY)).toContain(`v${SHADER_CORPUS_VERSION}`);
  });
});

describe('selectCorpusPrograms', () => {
  it('drops identical vertex+fragment pairs and keeps first-seen order', () => {
    const selected = selectCorpusPrograms([pair(1), pair(2), pair(1), pair(3), pair(2)]);
    expect(selected).toEqual([pair(1), pair(2), pair(3)]);
  });

  it('keeps a pair that shares only one half', () => {
    const shared = [
      { vertex: 'v', fragment: 'f1' },
      { vertex: 'v', fragment: 'f2' },
      { vertex: 'v2', fragment: 'f1' },
    ];
    expect(selectCorpusPrograms(shared)).toEqual(shared);
  });

  it('caps the set at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => pair(i));
    expect(selectCorpusPrograms(many, 8)).toHaveLength(8);
    expect(selectCorpusPrograms(many, 8)[7]).toEqual(pair(7));
    expect(selectCorpusPrograms(many)).toHaveLength(40);
    expect(SHADER_CORPUS_PROGRAM_LIMIT).toBeGreaterThan(390);
  });

  it('copies the sources rather than retaining the caller objects', () => {
    const source = { vertex: 'v', fragment: 'f' };
    const selected = selectCorpusPrograms([source]);
    expect(selected[0]).not.toBe(source);
    expect(selected[0]).toEqual(source);
  });
});

describe('createShaderCorpusRecord', () => {
  it('stamps the version and applies the selection', () => {
    const record = createShaderCorpusRecord({
      identity: 'id',
      savedAt: 1234,
      contextAttributes: { antialias: false },
      sources: [pair(1), pair(1), pair(2)],
      limit: 4,
    });
    expect(record).toEqual({
      version: SHADER_CORPUS_VERSION,
      identity: 'id',
      savedAt: 1234,
      contextAttributes: { antialias: false },
      programs: [pair(1), pair(2)],
    });
  });
});

describe('isShaderCorpusRecord', () => {
  const record = createShaderCorpusRecord({
    identity: 'id',
    savedAt: 1,
    contextAttributes: null,
    sources: [pair(1)],
  });

  it('accepts a record it just built', () => {
    expect(isShaderCorpusRecord(record)).toBe(true);
  });

  it('rejects anything else, one dimension at a time', () => {
    expect(isShaderCorpusRecord(null)).toBe(false);
    expect(isShaderCorpusRecord('corpus')).toBe(false);
    expect(isShaderCorpusRecord({ ...record, version: SHADER_CORPUS_VERSION + 1 })).toBe(false);
    expect(isShaderCorpusRecord({ ...record, identity: '' })).toBe(false);
    expect(isShaderCorpusRecord({ ...record, savedAt: Number.NaN })).toBe(false);
    expect(isShaderCorpusRecord({ ...record, programs: 'nope' })).toBe(false);
    expect(isShaderCorpusRecord({ ...record, programs: [{ vertex: 'v' }] })).toBe(false);
    expect(isShaderCorpusRecord({ ...record, programs: [null] })).toBe(false);
  });
});

describe('warmupApplies', () => {
  const ready = {
    enabled: true,
    parallelCompile: true,
    hasCorpus: true,
    identityMatches: true,
  };

  it('applies when every input is ready', () => {
    expect(warmupApplies(ready)).toEqual({ applies: true, reason: null });
  });

  it('names the reason for each missing input', () => {
    expect(warmupApplies({ ...ready, enabled: false })).toEqual({
      applies: false,
      reason: 'disabled',
    });
    expect(warmupApplies({ ...ready, hasCorpus: false })).toEqual({
      applies: false,
      reason: 'no-corpus',
    });
    expect(warmupApplies({ ...ready, identityMatches: false })).toEqual({
      applies: false,
      reason: 'identity-mismatch',
    });
    expect(warmupApplies({ ...ready, parallelCompile: false })).toEqual({
      applies: false,
      reason: 'no-parallel-compile',
    });
  });

  it('reports the player-facing switch first when several inputs are missing', () => {
    expect(
      warmupApplies({
        enabled: false,
        parallelCompile: false,
        hasCorpus: false,
        identityMatches: false,
      }).reason,
    ).toBe('disabled');
  });
});

describe('readWarmupQuery', () => {
  it('is on by default', () => {
    expect(readWarmupQuery('')).toEqual({ enabled: true, forced: false });
    expect(readWarmupQuery('?perf&gfx=ultra')).toEqual({ enabled: true, forced: false });
  });

  it('reads both arms of the override', () => {
    expect(readWarmupQuery('?shaderwarm=0')).toEqual({ enabled: false, forced: true });
    expect(readWarmupQuery('?perf&shaderwarm=0&gfx=low')).toEqual({ enabled: false, forced: true });
    expect(readWarmupQuery('?shaderwarm=1')).toEqual({ enabled: true, forced: true });
  });

  it('ignores a value it does not know', () => {
    expect(readWarmupQuery('?shaderwarm=maybe')).toEqual({ enabled: true, forced: false });
  });

  it('does not match a different flag that ends the same way', () => {
    expect(readWarmupQuery('?noshaderwarm=0')).toEqual({ enabled: true, forced: false });
  });
});

describe('the warm-up plan', () => {
  it('hands out one index per call, in order, then nothing', () => {
    const plan = createWarmupPlan(3);
    expect([
      nextWarmupIndex(plan),
      nextWarmupIndex(plan),
      nextWarmupIndex(plan),
      nextWarmupIndex(plan),
    ]).toEqual([0, 1, 2, null]);
    expect(warmupProgress(plan)).toEqual({ submitted: 3, total: 3, remaining: 0, done: true });
  });

  it('yields nothing more once stopped, whatever is left', () => {
    const plan = createWarmupPlan(10);
    expect(nextWarmupIndex(plan)).toBe(0);
    stopWarmup(plan);
    expect(nextWarmupIndex(plan)).toBeNull();
    expect(nextWarmupIndex(plan)).toBeNull();
    expect(warmupProgress(plan)).toEqual({ submitted: 1, total: 10, remaining: 0, done: true });
  });

  it('counts progress while it runs', () => {
    const plan = createWarmupPlan(4);
    nextWarmupIndex(plan);
    nextWarmupIndex(plan);
    expect(warmupProgress(plan)).toEqual({ submitted: 2, total: 4, remaining: 2, done: false });
  });

  it('treats an empty or nonsensical count as nothing to do', () => {
    for (const count of [0, -3, Number.NaN]) {
      const plan = createWarmupPlan(count);
      expect(plan.total).toBe(0);
      expect(nextWarmupIndex(plan)).toBeNull();
      expect(warmupProgress(plan).done).toBe(true);
    }
  });
});
