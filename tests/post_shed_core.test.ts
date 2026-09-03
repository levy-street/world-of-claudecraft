import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POST_SHED_BLOOM_MIPS,
  POST_SHED_RUNGS,
  POST_SHED_STEP,
  postShedFloor,
  postShedGovernable,
  postShedPlan,
  postShedRungApplies,
  postShedRungCount,
  postShedRungLabel,
  postShedRungsApplied,
} from '../src/render/post_shed_core';

const FULL_CHAIN = { smaa: true, bloom: true, ao: true } as const;

describe('post shed core: the rung ladder', () => {
  it('pins the shed order and the step: SMAA to FXAA, bloom tail mips, bloom off, AO off', () => {
    expect(POST_SHED_RUNGS).toEqual(['smaa-to-fxaa', 'bloom-mips', 'bloom-off', 'ao-off']);
    expect(POST_SHED_STEP).toBe(0.25);
    expect(POST_SHED_BLOOM_MIPS).toBe(3);
  });

  it('applies one more rung per step down from 1', () => {
    expect(postShedRungsApplied(1)).toEqual([]);
    expect(postShedRungsApplied(0.75)).toEqual(['smaa-to-fxaa']);
    expect(postShedRungsApplied(0.5)).toEqual(['smaa-to-fxaa', 'bloom-mips']);
    expect(postShedRungsApplied(0.25)).toEqual(['smaa-to-fxaa', 'bloom-mips', 'bloom-off']);
    expect(postShedRungsApplied(0)).toEqual(['smaa-to-fxaa', 'bloom-mips', 'bloom-off', 'ao-off']);
  });

  it('labels a level by its deepest rung, full at 1', () => {
    expect(postShedRungLabel(1)).toBe('full');
    expect(postShedRungLabel(0.75)).toBe('smaa-to-fxaa');
    expect(postShedRungLabel(0.5)).toBe('bloom-mips');
    expect(postShedRungLabel(0.25)).toBe('bloom-off');
    expect(postShedRungLabel(0)).toBe('ao-off');
  });

  it('rounds the governor two-decimal levels onto the nearest rung and clamps garbage', () => {
    expect(postShedRungCount(0.74)).toBe(1);
    expect(postShedRungCount(0.51)).toBe(2);
    expect(postShedRungCount(1.4)).toBe(0);
    expect(postShedRungCount(-3)).toBe(4);
    expect(postShedRungCount(Number.NaN)).toBe(0);
  });
});

describe('post shed core: the static floor is a pure function of the chain', () => {
  it('floors a full composer chain at every rung and a grade-only chain at none', () => {
    expect(postShedFloor(FULL_CHAIN)).toBe(0);
    expect(postShedGovernable(FULL_CHAIN)).toBe(true);
    expect(postShedFloor({ smaa: false, bloom: false, ao: false })).toBe(1);
    expect(postShedGovernable({ smaa: false, bloom: false, ao: false })).toBe(false);
    expect(postShedFloor(null)).toBe(1);
    expect(postShedGovernable(null)).toBe(false);
  });

  it('floors at the DEEPEST rung the chain carries, so a missing pass never widens the walk', () => {
    // An Advanced mix with AO and bloom dialed off keeps only the SMAA rung.
    expect(postShedFloor({ smaa: true, bloom: false, ao: false })).toBe(0.75);
    // Bloom without SMAA reaches the bloom-off rung (the SMAA rung is a no-op step).
    expect(postShedFloor({ smaa: false, bloom: true, ao: false })).toBe(0.25);
    // AO alone still walks to the last rung.
    expect(postShedFloor({ smaa: false, bloom: false, ao: true })).toBe(0);
    expect(postShedFloor({ smaa: true, bloom: true, ao: false })).toBe(0.25);
  });

  it('maps each rung to exactly the pass it sheds', () => {
    expect(postShedRungApplies('smaa-to-fxaa', { smaa: true, bloom: false, ao: false })).toBe(true);
    expect(postShedRungApplies('smaa-to-fxaa', { smaa: false, bloom: true, ao: true })).toBe(false);
    expect(postShedRungApplies('bloom-mips', { smaa: false, bloom: true, ao: false })).toBe(true);
    expect(postShedRungApplies('bloom-off', { smaa: false, bloom: true, ao: false })).toBe(true);
    expect(postShedRungApplies('bloom-off', { smaa: true, bloom: false, ao: true })).toBe(false);
    expect(postShedRungApplies('ao-off', { smaa: false, bloom: false, ao: true })).toBe(true);
    expect(postShedRungApplies('ao-off', { smaa: true, bloom: true, ao: false })).toBe(false);
  });
});

describe('post shed core: the pass plan per level', () => {
  it('walks the full chain rung by rung', () => {
    expect(postShedPlan(FULL_CHAIN, 1)).toEqual({
      smaa: true,
      gradeFxaa: false,
      bloom: true,
      bloomMips: 5,
      ao: true,
    });
    expect(postShedPlan(FULL_CHAIN, 0.75)).toEqual({
      smaa: false,
      gradeFxaa: true,
      bloom: true,
      bloomMips: 5,
      ao: true,
    });
    expect(postShedPlan(FULL_CHAIN, 0.5)).toEqual({
      smaa: false,
      gradeFxaa: true,
      bloom: true,
      bloomMips: 3,
      ao: true,
    });
    expect(postShedPlan(FULL_CHAIN, 0.25)).toEqual({
      smaa: false,
      gradeFxaa: true,
      bloom: false,
      bloomMips: 5,
      ao: true,
    });
    expect(postShedPlan(FULL_CHAIN, 0)).toEqual({
      smaa: false,
      gradeFxaa: true,
      bloom: false,
      bloomMips: 5,
      ao: false,
    });
  });

  it('never plans a pass the chain did not build, and never trades SMAA it lacks for FXAA', () => {
    const noSmaa = { smaa: false, bloom: true, ao: true };
    for (const level of [1, 0.75, 0.5, 0.25, 0]) {
      expect(postShedPlan(noSmaa, level).smaa).toBe(false);
      expect(postShedPlan(noSmaa, level).gradeFxaa).toBe(false);
    }
    const noBloom = { smaa: true, bloom: false, ao: true };
    for (const level of [1, 0.75, 0.5, 0.25, 0])
      expect(postShedPlan(noBloom, level).bloom).toBe(false);
    const noAo = { smaa: true, bloom: true, ao: false };
    for (const level of [1, 0.75, 0.5, 0.25, 0]) expect(postShedPlan(noAo, level).ao).toBe(false);
  });

  it('is pure: the same level yields the same plan on every call', () => {
    expect(postShedPlan(FULL_CHAIN, 0.5)).toEqual(postShedPlan(FULL_CHAIN, 0.5));
  });
});

describe('post shed core: the fairness guard', () => {
  it('imports nothing and reads no tier, preset, profile or governor (the level is its only input)', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'src', 'render', 'post_shed_core.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/^import /m);
    for (const forbidden of [
      'GFX',
      'GfxTier',
      'fxTier',
      'data-fx-level',
      'localStorage',
      'window',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
