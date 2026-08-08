// Regression suite for the Drakemaw brood belt filling up with hatchlings that
// never leave (bug report: hundreds of Dragonkin Whelp nameplates stacked over
// the Drakelands).
//
// A hatched whelp is flagged `summonedAdd`, and mob/locomotion.ts only acts on
// that flag in the DEAD branch: a slain whelp unravels once its corpse decays.
// A whelp nobody kills had no cleanup path at all. It was not in
// DAMAGE_IDLE_DESPAWN_MOB_IDS, hatchEgg set it no despawnTimer, and hatchEgg
// never pushed it onto the egg's `summonedIds`, so respawnMob's
// despawnSummonedAdds(egg) could not reach it either, despite hatchEgg's comment
// claiming the egg's own respawn brings "the next generation".
//
// Meanwhile the egg re-clutches on the ordinary trash cadence and hatches a
// fresh whelp for the next passer-by. Measured before the fix, one walker
// crossing every clutch and killing nothing: 92 live whelps after one lap, 184
// after two, 267 after three, out of 75 authored eggs, none with a despawn
// timer. Every player to ever cross the belt added another permanent layer.
//
// The fix puts the whelp on the existing idle-despawn seam, so one that nobody
// is fighting unravels on its own while an engaged one is untouched.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { DAMAGE_IDLE_DESPAWN_MOB_IDS, DAMAGE_IDLE_DESPAWN_SECONDS } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

type AnySim = Sim & Record<string, unknown>;

const WHELP = 'dragonkin_whelp';
const EGG = 'dragonkin_egg';

// The suite only ever walks the Drakelands brood belt (the dragonkin_egg
// clutches) and asserts on whelp/egg counts; it never touches an npc or a
// ground object, so the rest of the built-in world is dead weight during Sim
// construction. Every dragonkin_egg camp is authored offStream
// (src/sim/content/drakelands.ts), and Sim.campPrivateRng seeds an offStream
// camp's scatter from the world seed plus the camp's own mobId/center/radius/
// count (never its position in the camps array, per the comment on
// campPrivateRng), so dropping every other camp draws no shared rng and moves
// no egg's spawn position, level, or facing. Every assertion below is
// structural (greaterThan/toBe(0)/toEqual([0,0,0])), never a value pinned to
// a specific seed's outcome, so this is safe unlike the corpse_harvest_sim
// empty-world attempt (docs/local-gate-perf/baselines.md, Phase 9).
const BROOD_BELT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === EGG),
  npcs: {},
  groundObjects: [],
};

function beltWorld(): { sim: AnySim; player: Entity } {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    world: BROOD_BELT_TEST_WORLD,
  }) as AnySim;
  const player = sim.player;
  sim.setPlayerLevel(60); // the walker must survive the clutch, not fight it
  return { sim, player };
}

function liveCount(sim: AnySim, templateId: string): number {
  return [...sim.entities.values()].filter(
    (e) => e.templateId === templateId && !e.dead && e.aiState !== 'dead',
  ).length;
}

/** Stand somewhere, holding the walker upright: a DEAD player springs no
 *  proximity ambush, so a probe whose player quietly died would report a belt
 *  that bounds itself. */
function stand(sim: AnySim, player: Entity, x: number, z: number, seconds: number): void {
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = sim.groundPos(x, z).y;
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  for (let i = 0; i < 20 * seconds; i++) {
    player.hp = player.maxHp;
    player.dead = false;
    sim.tick();
  }
}

/** Walk authored clutches, cracking eggs by proximity and killing nothing. A
 *  slice of the belt rather than all of it: the accumulation is per crack, so a
 *  couple of clutches shows it just as decisively and keeps the suite quick. */
function walkTheBelt(sim: AnySim, player: Entity, spotLimit = 16): void {
  const spots = [...sim.entities.values()]
    .filter((e) => MOBS[e.templateId]?.broodEgg)
    .map((e) => ({ x: e.spawnPos.x, z: e.spawnPos.z }));
  expect(spots.length, 'the brood belt has authored egg clutches').toBeGreaterThan(20);
  for (const s of spots.slice(0, spotLimit)) stand(sim, player, s.x, s.z, 1);
}

describe('dragonkin whelps do not litter the brood belt', () => {
  it('registers the whelp on the idle-despawn seam', () => {
    // The pin that makes the behavior below reachable at all: without this the
    // despawn scan in runDespawnDecay never looks at a whelp.
    expect(DAMAGE_IDLE_DESPAWN_MOB_IDS.has(WHELP)).toBe(true);
    expect(MOBS[WHELP]).toBeTruthy();
  });

  it('unravels the hatchlings a walker leaves behind', { timeout: 120_000 }, () => {
    const { sim, player } = beltWorld();
    expect(liveCount(sim, WHELP), 'no whelps before any egg cracks').toBe(0);
    walkTheBelt(sim, player);
    const hatched = liveCount(sim, WHELP);
    expect(hatched, 'walking the clutches hatches whelps').toBeGreaterThan(5);

    // The walker moves on (back at the Last Keep, well clear of the belt) and
    // the loose hatchlings are left alone past the idle window.
    stand(sim, player, 355, 2013, DAMAGE_IDLE_DESPAWN_SECONDS + 20);
    expect(liveCount(sim, WHELP), `left-behind hatchlings unravel (had ${hatched})`).toBe(0);
    // Gone from the roster, not just flagged dead: an unravelled add is dropped.
    expect([...sim.entities.values()].filter((e) => e.templateId === WHELP).length).toBe(0);
  });

  it('does not grow the belt lap after lap', { timeout: 180_000 }, () => {
    const { sim, player } = beltWorld();
    const laps: number[] = [];
    for (let lap = 0; lap < 3; lap++) {
      walkTheBelt(sim, player);
      // Re-clutch every cracked egg, the camp cadence elapsing between laps.
      for (const e of [...sim.entities.values()]) {
        if (!MOBS[e.templateId]?.broodEgg) continue;
        if (!e.dead && e.aiState !== 'dead') continue;
        e.respawnTimer = 0;
        e.corpseTimer = 0;
      }
      stand(sim, player, 355, 2013, DAMAGE_IDLE_DESPAWN_SECONDS + 20);
      laps.push(liveCount(sim, WHELP));
    }
    // Before the fix this read 21, 42, then 63: one permanent layer per lap, and
    // over the WHOLE belt rather than this slice, 92, 184, then 267.
    expect(laps, 'each lap settles back to an empty belt').toEqual([0, 0, 0]);
    // And the clutches themselves are back, so the belt is still a hazard.
    expect(liveCount(sim, EGG)).toBeGreaterThan(20);
  });

  it('keeps a whelp that is actually being fought', { timeout: 120_000 }, () => {
    // The despawn must never yank a mob out of a live fight: the idle timer only
    // runs while the whelp is out of combat, and damage resets it.
    const { sim, player } = beltWorld();
    walkTheBelt(sim, player);
    const whelp = [...sim.entities.values()].find((e) => e.templateId === WHELP && !e.dead);
    expect(whelp, 'a hatchling to fight').toBeTruthy();
    if (!whelp) throw new Error('unreachable');
    const id = whelp.id;
    // Park the player on it and keep trading hits well past the idle window.
    for (let i = 0; i < DAMAGE_IDLE_DESPAWN_SECONDS + 30; i++) {
      const w = sim.entities.get(id);
      if (!w || w.dead) break;
      w.hp = w.maxHp; // never let it die: this is about despawn, not death
      stand(sim, player, w.pos.x, w.pos.z, 1);
      (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
        player,
        w,
        1,
        false,
        'physical',
        'Probe',
        'hit',
        true,
      );
    }
    const still = sim.entities.get(id);
    expect(still, 'the engaged whelp is still there').toBeTruthy();
    expect(still?.dead).toBe(false);
  });
});
