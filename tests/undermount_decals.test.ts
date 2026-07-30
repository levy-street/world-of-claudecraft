import { describe, expect, it } from 'vitest';
import {
  isVolzharrEruptionWindup,
  UNDERMOUNT_DECAL,
  type UndermountDecalKind,
  type UndermountFxLevel,
  undermountDecalColor,
  undermountEntityDecalMask,
} from '../src/render/undermount_decals_core';

describe('Undermount actionable decal contract', () => {
  it('keeps one fixed hue per meaning at every fx tier and under reduced motion', () => {
    const kinds: UndermountDecalKind[] = [
      'ventRing',
      'ventCore',
      'forgeheat',
      'scorched',
      'chilled',
      'eruption',
    ];
    const tiers: UndermountFxLevel[] = ['low', 'medium', 'high', 'ultra'];
    for (const kind of kinds) {
      const expected = undermountDecalColor(kind);
      for (const fxLevel of tiers) {
        expect(undermountDecalColor(kind, { fxLevel, reducedMotion: false })).toBe(expected);
        expect(undermountDecalColor(kind, { fxLevel, reducedMotion: true })).toBe(expected);
      }
    }
    expect(undermountDecalColor('scorched')).not.toBe(undermountDecalColor('chilled'));
  });

  it('derives mark and Forgeheat glyphs only from mirrored aura ids', () => {
    expect(
      undermountEntityDecalMask([{ id: 'odrenn_scorched' }, { id: 'volzharr_forgeheat' }]),
    ).toBe(UNDERMOUNT_DECAL.scorched | UNDERMOUNT_DECAL.forgeheat);
    expect(undermountEntityDecalMask([{ id: 'odrenn_chilled' }])).toBe(UNDERMOUNT_DECAL.chilled);
    expect(undermountEntityDecalMask([{ id: 'unrelated' }])).toBe(0);
  });

  it('keys the Eruption flash only to Volzharr windup events', () => {
    const windup = { type: 'spellfx', fx: 'windup' };
    expect(isVolzharrEruptionWindup(windup, 'volzharr_buried_furnace')).toBe(true);
    expect(isVolzharrEruptionWindup(windup, 'other_caster')).toBe(false);
    expect(
      isVolzharrEruptionWindup({ type: 'spellfx', fx: 'projectile' }, 'volzharr_buried_furnace'),
    ).toBe(false);
  });
});
