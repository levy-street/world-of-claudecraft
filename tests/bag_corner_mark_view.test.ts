// Pure-core pins for the bag grid's corner-mark and rim-class composition
// (bag_corner_mark_view.ts). The three input cores each decide one fact
// (per-copy glyph kind, quest purpose, fine grade); this table is the ONLY
// place their priority is decided, so it is pinned exhaustively here,
// including combinations shipped content cannot produce yet (a quest-kind
// fine id): the hierarchy must hold by construction, not by content accident.
import { describe, expect, it } from 'vitest';
import { bagCornerMark, bagRimClasses } from '../src/ui/bag_corner_mark_view';

describe('bag_corner_mark_view: corner priority', () => {
  it('masterwork outranks quest, fine, and both at once', () => {
    expect(bagCornerMark('masterwork', null, false)).toBe('masterwork');
    expect(bagCornerMark('masterwork', 'quest', false)).toBe('masterwork');
    expect(bagCornerMark('masterwork', null, true)).toBe('masterwork');
    expect(bagCornerMark('masterwork', 'questReady', true)).toBe('masterwork');
  });

  it('quest outranks fine and every non-masterwork glyph', () => {
    expect(bagCornerMark(null, 'quest', false)).toBe('quest');
    expect(bagCornerMark(null, 'quest', true)).toBe('quest');
    expect(bagCornerMark(null, 'questReady', true)).toBe('quest');
    for (const glyph of ['enchanted', 'signed', 'bound', 'generic'] as const) {
      expect(bagCornerMark(glyph, 'quest', true), glyph).toBe('quest');
    }
  });

  it('fine outranks every per-copy glyph and the generic wedge', () => {
    expect(bagCornerMark(null, null, true)).toBe('fine');
    for (const glyph of ['enchanted', 'signed', 'bound', 'generic'] as const) {
      expect(bagCornerMark(glyph, null, true), glyph).toBe('fine');
    }
  });

  it('without quest or fine, the glyph kind passes through unchanged', () => {
    for (const glyph of ['enchanted', 'signed', 'bound', 'generic', null] as const) {
      expect(bagCornerMark(glyph, null, false)).toBe(glyph);
    }
  });
});

describe('bag_corner_mark_view: rim classes', () => {
  it('purpose outranks grade: a quest stack never wears bag-fine', () => {
    // This is the guard that keeps .bag-quest and .bag-fine out of the same
    // cascade fight: the CSS source order of the two rim rules is not
    // load-bearing because the painter never emits both.
    expect(bagRimClasses('quest', true)).toBe(' bag-quest');
    expect(bagRimClasses('questReady', true)).toBe(' bag-quest bag-quest-ready');
    expect(bagRimClasses('quest', true)).not.toContain('bag-fine');
  });

  it('resolves each single input to its own classes', () => {
    expect(bagRimClasses(null, false)).toBe('');
    expect(bagRimClasses(null, true)).toBe(' bag-fine');
    expect(bagRimClasses('quest', false)).toBe(' bag-quest');
    expect(bagRimClasses('questReady', false)).toBe(' bag-quest bag-quest-ready');
    // The reserved orphaned kind keeps the default quest rim.
    expect(bagRimClasses('questOrphaned', false)).toBe(' bag-quest');
  });
});
