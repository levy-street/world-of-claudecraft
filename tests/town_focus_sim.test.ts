import { describe, expect, it } from 'vitest';
import { MOBS, ZONES } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { POINTS_PER_TIER_BONUS } from '../src/sim/professions/focus';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// #1143: persistent, town-set focus allocation, applied on top of the #1142
// per-corpse harvest roll. Two properties matter end-to-end:
//   1. setTownFocus is gated on the player standing in their zone's town hub.
//   2. A focused component's harvest yield is measurably higher than the same
//      component unfocused, while an unfocused component is entirely
//      unaffected by however much focus is spent elsewhere.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

const ZONE1 = ZONES[0];

function setup() {
  const sim = new Sim({ seed: 21, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  sim.tick();
  const e = internals.entities.get(a)!;
  // The zone1 town hub (Eastbrook), per ZONE1.hub.
  e.pos = { x: ZONE1.hub.x, y: 0, z: ZONE1.hub.z };
  e.prevPos = { ...e.pos };
  return { sim, internals, a };
}

function spawnHideWolf(internals: SimInternals, id: number, pos: { x: number; z: number }) {
  const template = MOBS.forest_wolf;
  const mob = createMob(id, template, template.maxLevel, { x: pos.x, y: 0, z: pos.z });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  return mob;
}

describe('setTownFocus: gated on standing in the town hub', () => {
  it('is accepted while in town', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: POINTS_PER_TIER_BONUS });
  });

  it('is rejected far outside the town hub, leaving the prior allocation unchanged', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, a);
    const e = internals.entities.get(a)!;
    e.pos = { x: ZONE1.hub.x + ZONE1.hub.radius * 20, y: 0, z: ZONE1.hub.z };
    sim.setTownFocus({ fang: POINTS_PER_TIER_BONUS }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: POINTS_PER_TIER_BONUS });
  });

  it('rejects an over-budget allocation', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: 999 }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({});
  });
});

describe('harvestCorpse + town focus: additive bonus, baseline never lowered', () => {
  it('a focused component yields at-least-as-much as unfocused across many corpses, with a measurable edge', () => {
    const trials = 300;

    function harvestTotal(focused: boolean) {
      const { sim, internals, a } = setup();
      if (focused) sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, a);
      let total = 0;
      for (let i = 0; i < trials; i++) {
        const mob = spawnHideWolf(internals, 10000 + i, ZONE1.hub);
        // Explicit [] = spread on both arms: this test isolates the focus
        // yield bonus (an omitted pick would ALSO narrow the selection to
        // the focused tags via the Phase 12d town-focus default).
        sim.harvestCorpse(mob.id, [], a);
        total = sim.countItem('rough_hide', a);
      }
      return total;
    }

    const unfocusedTotal = harvestTotal(false);
    const focusedTotal = harvestTotal(true);
    expect(focusedTotal).toBeGreaterThan(unfocusedTotal);
  });

  it('below the 5-point tier-shift threshold, the per-point yield bonus still raises the total', () => {
    // Below POINTS_PER_TIER_BONUS (5) applyFocusTierBonus is a no-op, so this
    // is decisive for applyFocusBonus actually being wired into the granted
    // quantity (regression for it being computed but never applied to the
    // harvest path).
    const trials = 300;
    const belowTierThreshold = POINTS_PER_TIER_BONUS - 1;

    function harvestTotal(points: number) {
      const { sim, internals, a } = setup();
      if (points > 0) sim.setTownFocus({ hide: points }, a);
      let total = 0;
      for (let i = 0; i < trials; i++) {
        const mob = spawnHideWolf(internals, 30000 + i, ZONE1.hub);
        // Explicit [] = spread, keeping the pick identical on both arms so
        // only applyFocusBonus can produce the edge (see the test above).
        sim.harvestCorpse(mob.id, [], a);
        total = sim.countItem('rough_hide', a);
      }
      return total;
    }

    const unfocusedTotal = harvestTotal(0);
    const focusedTotal = harvestTotal(belowTierThreshold);
    expect(focusedTotal).toBeGreaterThan(unfocusedTotal);
  });

  it("an unfocused component's yield is unaffected by heavy focus spent on another component", () => {
    const { sim, internals, a } = setup();
    // spend the whole budget on 'fang'; 'hide' stays unfocused throughout.
    // Explicit [] = spread on both arms: an omitted pick would narrow the
    // focused run to fang alone (the Phase 12d town-focus default) and
    // never harvest hide at all.
    sim.setTownFocus({ fang: 10 }, a);
    const mob = spawnHideWolf(internals, 20000, ZONE1.hub);
    sim.harvestCorpse(mob.id, [], a);
    const withOtherFocused = sim.countItem('rough_hide', a);

    const { sim: sim2, internals: internals2, a: a2 } = setup();
    const mob2 = spawnHideWolf(internals2, 20001, ZONE1.hub);
    sim2.harvestCorpse(mob2.id, [], a2);
    const baseline = sim2.countItem('rough_hide', a2);

    // Both draw the same rng stream from a freshly-seeded Sim (seed 21), so the
    // unfocused 'hide' component's tier roll is identical either way.
    expect(withOtherFocused).toBe(baseline);
  });
});

// Phase 12d: an OMITTED components argument derives the pick from the caller's
// persistent town focus (the corpse tags holding points); an EXPLICIT array,
// empty or not, keeps its #1142 meaning untouched. Each equivalence below runs
// the counterpart pick on a fresh same-seed world so the rng stream and the
// focus bonuses are identical; only the selection semantics differ.
describe('harvestCorpse omitted-components town-focus default (Phase 12d)', () => {
  function harvestWith(
    focus: Record<string, number> | null,
    components: string[] | undefined,
  ): { hide: number; fang: number } {
    const { sim, internals, a } = setup();
    if (focus) sim.setTownFocus(focus, a);
    const mob = spawnHideWolf(internals, 40000, ZONE1.hub);
    sim.harvestCorpse(mob.id, components, a);
    return { hide: sim.countItem('rough_hide', a), fang: sim.countItem('wolf_fang', a) };
  }

  it('omitted with hide focused narrows to hide, exactly like an explicit [hide] pick', () => {
    const omitted = harvestWith({ hide: POINTS_PER_TIER_BONUS }, undefined);
    const explicit = harvestWith({ hide: POINTS_PER_TIER_BONUS }, ['hide']);
    expect(omitted).toEqual(explicit);
    expect(omitted.hide).toBeGreaterThanOrEqual(1);
    expect(omitted.fang).toBe(0); // the unfocused tag was not harvested
  });

  it('omitted with zero focus spreads, exactly like an explicit empty pick', () => {
    const omitted = harvestWith(null, undefined);
    const explicit = harvestWith(null, []);
    expect(omitted).toEqual(explicit);
    // Spread proof: both of the wolf's tags yielded.
    expect(omitted.hide).toBeGreaterThanOrEqual(1);
    expect(omitted.fang).toBeGreaterThanOrEqual(1);
  });

  it('an explicit empty pick still spreads even with focus set (explicit beats derived)', () => {
    const explicitEmpty = harvestWith({ hide: POINTS_PER_TIER_BONUS }, []);
    expect(explicitEmpty.hide).toBeGreaterThanOrEqual(1);
    expect(explicitEmpty.fang).toBeGreaterThanOrEqual(1);
  });

  it('an explicit pick is respected over the focused allocation', () => {
    const explicitFang = harvestWith({ hide: POINTS_PER_TIER_BONUS }, ['fang']);
    expect(explicitFang.fang).toBeGreaterThanOrEqual(1);
    expect(explicitFang.hide).toBe(0);
  });
});
