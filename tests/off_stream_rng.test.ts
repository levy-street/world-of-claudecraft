// The off-stream rng contract, end to end: CampDef.offStream (a whole camp off the
// shared world stream), MobTemplate.offStreamIdle (one template's idling off it),
// Entity.offStreamRng (the carried flag) and idleRng (mob/idle_rng.ts, the single
// owner of the decision). Three claims the design rests on, each with a control arm
// so no proof can pass vacuously:
//
//   a. an offStream camp draws ZERO shared rng at world build, so adding or removing
//      it leaves every later draw bit-identical. Control: the SAME camp without the
//      flag does shift the stream, and the off-stream camp really did spawn.
//   b. campPrivateRng is seeded from the camp's AUTHORED identity, so REORDERING the
//      CAMPS array cannot move an existing camp's spawns. Control: two camps that
//      differ only in centre draw genuinely different streams.
//   c. an off-stream mob's PASSIVE draws leave the shared draw count FLAT: the idle
//      wander rolls plus the two lifecycle re-rolls of the same timer (respawnMob,
//      resetEvadingMob). Control: the same mob without the flag does draw.
//
// The counter is Rng.setObserver, the tests-only per-draw observer seam
// (src/sim/rng.ts). The world under test is BUILTIN_WORLD with camps, npcs and
// ground objects stripped: nothing but the camp loop draws during construction (the
// ctor's post-camp spawns are rng-free by contract) and nothing but the mob under
// test draws during the tick loop, so a bare count is an exact measurement.

import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { idleRng } from '../src/sim/mob/idle_rng';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import { Sim } from '../src/sim/sim';
import type { CampDef, Entity, WorldContent } from '../src/sim/types';

const SEED = 4242;
const CAMP_MOB = 'forest_wolf';
// Well outside the 360-yd shipped world, so a scratch camp cannot land on world
// content and the mob under test never meets a player or another mob.
const FAR = { x: 600, z: 600 };
const IDLE_TICKS = 400; // 20 s: several wander hops, so the idle arm really rolls

function makeSim(camps: CampDef[]): Sim {
  const world: WorldContent = { ...BUILTIN_WORLD, camps, npcs: {}, groundObjects: [] };
  setActiveWorldContent(world);
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
}

afterAll(() => setActiveWorldContent(BUILTIN_WORLD));

// The shared stream's POSITION after construction, read as the next draws it yields.
// Two worlds agree here only if their builds consumed the same number of draws.
function postBuildDraws(camps: CampDef[]): number[] {
  const sim = makeSim(camps);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(sim.rng.next());
  return out;
}

function mobsOf(sim: Sim, mobId: string): Entity[] {
  return [...sim.entities.values()].filter((e) => e.kind === 'mob' && e.templateId === mobId);
}

interface Spawn {
  x: number;
  z: number;
  level: number;
  facing: number;
  wanderTimer: number;
}

// Every spawn `camp` produced in a world built from `camps`, in spawn order and
// WITHOUT entity ids (which legitimately shift when the array order changes). Camps
// are attributed by nearest centre; the camp radii below never overlap.
function campSpawns(camps: CampDef[], camp: CampDef): Spawn[] {
  const sim = makeSim(camps);
  const out: Spawn[] = [];
  for (const e of mobsOf(sim, camp.mobId)) {
    let nearest = camps[0];
    let bestD = Infinity;
    for (const c of camps) {
      const d = (e.pos.x - c.center.x) ** 2 + (e.pos.z - c.center.z) ** 2;
      if (d < bestD) {
        bestD = d;
        nearest = c;
      }
    }
    if (nearest !== camp) continue;
    out.push({
      x: e.pos.x,
      z: e.pos.z,
      level: e.level,
      facing: e.facing,
      wanderTimer: e.wanderTimer,
    });
  }
  return out;
}

const SCRATCH_CAMP: CampDef = { mobId: CAMP_MOB, center: FAR, radius: 12, count: 5 };
// Same mobId, radius and count, different authored centre: the only thing that may
// separate their private streams is that centre.
const CAMP_A: CampDef = {
  mobId: CAMP_MOB,
  center: { x: 600, z: 600 },
  radius: 12,
  count: 4,
  offStream: true,
};
const CAMP_B: CampDef = {
  mobId: CAMP_MOB,
  center: { x: 660, z: 655 },
  radius: 12,
  count: 4,
  offStream: true,
};

describe('off-stream rng: an offStream camp draws zero shared rng at world build', () => {
  it('leaves the stream where an empty world left it, unlike the same camp on it', () => {
    const empty = postBuildDraws([]);
    expect(postBuildDraws([{ ...SCRATCH_CAMP, offStream: true }])).toEqual(empty);
    // Control: without the flag the very same camp DOES move every later draw, so
    // the equality above measures the mechanism instead of an inert harness.
    expect(postBuildDraws([SCRATCH_CAMP])).not.toEqual(empty);
    // ...and the off-stream camp really scattered its mobs, so "zero draws" is the
    // private sub-stream doing the work, not a camp that silently never spawned.
    const spawned = mobsOf(makeSim([{ ...SCRATCH_CAMP, offStream: true }]), CAMP_MOB);
    expect(spawned).toHaveLength(SCRATCH_CAMP.count);
    for (const mob of spawned) expect(mob.offStreamRng).toBe(true);
  });
});

describe('off-stream rng: campPrivateRng is stable under camp reordering', () => {
  it('spawns a camp identically whether it is first or last in the CAMPS array', () => {
    const aFirst = campSpawns([CAMP_A, CAMP_B], CAMP_A);
    const bFirst = campSpawns([CAMP_B, CAMP_A], CAMP_B);
    expect(aFirst).toHaveLength(CAMP_A.count);
    expect(bFirst).toHaveLength(CAMP_B.count);
    // The seed is the camp's authored identity, never its array index: inserting a
    // camp ahead of another must not move the other one's spawns by a yard.
    expect(campSpawns([CAMP_B, CAMP_A], CAMP_A)).toEqual(aFirst);
    expect(campSpawns([CAMP_A, CAMP_B], CAMP_B)).toEqual(bFirst);
    // Control: the two camps differ ONLY in centre, and that alone gives them
    // different streams, so the pins above are not two views of one shared scatter.
    expect(aFirst.map((s) => s.facing)).not.toEqual(bFirst.map((s) => s.facing));
  });
});

interface IdleRun {
  draws: number;
  wandered: boolean;
}

// Tick an empty world for IDLE_TICKS with one idle mob in it (or none at all) and
// count every shared-stream draw the whole world made.
function idleRun(offStream: boolean | null): IdleRun {
  const sim = makeSim([]);
  let mob: Entity | null = null;
  if (offStream !== null) {
    mob = createMob(970001, MOBS[CAMP_MOB], 5, sim.groundPos(FAR.x, FAR.z));
    mob.aiState = 'idle';
    mob.offStreamRng = offStream;
    sim.addEntity(mob);
  }
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  for (let t = 0; t < IDLE_TICKS; t++) sim.tick();
  sim.rng.setObserver(null);
  const drift =
    mob === null ? 0 : Math.hypot(mob.pos.x - mob.spawnPos.x, mob.pos.z - mob.spawnPos.z);
  return { draws, wandered: drift > 1 };
}

// Re-roll one mob's idle timer through a lifecycle reset and report both the shared
// draws it cost and the timer it landed on.
function lifecycleRun(
  reset: (sim: Sim, mob: Entity) => void,
  offStream: boolean,
): { draws: number; wanderTimer: number } {
  const sim = makeSim([]);
  const mob = createMob(970002, MOBS[CAMP_MOB], 5, sim.groundPos(FAR.x, FAR.z));
  mob.aiState = 'idle';
  mob.offStreamRng = offStream;
  mob.wanderTimer = -1; // so a skipped re-roll cannot read like a rolled one
  sim.addEntity(mob);
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  reset(sim, mob);
  sim.rng.setObserver(null);
  return { draws, wanderTimer: mob.wanderTimer };
}

// The two lifecycle re-rolls of the same idle timer, both range(2, 8).
const RESETS: { name: string; reset: (sim: Sim, mob: Entity) => void }[] = [
  { name: 'respawnMob', reset: (sim, mob) => respawnMob(sim.ctx, mob) },
  { name: 'resetEvadingMob', reset: (sim, mob) => resetEvadingMob(sim.ctx, mob) },
];

describe('off-stream rng: an off-stream mob idles without touching the shared stream', () => {
  it('keeps the shared draw count flat across 400 ticks while its twin draws', () => {
    const none = idleRun(null);
    const off = idleRun(true);
    const on = idleRun(false);
    // FLAT: adding an off-stream idler costs the shared stream exactly nothing.
    expect(off.draws).toBe(none.draws);
    // Control: the same mob without the flag does draw, so the flat count above is
    // the private sub-stream and not a world that simply never rolls.
    expect(on.draws).toBeGreaterThan(none.draws);
    // Non-vacuous: the off-stream mob really idled (rolled a wander target and
    // walked off its spawn), so this is not a frozen AI reading zero.
    expect(off.wandered).toBe(true);
    // Private does not mean unpredictable: a second run evolves identically.
    expect(idleRun(true)).toEqual(off);
  });

  for (const { name, reset } of RESETS) {
    it(`${name} re-rolls the wander timer off-stream for an off-stream mob`, () => {
      const off = lifecycleRun(reset, true);
      // The reset really re-rolled (the timer left its -1 sentinel for the 2..8
      // band) and it cost the shared stream nothing.
      expect(off.wanderTimer).toBeGreaterThanOrEqual(2);
      expect(off.wanderTimer).toBeLessThan(8);
      expect(off.draws).toBe(0);
      // Control: every other mob still re-rolls on the shared stream at exactly one
      // draw, so idleRng's fallback cannot have quietly moved a shipped draw order.
      const on = lifecycleRun(reset, false);
      expect(on.wanderTimer).toBeGreaterThanOrEqual(2);
      expect(on.wanderTimer).toBeLessThan(8);
      expect(on.draws).toBe(1);
    });
  }
});

describe('off-stream rng: the flag rides the template through every spawn path', () => {
  it('createMob stamps offStreamRng from MobTemplate.offStreamIdle', () => {
    // Content first: the brood templates are what the flag exists for.
    expect(MOBS.dragonkin_egg.offStreamIdle).toBe(true);
    expect(MOBS.dragonkin_whelp.offStreamIdle).toBe(true);
    const origin = { x: 0, y: 0, z: 0 };
    // Every spawn path (the camp loop, a hatching egg, a dev spawn) goes through
    // createMob, so stamping it here is what makes the contract path-independent.
    expect(createMob(970003, MOBS.dragonkin_egg, 20, origin).offStreamRng).toBe(true);
    expect(createMob(970004, MOBS.dragonkin_whelp, 20, origin).offStreamRng).toBe(true);
    // An unflagged template stays on the shared stream, where every golden wants it.
    expect(createMob(970005, MOBS[CAMP_MOB], 5, origin).offStreamRng).toBeFalsy();
  });

  it('idleRng hands an unflagged mob the shared stream OBJECT, not a copy', () => {
    const sim = makeSim([]);
    const mob = createMob(970006, MOBS[CAMP_MOB], 5, sim.groundPos(FAR.x, FAR.z));
    // Identity, not equality: this is why routing a draw site through idleRng
    // leaves every shared-stream mob's draw byte-identical.
    expect(idleRng(sim.ctx, mob)).toBe(sim.rng);
    mob.offStreamRng = true;
    expect(idleRng(sim.ctx, mob)).not.toBe(sim.rng);
    // Reproducible from the sim clock plus the mob id alone: same tick, same stream.
    expect(idleRng(sim.ctx, mob).next()).toBe(idleRng(sim.ctx, mob).next());
  });
});
