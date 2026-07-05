import { describe, expect, it } from 'vitest';
import { castBarState, consumeBarState } from '../src/render/cast_bar';
import { CONSUME_DURATION, type Consuming, type Entity } from '../src/sim/types';

// castBarState reads only a handful of cast fields, so a minimal partial entity
// cast to Entity is enough to exercise every branch without a WebGL context.
function caster(over: Partial<Entity>): Entity {
  return {
    kind: 'mob',
    dead: false,
    castingAbility: 'fireball',
    castRemaining: 2.5,
    castTotal: 2.5,
    channeling: false,
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
    const ch = castBarState(
      caster({
        castingAbility: 'arcane_missiles',
        channeling: true,
        castRemaining: 1.5,
        castTotal: 3,
      }),
    );
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
    const rage = castBarState(
      caster({
        castingAbility: 'nythraxis_deathless_rage',
        castRemaining: 5,
        castTotal: 10,
      }),
    );
    expect(rage.visible).toBe(true);
    expect(rage.channel).toBe(false);
    expect(rage.fill).toBeCloseTo(0.5);
    expect(rage.label).toBe('nythraxis_deathless_rage');

    const ward = castBarState(
      caster({
        castingAbility: 'nythraxis_ward_channel',
        channeling: true,
        castRemaining: 3,
        castTotal: 5,
      }),
    );
    expect(ward.channel).toBe(true);
    expect(ward.fill).toBeCloseTo(0.6);
    expect(ward.label).toBe('nythraxis_ward_channel');
  });

  it('clamps the fill fraction to 0..1 against transient overshoot', () => {
    expect(castBarState(caster({ castRemaining: 9, castTotal: 2.5 })).fill).toBe(0);
    expect(castBarState(caster({ castRemaining: -1, castTotal: 2.5 })).fill).toBe(1);
  });
});

// consumeBarState is the PLAYER-ONLY eat/drink overlay: a generic-Entity cast is
// the target's whole story, so eat/drink rides here, not on castBarState. The core
// stays i18n-free, emitting only the `mode` discriminator the painter localizes.
function food(remaining: number): Consuming {
  return { itemId: 'roasted_boar', kind: 'food', hpPer2s: 40, manaPer2s: 0, remaining };
}
function drink(remaining: number): Consuming {
  return { itemId: 'spring_water', kind: 'drink', hpPer2s: 0, manaPer2s: 30, remaining };
}

describe('overhead eat/drink overlay', () => {
  it('is hidden when neither eating nor drinking', () => {
    const s = consumeBarState(null, null);
    expect(s.visible).toBe(false);
    expect(s.fill).toBe(0);
  });

  it('reports the eat mode and drains the fill from full toward 0', () => {
    // a full CONSUME_DURATION left -> the bar just started -> full
    const fresh = consumeBarState(food(CONSUME_DURATION), null);
    expect(fresh.visible).toBe(true);
    expect(fresh.mode).toBe('eat');
    expect(fresh.fill).toBeCloseTo(1);
    expect(fresh.remaining).toBe(CONSUME_DURATION);
    // half the duration left -> half-full, draining (channel-style)
    const mid = consumeBarState(food(CONSUME_DURATION / 2), null);
    expect(mid.fill).toBeCloseTo(0.5);
    expect(mid.remaining).toBeCloseTo(CONSUME_DURATION / 2);
  });

  it('reports the drink mode when only drinking', () => {
    const s = consumeBarState(null, drink(6));
    expect(s.mode).toBe('drink');
    expect(s.fill).toBeCloseTo(6 / CONSUME_DURATION);
    expect(s.remaining).toBe(6);
  });

  it('reports eatdrink and the longer-remaining consumable drives the bar', () => {
    // drink has more time left -> it drives both the fill and the timer
    const drinkLonger = consumeBarState(food(4), drink(10));
    expect(drinkLonger.mode).toBe('eatdrink');
    expect(drinkLonger.fill).toBeCloseTo(10 / CONSUME_DURATION);
    expect(drinkLonger.remaining).toBe(10);
    // food has more time left -> it drives (>= ties to food, matching the inline block)
    const foodLonger = consumeBarState(food(12), drink(3));
    expect(foodLonger.mode).toBe('eatdrink');
    expect(foodLonger.fill).toBeCloseTo(12 / CONSUME_DURATION);
    expect(foodLonger.remaining).toBe(12);
    // a tie resolves to the food timer (the >= branch)
    expect(consumeBarState(food(7), drink(7)).remaining).toBe(7);
  });

  it('clamps the fill to 0..1 against a transient overshoot', () => {
    expect(consumeBarState(food(CONSUME_DURATION + 5), null).fill).toBe(1);
    expect(consumeBarState(food(-1), null).fill).toBe(0);
  });

  it('is deterministic: same input gives the same output', () => {
    const a = consumeBarState(food(8), drink(3));
    const b = consumeBarState(food(8), drink(3));
    expect(a).toEqual(b);
  });
});

// The cast/eat-drink fields the core reads (castingAbility,
// castRemaining, castTotal, channeling, and the player eating/drinking timers)
// must satisfy BOTH the offline Sim entity shape and the online ClientWorld mirror
// shape, or an offline-only field shape ships broken online. Drive the cores with a
// Sim-shaped stub and a ClientWorld-mirror-shaped stub carrying the same logical
// state and assert the cast result + the eat/drink mode/fill match exactly.
describe('ClientWorld-vs-Sim parity', () => {
  // The offline Sim entity: castBarState reads a handful of its fields directly.
  function simCaster(): Entity {
    return {
      kind: 'player',
      dead: false,
      castingAbility: 'fireball',
      castRemaining: 1,
      castTotal: 2.5,
      channeling: false,
    } as Entity;
  }
  // The online mirror: ClientWorld rebuilds the same entity from a wire snapshot.
  // The fields the core reads are identical, so the result must be identical. We add
  // unrelated mirror-only noise to prove the core depends on nothing source-specific.
  function clientCaster(): Entity {
    return {
      kind: 'player',
      dead: false,
      castingAbility: 'fireball',
      castRemaining: 1,
      castTotal: 2.5,
      channeling: false,
      // mirror-only incidental fields the core must NOT read:
      id: 7,
      name: 'Aerwynn',
    } as Entity;
  }

  it('castBarState matches across the Sim and ClientWorld entity shapes', () => {
    expect(castBarState(simCaster())).toEqual(castBarState(clientCaster()));
  });

  it('consumeBarState matches across the Sim and ClientWorld player shapes', () => {
    // The offline Sim builds full Consuming records (itemId, hp/manaPer2s populated).
    // The online ClientWorld mirror may deliver the SAME remaining timers with the
    // other fields zeroed/blank (it only needs the bar-driving remaining over the
    // wire). Diverging on every non-`remaining` field proves consumeBarState reads
    // ONLY `.remaining` (+ the null/non-null status for the mode), nothing online
    // and offline can disagree on - so an offline-only field shape cannot ship broken.
    const simEat = food(9);
    const simDrink = drink(5);
    const clientEat: Consuming = {
      itemId: '',
      kind: 'food',
      hpPer2s: 0,
      manaPer2s: 0,
      remaining: 9,
    };
    const clientDrink: Consuming = {
      itemId: '',
      kind: 'drink',
      hpPer2s: 0,
      manaPer2s: 0,
      remaining: 5,
    };
    const sim = consumeBarState(simEat, simDrink);
    const client = consumeBarState(clientEat, clientDrink);
    expect(client.mode).toBe(sim.mode);
    expect(client.fill).toBeCloseTo(sim.fill);
    expect(client.remaining).toBe(sim.remaining);
    expect(client).toEqual(sim);
  });
});
