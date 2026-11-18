// The Stillstone's shared channel (Jose's design change of 2026-11-18): every
// player on the stone's isle may channel it at once (a click on the crystal),
// and ONE shared bar fills, faster the more of them channel (each one's rate
// times stoneRate(n), n^0.8), one alone slow (the tier's stoneSoloSeconds). A
// hit cuts only that player's channel; the shared progress is kept (it never
// decays). The stone is locked (no click, no channel) while any add of its
// isle stands. It stills once, every channel cut with it.

import { describe, expect, it } from 'vitest';
import { clickStartsUse } from '../src/game/interactions';
import { livingIsleAdds } from '../src/sim/encounters/smith_heart/breath_isle_adds';
import {
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_CUES,
  ISLE_TIERS,
  stoneProgressOf,
  stoneRate,
} from '../src/sim/encounters/smith_heart/breath_isle_ids';
import {
  KIT_USE_LOCKED_AURA,
  KIT_USE_SPENT_AURA,
  kitUsableNow,
} from '../src/sim/mob/trash_kit/encounter_use';
import { DT, type Entity } from '../src/sim/types';
import type { BreathFight } from './helpers/breath_fight';
import { byStone, eastChain, islesFight, killIsle, ticks } from './helpers/breath_isle_run';

const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

/** The east stone awake, `n` players by it. */
function atStone(
  n: number,
  tier: '' | 'heroic' = '',
): { f: BreathFight; stone: Entity; ps: Entity[] } {
  const f = islesFight(6, tier);
  const [, lead] = f.players;
  const stone = eastChain(f, lead);
  if (!stone) throw new Error('no stone');
  if (tier === 'heroic') {
    // Its guard: two Squall Fragments rose with it.
    killIsle(f, 2);
  }
  const ps = f.players.slice(0, n);
  ps.forEach((p, k) => byStone(f, p, k));
  f.tick(2);
  return { f, stone, ps };
}

function channel(f: BreathFight, ps: readonly Entity[], stone: Entity): void {
  for (const p of ps) {
    p.targetId = stone.id;
    f.sim.interact(p.id);
    expect(p.castingAbility, `${p.id}`).toBe(ISLE_CASTS.still);
  }
}

describe('the Stillstone: one shared bar, faster together', () => {
  it('fills at stoneRate(n) of the solo pace: n^0.8, diminishing', () => {
    expect(stoneRate(1)).toBe(1);
    expect(stoneRate(2)).toBeCloseTo(2 ** 0.8, 9);
    expect(stoneRate(5)).toBeCloseTo(5 ** 0.8, 9);
    expect(stoneRate(0)).toBe(0);
    // Normal 15 s alone, Heroic 18 s; five together about 4 to 5 s.
    expect(ISLE_TIERS.normal.stoneSoloSeconds).toBe(15);
    expect(ISLE_TIERS.heroic.stoneSoloSeconds).toBe(18);
    expect(ISLE_TIERS.mythic.stoneSoloSeconds).toBe(18);
    expect(15 / stoneRate(5)).toBeGreaterThan(3.8);
    expect(15 / stoneRate(5)).toBeLessThan(4.5);
    expect(18 / stoneRate(5)).toBeLessThan(5.2);
  });

  for (const n of [1, 2, 5]) {
    it(`${n} channeling: the shared progress after 2 s is ${n}^0.8 of the solo pace`, () => {
      const { f, stone, ps } = atStone(n);
      channel(f, ps, stone);
      f.tick(ticks(2));
      const want = (2 * stoneRate(n)) / ISLE_TIERS.normal.stoneSoloSeconds;
      expect(stoneProgressOf(stone)).toBeCloseTo(want, 1);
      // Every channeler's own bar shows the shared share, its seconds the time
      // left at this pace.
      for (const p of ps) {
        expect(p.castingAbility).toBe(ISLE_CASTS.still);
        expect(1 - p.castRemaining / p.castTotal).toBeCloseTo(stoneProgressOf(stone), 2);
      }
    });
  }

  it('one alone takes about the solo time; it stills once, every channel cut with it', () => {
    const { f, stone, ps } = atStone(1);
    channel(f, ps, stone);
    const cues: number[] = [];
    let at = -1;
    for (let t = 0; t < ticks(20); t++) {
      const ev = f.tick(1);
      for (const e of ev)
        if (e.type === 'spellfx' && 'ability' in e && e.ability === ISLE_CUES.stilled) cues.push(t);
      if (at < 0 && f.state()?.isles.isles[2].stilled) at = t * DT;
    }
    expect(at).toBeGreaterThan(14.5);
    expect(at).toBeLessThan(15.6);
    expect(cues).toHaveLength(1);
    expect(has(stone, KIT_USE_SPENT_AURA)).toBe(true);
    expect(ps[0].castingAbility).toBeNull();
  });

  it('five together finish in about 4 s and every one of them stops channeling', () => {
    const { f, stone, ps } = atStone(5);
    channel(f, ps, stone);
    f.tick(ticks(15 / stoneRate(5) + 0.4));
    expect(f.state()?.isles.isles[2].stilled).toBe(true);
    for (const p of ps) expect(p.castingAbility).toBeNull();
  });

  it('a hit cuts that one channel; the shared progress is kept, and a fresh click goes on', () => {
    const { f, stone, ps } = atStone(2);
    channel(f, ps, stone);
    f.tick(ticks(3));
    const before = stoneProgressOf(stone);
    expect(before).toBeGreaterThan(0.25);
    f.sim.ctx.dealDamage(f.boss(), ps[0], 1, false, 'nature', 'Test', 'hit', true);
    f.tick(1);
    expect(ps[0].castingAbility).toBeNull();
    expect(ps[1].castingAbility).toBe(ISLE_CASTS.still);
    // Both stop: the progress holds (no decay).
    f.sim.ctx.dealDamage(f.boss(), ps[1], 1, false, 'nature', 'Test', 'hit', true);
    f.tick(1);
    const held = stoneProgressOf(stone);
    f.tick(ticks(5));
    expect(stoneProgressOf(stone)).toBeCloseTo(held, 6);
    expect(held).toBeGreaterThanOrEqual(before);
    channel(f, [ps[0]], stone);
    f.tick(ticks(1));
    expect(stoneProgressOf(stone)).toBeGreaterThan(held);
  });

  it('the shared progress rides the stone (an aura every client mirrors)', () => {
    const { f, stone, ps } = atStone(3);
    channel(f, ps, stone);
    f.tick(ticks(1));
    const a = stone.auras.find((x) => x.id === ISLE_AURAS.stoneCharge);
    expect(a?.value).toBeCloseTo(stoneProgressOf(stone), 6);
    expect(a?.value2).toBe(3);
  });
});

describe('the Stillstone is locked while its isle has adds', () => {
  it('Heroic: its Fragments guard it; no click or press channels it until they fall', () => {
    const f = islesFight(6, 'heroic');
    const [, lead, other] = f.players;
    const stone = eastChain(f, lead);
    if (!stone) throw new Error('no stone');
    expect(livingIsleAdds({ ctx: f.sim.ctx, st: f.state()! }, 2).length).toBeGreaterThan(0);
    byStone(f, other, 0);
    f.tick(2);
    expect(has(stone, KIT_USE_LOCKED_AURA)).toBe(true);
    expect(kitUsableNow(stone)).toBe(false);
    expect(clickStartsUse(stone, other)).toBe(false);
    other.targetId = stone.id;
    f.sim.interact(other.id);
    f.tick(1);
    expect(other.castingAbility).toBeNull();
    killIsle(f, 2);
    expect(has(stone, KIT_USE_LOCKED_AURA)).toBe(false);
    expect(kitUsableNow(stone)).toBe(true);
    other.targetId = stone.id;
    f.sim.interact(other.id);
    expect(other.castingAbility).toBe(ISLE_CASTS.still);
  });

  it('Normal: the stone only rises once its isle is clear', () => {
    const f = islesFight(6);
    const [, lead] = f.players;
    expect(eastChain(f, lead, false)).toBeNull();
    killIsle(f, 2);
    expect(f.state()?.isles.isles[2].stoneId).not.toBeNull();
  });
});
