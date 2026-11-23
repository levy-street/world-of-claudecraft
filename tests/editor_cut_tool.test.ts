import { describe, expect, it } from 'vitest';
import {
  applyCutChange,
  CUT_BRUSH_LIMITS,
  type CutBrush,
  cutSummary,
  DEFAULT_CUT_BRUSH,
  makeCut,
  normalizeAuthoredCut,
  sameCut,
} from '../src/editor/cut_tool_core';
import {
  CUT_MAX_HALF,
  cutSdfAt,
  HOLE_MAX_RADIUS,
  sanitizeTerrainCut,
} from '../src/sim/terrain_cuts';
import type { TerrainCut } from '../src/sim/types';

// The Cut tool's authoring decisions: what a click makes, and what a panel
// edit turns it into. The field those solids are evaluated against lives in
// tests/terrain_cuts.test.ts.

const brush = (over: Partial<CutBrush> = {}): CutBrush => ({ ...DEFAULT_CUT_BRUSH, ...over });

describe('what a click makes (src/editor/cut_tool_core.ts)', () => {
  it('a default brush drops the v1 sphere, with no extra fields', () => {
    expect(makeCut(brush(), 5, 12, -8, 7)).toEqual({ x: 5, y: 12, z: -8, radius: 7 });
  });

  it('anchors at the surface height it was given', () => {
    // Re-sculpting nearby ground must never smear the opening, which is why
    // the height is captured here rather than sampled later.
    const cut = makeCut(brush(), 0, 41.5, 0, 4);
    expect(cut.y).toBe(41.5);
  });

  it('a box takes its proportions from the brush, sized off the radius', () => {
    const cut = makeCut(
      brush({ shape: 'box', lengthMult: 3, heightMult: 0.5, rotY: 1.2 }),
      0,
      0,
      0,
      4,
    );
    expect(cut.shape).toBe('box');
    expect(cut.halfX).toBe(12);
    expect(cut.halfY).toBe(2);
    expect(cut.halfZ).toBe(4);
    expect(cut.rotY).toBe(1.2);
  });

  it('a capsule is a bar whose length and squash follow the same two dials', () => {
    const cut = makeCut(brush({ shape: 'capsule', lengthMult: 2.5, heightMult: 0.6 }), 0, 0, 0, 4);
    expect(cut.shape).toBe('capsule');
    expect(cut.len).toBe(10);
    expect(cut.vert).toBe(0.6);
    // The solid really is wider than it is tall.
    expect(cutSdfAt(cut, 0, 3, 0)).toBeGreaterThan(0);
    expect(cutSdfAt(cut, 9, 0, 0)).toBeLessThan(0);
  });

  it('clamps to the same bounds the document sanitizer uses', () => {
    const huge = makeCut(brush({ shape: 'box', lengthMult: 6 }), 0, 0, 0, 999);
    expect(huge.radius).toBe(HOLE_MAX_RADIUS);
    expect(huge.halfX).toBe(CUT_MAX_HALF);
    // Round-tripping through the document changes nothing, which is the point:
    // the tool cannot author a value the next load would clamp away.
    expect(sanitizeTerrainCut(huge)).toEqual(huge);
    expect(normalizeAuthoredCut(huge)).toEqual(huge);
    const tiny = makeCut(brush(), 0, 0, 0, 0.01);
    expect(tiny.radius).toBe(1);
  });

  it('blend only appears when the maker asked for one', () => {
    expect(makeCut(brush(), 0, 0, 0, 4).blend).toBeUndefined();
    expect(makeCut(brush({ blend: 3 }), 0, 0, 0, 4).blend).toBe(3);
    expect(makeCut(brush({ blend: 99 }), 0, 0, 0, 4).blend).toBe(CUT_BRUSH_LIMITS.blend.max);
  });
});

describe('what a panel edit turns it into', () => {
  it('a resize keeps the proportions the maker tuned', () => {
    const cut = makeCut(brush({ shape: 'box', lengthMult: 3, heightMult: 0.5 }), 0, 0, 0, 4);
    const bigger = applyCutChange(cut, { radius: 8 });
    expect(bigger.radius).toBe(8);
    expect(bigger.halfX).toBe(24); // still 3x
    expect(bigger.halfY).toBe(4); // still 0.5x
    expect(bigger.halfZ).toBe(8);
  });

  it('a shape swap carries the proportions across', () => {
    const box = makeCut(brush({ shape: 'box', lengthMult: 2.5, heightMult: 0.5 }), 0, 0, 0, 4);
    const capsule = applyCutChange(box, { shape: 'capsule' });
    expect(capsule.shape).toBe('capsule');
    expect(capsule.len).toBe(10); // 2.5 x 4
    expect(capsule.vert).toBe(0.5);
    // ...and back again.
    const back = applyCutChange(capsule, { shape: 'box' });
    expect(back.halfX).toBe(10);
    expect(back.halfY).toBe(2);
  });

  it('never mutates the record it was handed (the caller owns undo)', () => {
    const cut = makeCut(brush({ shape: 'box' }), 1, 2, 3, 4);
    const before = JSON.parse(JSON.stringify(cut));
    const next = applyCutChange(cut, { radius: 9, blend: 2 });
    expect(cut).toEqual(before);
    expect(next).not.toBe(cut);
    expect(next.x).toBe(1);
    expect(next.y).toBe(2);
    expect(next.z).toBe(3);
  });

  it('leaves a cave-derived tube cut alone', () => {
    const tube: TerrainCut = {
      shape: 'tube',
      x: 0,
      y: 0,
      z: 0,
      radius: 4,
      bore: true,
      nodes: [
        { x: 0, y: 0, z: 0, radius: 4, vy: 6 },
        { x: 20, y: 4, z: 0, radius: 4, vy: 6 },
      ],
    };
    expect(applyCutChange(tube, { radius: 20, shape: 'box' })).toBe(tube);
    expect(cutSummary(tube, 3).shape).toBe('tube');
  });

  it('clamps every slider to its own limits', () => {
    const cut = makeCut(brush({ shape: 'capsule' }), 0, 0, 0, 4);
    expect(applyCutChange(cut, { lengthMult: 999 }).len).toBe(CUT_BRUSH_LIMITS.lengthMult.max * 4);
    expect(applyCutChange(cut, { heightMult: -5 }).vert).toBe(CUT_BRUSH_LIMITS.heightMult.min);
    expect(applyCutChange(cut, { blend: 999 }).blend).toBe(CUT_BRUSH_LIMITS.blend.max);
  });
});

describe('what the panel shows', () => {
  it('reads proportions back as the multiples the sliders present', () => {
    const cut = makeCut(
      brush({ shape: 'box', lengthMult: 3, heightMult: 0.5, blend: 2 }),
      0,
      0,
      0,
      4,
    );
    const s = cutSummary(cut, 2);
    expect(s).toMatchObject({
      index: 2,
      shape: 'box',
      radius: 4,
      lengthMult: 3,
      heightMult: 0.5,
      blend: 2,
    });
  });

  it('a v1 sphere reads back with the brush defaults, not zeroes', () => {
    const s = cutSummary({ x: 0, y: 0, z: 0, radius: 5 }, 0);
    expect(s.shape).toBe('sphere');
    expect(s.lengthMult).toBe(DEFAULT_CUT_BRUSH.lengthMult);
    expect(s.heightMult).toBe(DEFAULT_CUT_BRUSH.heightMult);
    expect(s.blend).toBe(0);
  });
});

describe('sameCut (what a commit uses to decide there was an edit)', () => {
  it('is true for a record and its own re-derivation', () => {
    const cut = makeCut(brush({ shape: 'box' }), 1, 2, 3, 4);
    expect(sameCut(cut, cut)).toBe(true);
    // A slider dragged away and back must NOT push an undo step.
    expect(sameCut(cut, applyCutChange(cut, { radius: 4 }))).toBe(true);
  });

  it('is false as soon as any field moves', () => {
    const cut = makeCut(brush({ shape: 'box' }), 1, 2, 3, 4);
    expect(sameCut(cut, applyCutChange(cut, { radius: 5 }))).toBe(false);
    expect(sameCut(cut, applyCutChange(cut, { blend: 2 }))).toBe(false);
    expect(sameCut(cut, applyCutChange(cut, { shape: 'capsule' }))).toBe(false);
  });

  it('compares a tube cut by its chain', () => {
    const nodes = [{ x: 0, y: 0, z: 0, radius: 4, vy: 6 }];
    const a: TerrainCut = { shape: 'tube', x: 0, y: 0, z: 0, radius: 4, nodes };
    expect(sameCut(a, { ...a, nodes: [{ ...nodes[0] }] })).toBe(true);
    expect(sameCut(a, { ...a, nodes: [{ ...nodes[0], radius: 5 }] })).toBe(false);
    expect(sameCut(a, { ...a, nodes: [] })).toBe(false);
  });
});
