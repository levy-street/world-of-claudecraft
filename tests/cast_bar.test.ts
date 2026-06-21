import { describe, expect, it } from 'vitest';
import { castBarState } from '../src/render/cast_bar';
import { Entity } from '../src/sim/types';

// castBarState reads only a handful of cast fields, so a minimal partial entity
// cast to Entity is enough to exercise every branch without a WebGL context.
function caster(over: Partial<Entity>): Entity {
  return {
    kind: 'mob', dead: false,
    castingAbility: 'fireball', castRemaining: 2.5, castTotal: 2.5, channeling: false,
    ...over,
  } as Entity;
}

describe('overhead cast bar', () => {
  it('is hidden when nothing is being cast', () => {
    expect(castBarState(caster({ castingAbility: null })).visible).toBe(false);
  });

  it('hides for corpses, objects, and a zero-length cast (no divide-by-zero)', () => {
    expect(castBarState(caster({ dead: true })).visible).toBe(false);
    expect(castBarState(caster({ kind: 'object' })).visible).toBe(false);
    expect(castBarState(caster({ castTotal: 0 })).visible).toBe(false);
  });

  it('fills a hardcast upward toward completion', () => {
    // 2.5s left of a 2.5s cast → just started → ~empty
    expect(castBarState(caster({ castRemaining: 2.5, castTotal: 2.5 })).fill).toBeCloseTo(0);
    // 0.5s left → 80% done
    const mid = castBarState(caster({ castRemaining: 0.5, castTotal: 2.5 }));
    expect(mid.fill).toBeCloseTo(0.8);
    expect(mid.channel).toBe(false);
    // castBarState is DOM/i18n-free: it carries the raw ability id; the renderer
    // localizes it. So we assert the stable discriminator, not display text.
    expect(mid.label).toBe('fireball');
    expect(mid.fishing).toBe(false);
  });

  it('drains a channel downward as it ticks', () => {
    const ch = castBarState(caster({
      castingAbility: 'arcane_missiles', channeling: true, castRemaining: 1.5, castTotal: 3,
    }));
    expect(ch.channel).toBe(true);
    expect(ch.fill).toBeCloseTo(0.5); // half the channel left → half-full, draining
    expect(ch.label).toBe('arcane_missiles');
    expect(ch.fishing).toBe(false);
  });

  it('flags fishing and carries the raw id for known and unknown abilities', () => {
    const fish = castBarState(caster({ castingAbility: 'fishing' }));
    expect(fish.fishing).toBe(true);
    expect(fish.label).toBe('fishing');
    const unknown = castBarState(caster({ castingAbility: 'made_up_spell' }));
    expect(unknown.fishing).toBe(false);
    expect(unknown.label).toBe('made_up_spell');
  });

  it('carries custom raid mechanic cast ids for renderer localization', () => {
    const rage = castBarState(caster({
      castingAbility: 'nythraxis_deathless_rage',
      castRemaining: 5,
      castTotal: 10,
    }));
    expect(rage.visible).toBe(true);
    expect(rage.channel).toBe(false);
    expect(rage.fill).toBeCloseTo(0.5);
    expect(rage.label).toBe('nythraxis_deathless_rage');

    const ward = castBarState(caster({
      castingAbility: 'nythraxis_ward_channel',
      channeling: true,
      castRemaining: 3,
      castTotal: 5,
    }));
    expect(ward.channel).toBe(true);
    expect(ward.fill).toBeCloseTo(0.6);
    expect(ward.label).toBe('nythraxis_ward_channel');
  });

  it('clamps the fill fraction to 0..1 against transient overshoot', () => {
    expect(castBarState(caster({ castRemaining: 9, castTotal: 2.5 })).fill).toBe(0);
    expect(castBarState(caster({ castRemaining: -1, castTotal: 2.5 })).fill).toBe(1);
  });
});
