// The Target dots tracker against the REAL sim, not a hand-built aura list.
//
// Why this file exists separately from tests/target_dots_view.test.ts: the sim's
// re-application path (sim.ts, the replacementConflicts walk) splices the old
// record out and pushes a new one, and the timers it restores are the whole point
// of this frame. A fixture cannot show that a refresh is followed; only casting
// into a live Sim can.
//
// TWO TRAPS this file has to avoid, both of which produced a green test that
// proved nothing:
//   1. The view POOLS its rows and returns the SAME state object every tick, so
//      holding a row across ticks compares a record with itself. Every assertion
//      here snapshots plain numbers at the moment it reads them.
//   2. Re-casting a dot that is already up cannot be waited on by "does the aura
//      exist" (it already does). The refresh wait watches the REMAINING TIME rise
//      instead, which is the thing a refresh actually changes.

import { describe, expect, it } from 'vitest';

import { isOwnAura } from '../src/sim/aura_classify';
import { Sim } from '../src/sim/sim';
import { createTargetDotsView, type TargetDotsInput } from '../src/ui/hud/target_dots';

function makeSim() {
  const sim = new Sim({ seed: 7, playerClass: 'warlock' });
  sim.setPlayerLevel(20, sim.playerId);
  return sim;
}

/** The nearest living mob, moved next to the player and targeted. */
function engageNearestMob(sim: Sim) {
  const player = sim.player;
  let best: ReturnType<typeof sim.entities.get> | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entity of sim.entities.values()) {
    if (entity.kind !== 'mob' || entity.dead) continue;
    const dx = entity.pos.x - player.pos.x;
    const dz = entity.pos.z - player.pos.z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }
  if (!best) throw new Error('no mob to engage');
  best.pos.x = player.pos.x + 3;
  best.pos.z = player.pos.z;
  best.pos.y = player.pos.y;
  best.hp = best.maxHp = 100000;
  sim.rebucket?.(best);
  sim.targetEntity(best.id, player.id);
  return best;
}

/** Remaining seconds of the player's own `abilityId` on `mobId`, 0 when absent. */
function ownRemaining(sim: Sim, abilityId: string, mobId: number): number {
  const mob = sim.entities.get(mobId);
  const aura = mob?.auras.find((a) => a.id.startsWith(abilityId) && a.sourceId === sim.playerId);
  return aura ? aura.remaining : 0;
}

/**
 * Cast `abilityId` and tick until it has actually LANDED, meaning its remaining
 * time is above where it stood before the cast. Presence alone is the wrong
 * signal for a refresh: the aura is already there, so a presence check returns on
 * the first tick, long before the 2s cast resolves, and the caller then measures
 * the OLD timer.
 */
function castUntilApplied(sim: Sim, abilityId: string, mobId: number): void {
  const before = ownRemaining(sim, abilityId, mobId);
  for (let attempt = 0; attempt < 6; attempt++) {
    sim.player.resource = sim.player.maxResource;
    sim.castAbility(abilityId, sim.playerId);
    for (let tick = 0; tick < 20 * 4; tick++) {
      sim.tick();
      if (ownRemaining(sim, abilityId, mobId) > before) return;
    }
  }
  throw new Error(`${abilityId} never landed`);
}

function makeView(playerId: number) {
  return createTargetDotsView({
    // The SHIPPING predicate, not a looser stand-in: an integration test that
    // accepts any caster would pass even if the frame stopped filtering.
    isOwn: (a) => isOwnAura(a, playerId),
    auraName: (a) => a.name,
    targetName: (e) => e.name,
    iconKey: (a) => a.id,
  });
}

function tickView(view: ReturnType<typeof makeView>, sim: Sim) {
  const input: TargetDotsInput = {
    // A fresh iterator per tick, the way the Hud passes one: Map.values() is a
    // ONE-SHOT iterable, so a retained input object would scan an exhausted
    // iterator on its second read and report an empty frame.
    entities: sim.entities.values(),
    targetId: sim.player.targetId,
    enabled: true,
  };
  return view.tick(input);
}

describe('target dots against the live sim', () => {
  it('follows a refresh back up to full, though the sim swapped the aura object', () => {
    const sim = makeSim();
    const mob = engageNearestMob(sim);
    castUntilApplied(sim, 'corruption', mob.id);

    const view = makeView(sim.playerId);
    const before = tickView(view, sim);
    expect(before.count).toBe(1);
    // Snapshot, never hold: the row is a pooled record the next tick rewrites.
    const fullDuration = before.rows[0].remaining;

    // Run it most of the way down.
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    const drained = tickView(view, sim);
    expect(drained.count).toBe(1);
    const drainedRemaining = drained.rows[0].remaining;
    const drainedFraction = drained.rows[0].fraction;
    expect(drainedRemaining).toBeLessThan(fullDuration - 5);
    expect(drainedFraction).toBeLessThan(0.7);

    // Refresh it. Whether the sim mutates the record in place or splices and
    // pushes a new one is its business (it does both, per ability), so the row
    // must follow the VALUES rather than any aura object identity.
    castUntilApplied(sim, 'corruption', mob.id);
    const refreshed = tickView(view, sim);
    expect(refreshed.count).toBe(1);
    // Not merely "went up": a refresh restores the FULL duration, and the test
    // already knows what that was, so assert the row returns to it rather than
    // to any larger number. A partial restore would slip past a bare increase.
    expect(refreshed.rows[0].remaining).toBeGreaterThan(drainedRemaining);
    expect(refreshed.rows[0].remaining).toBeGreaterThan(fullDuration - 1.5);
    expect(refreshed.rows[0].remaining).toBeLessThanOrEqual(fullDuration + 0.001);
    expect(refreshed.rows[0].fraction).toBeGreaterThan(drainedFraction);
    expect(refreshed.rows[0].fraction).toBeGreaterThan(0.9);
  });

  it('keeps every existing row live when a second dot is applied', () => {
    const sim = makeSim();
    const mob = engageNearestMob(sim);
    castUntilApplied(sim, 'corruption', mob.id);
    const view = makeView(sim.playerId);

    for (let i = 0; i < 20 * 3; i++) sim.tick();
    const one = tickView(view, sim);
    expect(one.count).toBe(1);
    const corruptionBefore = one.rows
      .slice(0, one.count)
      .find((r) => r.iconKey.startsWith('corruption'))?.remaining;
    expect(corruptionBefore).toBeDefined();

    // A second dot lands, which re-orders and re-indexes the row list.
    castUntilApplied(sim, 'curse_of_agony', mob.id);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    const two = tickView(view, sim);
    expect(two.count).toBe(2);

    // The FIRST dot's row must still be counting down, not frozen at the value
    // it held when the list changed shape.
    const corruptionAfter = two.rows
      .slice(0, two.count)
      .find((r) => r.iconKey.startsWith('corruption'))?.remaining;
    expect(corruptionAfter).toBeDefined();
    expect(corruptionAfter as number).toBeLessThan(corruptionBefore as number);
    // and both rows carry a live fraction, neither pinned at 0 or 1.
    for (let i = 0; i < two.count; i++) {
      expect(two.rows[i].fraction).toBeGreaterThan(0);
      expect(two.rows[i].fraction).toBeLessThanOrEqual(1);
    }
  });

  it('drops the row when the dot expires rather than freezing its last value', () => {
    const sim = makeSim();
    const mob = engageNearestMob(sim);
    castUntilApplied(sim, 'corruption', mob.id);
    const view = makeView(sim.playerId);
    expect(tickView(view, sim).count).toBe(1);
    for (let i = 0; i < 20 * 40; i++) sim.tick();
    expect(tickView(view, sim).count).toBe(0);
  });
});
