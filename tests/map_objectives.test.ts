// The authored-map objective rehearsal: a maker's own flags and rune pads
// actually work.
//
// Until this existed, `regionRole` was a tag with nothing behind it, a map
// could place a flag and get a banner model. These lock the rules that make it a
// game: you cannot take a flag by walking over it, you can by pressing; it
// follows you; dying drops it; your own side puts it back by touching it; a
// capture only counts while your own flag is home; and a rune pad buffs whoever
// steps on it, then recharges.
//
// Everything runs on Thornhollow, the shipped authored map, because the point of
// the feature is that an ORDINARY map drives it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { thornhollowMap } from '../src/editor/shipped_thornhollow';
import { runeGemPose } from '../src/render/battleground_fx_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { mapObjectivesFromPlacements, objectivesArePlayable } from '../src/sim/map_objectives';
import { Sim } from '../src/sim/sim';
import {
  mapObjectiveFlagAction,
  mapObjectiveScores,
  objectiveRun,
} from '../src/sim/social/map_objectives_run';
import type { Entity } from '../src/sim/types';

const map = thornhollowMap('Thornhollow', 'obj_test', 1);
const world = customMapToWorldContent(map);

// setActiveWorldContent is global. Leaving Thornhollow mounted would hand the
// next file in this worker a world carrying objectives, and the driver would
// spawn flags and champions into somebody else's match.
afterEach(() => {
  setActiveWorldContent(null);
});

/**
 * A Sim on Thornhollow with one player standing where the test wants them.
 *
 * The tick before the caller gets it is deliberate: a body's SIDE is decided
 * the first time the run sees it (the base whose flag it is nearest), so the
 * player has to be seen standing in their own end before the test walks them
 * across the map.
 */
function makeSim(at: { x: number; z: number }) {
  setActiveWorldContent(world);
  const sim = new Sim({ seed: map.meta.seed, playerClass: 'warrior', noPlayer: true, world });
  const ctx = sim.ctx;
  const pid = sim.addPlayer('warrior', 'Maker');
  const p = ctx.entities.get(pid) as Entity;
  p.level = 30;
  place(ctx, p, at.x, at.z);
  sim.tick();
  return { sim, ctx, p };
}

function step(sim: Sim): void {
  sim.tick();
}

/** Move a body without touching collision (the tests place, they do not walk). */
function place(ctx: Sim['ctx'], e: Entity, x: number, z: number): void {
  e.pos = ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  ctx.rebucket(e);
}

describe('map objectives: the projection', () => {
  it('reads a map’s regionRole tags into a playable record', () => {
    const o = mapObjectivesFromPlacements(map.placements);
    expect(o).toBeTruthy();
    if (!o) return;
    expect(objectivesArePlayable(o)).toBe(true);
    expect(o.bases[0].flag).toEqual({ x: 0, z: -167 });
    expect(o.bases[1].flag).toEqual({ x: 0, z: 167 });
    expect(o.bases[0].spawns).toHaveLength(5);
    expect(o.bases[1].spawns).toHaveLength(5);
    expect(o.speedRunes).toHaveLength(6);
    expect(o.powerRunes).toHaveLength(4);
  });

  it('takes the FIRST of a duplicated single-valued role instead of fighting', () => {
    // Duplicating a flag is one keypress in the editor, and SPACEY's own export
    // had two of each. A second flag must not become a second capture point.
    const doubled = [...map.placements, ...map.placements.filter((p) => p.regionRole === 'flag0')];
    const o = mapObjectivesFromPlacements(doubled);
    expect(o?.bases[0].flag).toEqual({ x: 0, z: -167 });
  });

  it('gives the built-in world no objectives at all', () => {
    expect(BUILTIN_WORLD.objectives).toBeUndefined();
    expect(objectivesArePlayable(undefined)).toBe(false);
  });
});

describe('map objectives: the flag', () => {
  it('spawns both flags on their stands', () => {
    const { ctx } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    expect(run).toBeTruthy();
    if (!run) return;
    expect(run.flags[0].home.z).toBeCloseTo(-167, 1);
    expect(run.flags[1].home.z).toBeCloseTo(167, 1);
    for (const flag of run.flags) {
      expect(flag.state).toBe('home');
      expect(ctx.entities.get(flag.entityId)?.templateId).toBe('bg_flag');
    }
  });

  it('never picks a flag up by walking over it; the press does', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    // Crimson's own end: the player is team 0, so the AZURE flag is the target.
    place(ctx, p, 0, 167);
    step(sim);
    expect(run.flags[1].state).toBe('home');
    expect(run.flags[1].carrier).toBeNull();

    mapObjectiveFlagAction(ctx, p.id);
    step(sim);
    expect(run.flags[1].state).toBe('carried');
    expect(run.flags[1].carrier).toBe(p.id);
  });

  it('will not let you take your OWN flag', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    place(ctx, p, 0, -167);
    mapObjectiveFlagAction(ctx, p.id);
    step(sim);
    expect(run.flags[0].state).toBe('home');
  });

  it('carries the flag with the runner', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    place(ctx, p, 0, 167);
    mapObjectiveFlagAction(ctx, p.id);
    step(sim);
    place(ctx, p, 0, 100);
    step(sim);
    expect(run.flags[1].pos.z).toBeCloseTo(100, 0);
    expect(ctx.entities.get(run.flags[1].entityId)?.pos.z).toBeCloseTo(100, 0);
  });

  it('drops the flag where the carrier fell, and auto-returns it on the clock', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    place(ctx, p, 0, 167);
    mapObjectiveFlagAction(ctx, p.id);
    step(sim);
    place(ctx, p, 0, 40);
    step(sim);
    // Kill the carrier: the flag falls where they stood.
    p.dead = true;
    step(sim);
    expect(run.flags[1].state).toBe('dropped');
    expect(run.flags[1].pos.z).toBeCloseTo(40, 0);
    // ...and comes home on its own after the return time.
    for (let i = 0; i < 21 * 20; i++) step(sim);
    expect(run.flags[1].state).toBe('home');
    expect(run.flags[1].pos.z).toBeCloseTo(167, 1);
  });

  it('lets the flag’s OWN side return it by touching it', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: 150 }); // team 1 (Azure)
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    // Force Crimson's flag loose in the field.
    run.flags[0].state = 'dropped';
    run.flags[0].pos = ctx.groundPos(0, 20);
    run.flags[0].dropTimer = 20;
    // An Azure body standing on it does nothing: it is not their flag.
    place(ctx, p, 0, 20);
    step(sim);
    expect(run.flags[0].state).toBe('dropped');
    // A Crimson body returns it by proximity, no press.
    const redPid = sim.addPlayer('warrior', 'Red');
    const crimson = ctx.entities.get(redPid) as Entity;
    place(ctx, crimson, 0, -150);
    step(sim); // team assignment happens on first sight, at the Crimson end
    place(ctx, crimson, 0, 20);
    step(sim);
    expect(run.flags[0].state).toBe('home');
  });
});

describe('map objectives: capturing', () => {
  it('only scores while your OWN flag is home', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    // Take Azure's flag.
    place(ctx, p, 0, 167);
    mapObjectiveFlagAction(ctx, p.id);
    step(sim);
    expect(run.flags[1].carrier).toBe(p.id);

    // Our own flag is away: standing on our stand must NOT score. The return
    // clock has to be live, or the flag comes home on this very tick and the
    // gate opens for the wrong reason.
    run.flags[0].state = 'dropped';
    run.flags[0].dropTimer = 20;
    run.flags[0].pos = ctx.groundPos(10, -100);
    place(ctx, p, 0, -167);
    step(sim);
    expect(mapObjectiveScores(ctx)).toEqual([0, 0]);
    expect(run.flags[1].carrier).toBe(p.id);

    // Put our flag back: the waiting carrier caps on the very next tick.
    run.flags[0].state = 'home';
    run.flags[0].pos = { ...run.flags[0].home };
    step(sim);
    expect(mapObjectiveScores(ctx)).toEqual([1, 0]);
    expect(run.flags[1].state).toBe('home');
    expect(run.flags[1].carrier).toBeNull();
  });
});

describe('map objectives: the rune pads', () => {
  it('buffs whoever steps on one, then recharges it', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    const sprint = run.runes.find((r) => !r.power);
    expect(sprint).toBeTruthy();
    if (!sprint) return;
    expect(ctx.entities.get(sprint.entityId)?.templateId).toBe('bg_map_rune');

    place(ctx, p, sprint.pos.x, sprint.pos.z);
    step(sim);
    expect(p.auras.some((a) => a.id === 'bg_sprint_rune')).toBe(true);
    expect(sprint.active).toBe(false);
    expect(ctx.entities.get(sprint.entityId)).toBeUndefined();

    // Walk away and wait out the cooldown: the pad comes back.
    place(ctx, p, 0, -150);
    for (let i = 0; i < 31 * 20; i++) step(sim);
    expect(sprint.active).toBe(true);
    expect(ctx.entities.get(sprint.entityId)?.templateId).toBe('bg_map_rune');
  });

  it('flips a power pad’s face each time it is claimed', () => {
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    const power = run.runes.find((r) => r.power);
    if (!power) throw new Error('no power rune');
    const first = power.face;
    place(ctx, p, power.pos.x, power.pos.z);
    step(sim);
    expect(power.face).not.toBe(first);
  });

  it('detonates a lightning zap where the pad was', () => {
    // The pad is a spinning bolt and it goes off when taken: 'nova' is the
    // renderer's heavy detonation and the radius flashes a ring on the ground
    // under it (renderer.ts spellfxAt). Cosmetic only, nothing reads it back.
    const { sim, ctx, p } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    const pad = run.runes[0];
    place(ctx, p, pad.pos.x, pad.pos.z);
    const events = sim.tick();
    const zap = events.find((e) => e.type === 'spellfxAt');
    expect(zap, 'no zap emitted on pickup').toBeTruthy();
    if (!zap || zap.type !== 'spellfxAt') return;
    expect(zap.fx).toBe('nova');
    expect(zap.school).toBe('lightning');
    expect(zap.radius ?? 0).toBeGreaterThan(0);
    expect(zap.x).toBeCloseTo(pad.pos.x, 3);
    expect(zap.z).toBeCloseTo(pad.pos.z, 3);
  });

  it('spins every pad, with or without a Ravenrift match running', () => {
    // The spin used to live behind BattlegroundFx.update's match gate, so an
    // authored map's pads stood dead still. The pose is match-independent now;
    // this pins the shared core the pass reads.
    expect(runeGemPose(0).spin).toBe(0);
    expect(runeGemPose(1).spin).toBeGreaterThan(0);
    expect(runeGemPose(2).spin).toBeGreaterThan(runeGemPose(1).spin);
  });
});

describe('map objectives: the practice bots', () => {
  it('fills the side the maker is NOT on, and leaves their own side alone', () => {
    const { sim, ctx } = makeSim({ x: 0, z: -150 }); // the maker is Crimson
    step(sim);
    const bots = [...ctx.entities.values()].filter((e) => e.objectiveBot);
    expect(bots.length).toBeGreaterThan(0);
    // Every one of them is Azure: opponents, not teammates running your flag.
    expect(bots.every((b) => b.objectiveBot?.team === 1)).toBe(true);
    expect(bots.every((b) => b.hostile)).toBe(true);
    // They rise on their own spawn ring, not on top of the maker.
    for (const b of bots) expect(b.pos.z).toBeGreaterThan(100);
  });

  it('crosses the whole map to contest the maker’s end', () => {
    // The bar this holds is "they come at you", not "they solve your maze".
    // Thornhollow is 334 yards flag to flag with the Fightpit in the middle;
    // a bot that reaches the far keep's approach has crossed the ravine, found
    // a way past the pit's rim, and is somewhere the maker can fight it.
    const { sim, ctx } = makeSim({ x: 0, z: -150 });
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 * 90; i++) {
      step(sim);
      for (const b of ctx.entities.values()) {
        if (b.objectiveBot?.team === 1 && !b.dead) best = Math.min(best, b.pos.z);
      }
    }
    expect(best).toBeLessThan(-120);
  });

  it('takes a flag it can actually reach', () => {
    // Dropped in the open, the flag is reachable without solving anything, so
    // this pins the whole chain: a bot decides the loose flag is the job, walks
    // to it, and presses. (Inside a keep's courtyard maze they are much less
    // reliable, see the module header on the Y-blind path solver.)
    const { sim, ctx } = makeSim({ x: 0, z: -150 });
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    step(sim);
    const loose = run.flags[0];
    loose.state = 'dropped';
    loose.dropTimer = 9999;
    loose.pos = ctx.groundPos(0, 60);
    for (let i = 0; i < 20 * 60; i++) {
      step(sim);
      if (loose.carrier !== null) break;
    }
    expect(loose.state).toBe('carried');
    const carrier = run.flags[0].carrier !== null ? ctx.entities.get(run.flags[0].carrier) : null;
    expect(carrier?.objectiveBot?.team).toBe(1);
  });

  it('never leashes home mid-run', () => {
    // A mob evades once it is LEASH_DISTANCE from spawnPos, and a flag run here
    // is 334 yards. The rehearsal drags the anchor along under the bot's feet
    // every tick, so the leash can never trip and a champion chases the
    // objective as far as the objective goes.
    const { sim, ctx } = makeSim({ x: 0, z: -150 });
    for (let i = 0; i < 20 * 30; i++) step(sim);
    const bots = [...ctx.entities.values()].filter((e) => e.objectiveBot && !e.dead);
    expect(bots.length).toBeGreaterThan(0);
    for (const b of bots) {
      expect(Math.hypot(b.spawnPos.x - b.pos.x, b.spawnPos.z - b.pos.z)).toBeLessThan(1);
    }
    // And they really did leave their keep rather than milling at the ring.
    expect(Math.min(...bots.map((b) => b.pos.z))).toBeLessThan(60);
  });
});

describe('map objectives: it stays out of the built-in world', () => {
  let sim: Sim;
  beforeEach(() => {
    setActiveWorldContent(null);
    sim = new Sim({ seed: 20061, playerClass: 'warrior', noPlayer: true });
  });

  it('builds no run and spawns no flags on the overworld', () => {
    const ctx = sim.ctx;
    expect(objectiveRun(ctx)).toBeNull();
    sim.tick();
    const flags = [...ctx.entities.values()].filter((e) => e.templateId === 'bg_flag');
    expect(flags).toEqual([]);
    const bots = [...ctx.entities.values()].filter((e) => e.objectiveBot);
    expect(bots).toEqual([]);
  });
});
