// Once Balgath sets off on a warpath leg, he reaches that picket and wrecks it.
//
// The owner's report: "he ran toward a spot, then quickly came back to fight me without
// wrecking anything", and it was not an evade. The cause (mob/warpath.ts tickWarpath): a
// lost aggro target reset the whole circuit. Whoever he was focused on dying, releasing, a
// pet falling, a vanish or a feign, all left `aggroTargetId` pointing at nothing, and the
// warpath threw the leg (or the wreck fuse) away and re-opened on FOCUS against the next
// name on his hate table, circuit back at the first stop. Now he turns to that next name
// and carries on; only an empty hate table ends the pull (and then he evades home, a true
// give-up). The other suspects are pinned too, so none can creep in later: the eye ward's
// blind, a taunt, and a leg long enough (round the command camp's keep-out) to outlast the
// old flat 25-second patience and slam an empty patch of fen short of the picket.
//
// Also here: the dev-only trace (mob/warpath_dev_trace.ts) that narrates each decision to
// testers, and the proof it is inert without dev commands.
import { describe, expect, it } from 'vitest';
import { musterCamp } from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import { blindEyeWard, eyeWardBlinded } from '../src/sim/mob/eye_ward';
import { warpathTravelPatience } from '../src/sim/mob/warpath';
import { WARPATH_DEV_TRACE_RANGE } from '../src/sim/mob/warpath_dev_trace';
import { petOf, summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, MobTemplate, SimEvent, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function def(): NonNullable<MobTemplate['warpath']> {
  const d = MOBS[BALGATH]?.warpath;
  if (!d) throw new Error('Balgath has no warpath');
  return d;
}

interface Internals {
  ctx: SimContext;
  musterArmy: MusterArmyState;
  setGm(pid?: number, on?: boolean): void;
  dealDamage(...a: unknown[]): number;
  applyTaunt(p: Entity, mob: Entity): boolean;
  addPlayer(cls: string, name: string): number;
}
const inner = (sim: Sim) => sim as unknown as Internals;

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

const apart = (a: Entity, b: Entity) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

/**
 * The live realm's shape (the scheduler raises him in his crater bed, the muster stands
 * from boot) with two godded players: the owner, and a tank who holds his aggro.
 */
function world(devCommands = false) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: true,
    world: WORLD,
    worldBossAtBoot: true,
    mirefenMuster: true,
    devCommands,
  });
  sim.setPlayerLevel(20);
  inner(sim).setGm(sim.playerId, true);
  const owner = sim.player;
  // The "tank" is a warlock whose demon can hold his aggro: a pet on top of the hate table
  // is the everyday way his target dies without the death path retargeting him (a dead
  // PLAYER is retargeted by the death path itself before the warpath ever sees it).
  const tankId = inner(sim).addPlayer('warlock', 'Tankard');
  const tank = sim.entities.get(tankId) as Entity;
  tank.level = 20;
  inner(sim).setGm(tankId, true);
  summonPet(inner(sim).ctx, tank, 'gloomshade');
  const pet = petOf(inner(sim).ctx, tankId) as Entity;
  // A ranged opener on the rim, off the rim picket's squad.
  place(sim, owner, 128, 306);
  place(sim, tank, 129, 307);
  const events: SimEvent[] = [];
  const tick = () => {
    for (const ev of sim.tick()) events.push(ev);
  };
  tick();
  const bossId = inner(sim).musterArmy.bossId;
  const boss = bossId !== null ? sim.entities.get(bossId) : undefined;
  if (!boss) throw new Error('the scheduler raised no Balgath');
  /**
   * Both players chase him and chip him once a second, the tank hardest (the owner's chip
   * keeps him on the hate table, as any raider who has hit him is; big enough to survive
   * his Barrowhide's 60% cut, which rounds a 1-damage chip to nothing).
   */
  const chase = (seconds: number, done: () => boolean = () => false, keep = 9): number => {
    for (let i = 0; i < 20 * seconds; i++) {
      if (i % 20 === 0 && boss.aiState !== 'evade') {
        if (!tank.dead)
          inner(sim).dealDamage(tank, boss, 20, false, 'physical', 'probe', 'hit', true);
        inner(sim).dealDamage(owner, boss, 5, false, 'physical', 'probe', 'hit', true);
      }
      for (const p of [owner, tank]) {
        if (p.dead || apart(p, boss) <= keep) continue;
        // Kept at `keep` yards off him on the side they trail from: a raid that runs round
        // the reeds and rocks, not a body the test walks into them and strands.
        const a = Math.atan2(p.pos.x - boss.pos.x, p.pos.z - boss.pos.z);
        place(sim, p, boss.pos.x + Math.sin(a) * keep, boss.pos.z + Math.cos(a) * keep);
      }
      tick();
      if (done()) return i / 20;
    }
    return Number.POSITIVE_INFINITY;
  };
  /** Run into his first leg, with the tank as his target. */
  const intoTravel = () => {
    expect(chase(60, () => boss.warpathPhase === 'travel')).toBeLessThan(60);
    boss.threat.set(tank.id, 1e9);
    boss.aggroTargetId = tank.id;
  };
  const kill = (e: Entity) => {
    inner(sim).setGm(e.id, false);
    inner(sim).dealDamage(boss, e, 1e7, false, 'physical', 'probe', 'hit', true);
    expect(e.dead).toBe(true);
  };
  /** The demon on top of his table, then killed where it stands. */
  const petHoldsAggroAndDies = () => {
    expect(pet, 'the demon never came').toBeDefined();
    boss.threat.set(pet.id, 1e9);
    boss.aggroTargetId = pet.id;
    kill(pet);
    // Not vacuous: the death path left him pointed at the corpse, as it does for a pet.
    expect(boss.aggroTargetId).toBe(pet.id);
  };
  return {
    sim,
    owner,
    tank,
    pet,
    boss,
    events,
    tick,
    chase,
    intoTravel,
    kill,
    petHoldsAggroAndDies,
  };
}

/** Runs the current leg out; returns where the wreck ring went down. */
function finishLeg(w: ReturnType<typeof world>): { stop: number; offCentre: number } {
  const { boss, events, chase } = w;
  const stop = boss.warpathDestination ?? -1;
  const from = events.length;
  chase(40, () => boss.warpathPhase === 'focus' || boss.aiState === 'evade');
  const ring = events
    .slice(from)
    .find((e) => e.type === 'spellfxAt' && e.fx === 'nova' && e.radius === def().wreck.radius) as
    | Extract<SimEvent, { type: 'spellfxAt' }>
    | undefined;
  expect(ring, 'the arrival slam never landed').toBeDefined();
  const c = def().destinations[stop];
  return { stop, offCentre: Math.hypot((ring?.x ?? 0) - c.x, (ring?.z ?? 0) - c.z) };
}

describe('a lost target never ends a leg', () => {
  it('the demon holding him dying mid-travel: he turns to the next name and still wrecks', () => {
    const w = world();
    w.intoTravel();
    const leg = w.boss.warpathDestination;
    w.chase(1);
    w.petHoldsAggroAndDies();
    w.tick();
    expect(w.boss.warpathPhase, 'the leg was thrown away').toBe('travel');
    expect(w.boss.warpathDestination).toBe(leg);
    expect(w.boss.aggroTargetId).toBe(w.tank.id);
    const done = finishLeg(w);
    expect(done.stop).toBe(leg);
    expect(done.offCentre).toBeLessThanOrEqual(def().arriveRadius);
    expect(w.boss.aiState).not.toBe('evade');
  });

  it('the demon holding him dying mid-wreck: the fuse still lands on the picket', () => {
    const w = world();
    w.intoTravel();
    const leg = w.boss.warpathDestination;
    expect(w.chase(40, () => w.boss.warpathPhase === 'wreck')).toBeLessThan(40);
    w.petHoldsAggroAndDies();
    w.tick();
    expect(w.boss.warpathPhase, 'the wreck was thrown away').toBe('wreck');
    const done = finishLeg(w);
    expect(done.stop).toBe(leg);
    expect(done.offCentre).toBeLessThanOrEqual(def().arriveRadius);
  });

  it('his target vanishing off the table mid-travel (a vanish, a feign): he carries on', () => {
    const w = world();
    w.intoTravel();
    const leg = w.boss.warpathDestination;
    // What stealth_focus / effect_dispatch do to every mob on the escaper.
    w.boss.threat.delete(w.tank.id);
    w.boss.aggroTargetId = null;
    w.tick();
    expect(w.boss.warpathPhase).toBe('travel');
    // Onto the next name on his table (the owner, or the demon that has been chewing him).
    expect([w.owner.id, w.pet.id]).toContain(w.boss.aggroTargetId);
    expect(finishLeg(w).stop).toBe(leg);
  });

  it('a leg does not survive an EMPTY hate table: that pull is over and he walks home', () => {
    const w = world();
    w.intoTravel();
    w.boss.threat.clear();
    w.boss.aggroTargetId = null;
    w.tick();
    expect(w.boss.warpathPhase).toBeUndefined();
    expect(w.boss.aiState).toBe('evade');
  });

  it('never resets the circuit on a target lost in FOCUS either', () => {
    const w = world();
    w.intoTravel();
    finishLeg(w);
    expect(w.boss.warpathPhase).toBe('focus');
    const stop = w.boss.warpathDestination;
    const clock = w.boss.warpathTimer ?? 0;
    w.petHoldsAggroAndDies();
    w.tick();
    expect(w.boss.warpathPhase).toBe('focus');
    // Same stop remembered, and the focus clock kept running rather than starting over.
    expect(w.boss.warpathDestination).toBe(stop);
    expect(w.boss.warpathTimer ?? 0).toBeLessThan(clock);
  });
});

describe('nothing else interrupts a leg', () => {
  it('the eye ward blinded mid-travel: the leg runs on to its picket', () => {
    const w = world();
    w.intoTravel();
    const leg = w.boss.warpathDestination;
    expect(blindEyeWard(inner(w.sim).ctx, w.boss)).toBe(true);
    expect(eyeWardBlinded(inner(w.sim).ctx, w.boss)).toBe(true);
    w.tick();
    expect(w.boss.warpathPhase).toBe('travel');
    expect(finishLeg(w).stop).toBe(leg);
  });

  it('a taunt mid-travel: threat does not steer him off the leg', () => {
    const w = world();
    w.intoTravel();
    const leg = w.boss.warpathDestination;
    inner(w.sim).applyTaunt(w.owner, w.boss);
    w.tick();
    expect(w.boss.warpathPhase).toBe('travel');
    const done = finishLeg(w);
    expect(done.stop).toBe(leg);
    expect(done.offCentre).toBeLessThanOrEqual(def().arriveRadius);
  });

  it('a leg longer than the flat patience reaches the picket instead of timing out short', () => {
    // From the north-east of his tether to the south picket, past the command camp's
    // keep-out circle: longer than the old flat 25 seconds of patience, which slammed an
    // empty patch of fen short of the picket.
    const w = world();
    w.chase(2);
    expect(w.boss.warpathPhase).toBe('focus');
    const south = def().destinations.findIndex((d) => d.label.includes('south'));
    w.boss.warpathDestination = south - 1;
    const start = { x: 208, z: 358 };
    place(w.sim, w.boss, start.x, start.z);
    w.boss.leashAnchor = { ...w.boss.pos };
    place(w.sim, w.owner, start.x + 4, start.z);
    place(w.sim, w.tank, start.x + 5, start.z + 1);
    w.boss.warpathTimer = 0.01;
    w.chase(1, () => w.boss.warpathPhase === 'travel');
    expect(w.boss.warpathDestination).toBe(south);
    const c = musterCamp('south').center;
    const speed = (MOBS[BALGATH]?.moveSpeed ?? 0) * def().travelSpeedMult;
    const leg = Math.hypot(c.x - start.x, c.z - start.z);
    // The patience covers the detour...
    expect(w.boss.warpathTimer ?? 0).toBeGreaterThan(def().travelTimeoutSeconds);
    expect(warpathTravelPatience(def(), leg, speed)).toBeCloseTo((2 * leg) / speed, 5);
    // ...and he arrives, rather than giving up on the rim of the camp.
    const t0 = w.sim.time;
    const done = finishLeg(w);
    expect(done.stop).toBe(south);
    expect(done.offCentre).toBeLessThanOrEqual(def().arriveRadius);
    // Not vacuous: this leg really did outlast the old flat patience.
    expect(w.sim.time - t0).toBeGreaterThan(def().travelTimeoutSeconds);
  });
});

describe('razed pickets', () => {
  /** Crush every soldier posted at the given stops (what his slams do in a fight). */
  const raze = (w: ReturnType<typeof world>, stops: number[]) => {
    const army = inner(w.sim).musterArmy;
    for (const i of stops) {
      const c = def().destinations[i];
      for (const id of army.soldierIds) {
        const s = w.sim.entities.get(id) as Entity;
        if (Math.hypot(s.spawnPos.x - c.x, s.spawnPos.z - c.z) > def().wreck.radius) continue;
        inner(w.sim).dealDamage(w.boss, s, s.maxHp * 10, false, 'physical', 'probe', 'hit', true);
        expect(s.dead).toBe(true);
      }
    }
  };

  it('are skipped: he marches on the next picket that still has a squad standing', () => {
    const w = world(true);
    raze(w, [0, 1]);
    w.chase(60, () => w.boss.warpathPhase === 'travel');
    expect(w.boss.warpathDestination).toBe(2);
    const lines = w.events
      .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
      .filter((e) => e.pid === w.owner.id && e.text.startsWith('[dev]'))
      .map((e) => e.text);
    expect(lines).toContain('[dev] Balgath: skipping the rim picket (its squad is already down).');
    expect(lines).toContain('[dev] Balgath: skipping the west picket (its squad is already down).');
    expect(lines).toContain('[dev] Balgath: marching to the south picket.');
  });

  it('all razed: he holds focus on the raid, and regroups only when dragged to his leash', () => {
    const w = world();
    raze(w, [0, 1, 2, 3]);
    w.chase(2);
    expect(w.boss.warpathPhase).toBe('focus');
    // His focus clock runs out with nothing left standing: he stays and fights.
    w.boss.warpathTimer = 0.01;
    w.chase(1);
    expect(w.boss.warpathPhase).toBe('focus');
    expect(w.boss.warpathTimer ?? 0).toBeGreaterThan(def().focusSeconds - 2);
    expect(w.boss.aiState).not.toBe('evade');
    // Dragged to the edge of his leash he regroups onto his circuit instead of evading.
    const a = w.boss.pos;
    w.boss.leashAnchor = { x: a.x + 44.5, y: a.y, z: a.z };
    w.tick();
    expect(w.boss.warpathPhase).toBe('travel');
    expect(w.boss.aiState).not.toBe('evade');
  });
});

describe('the dev trace', () => {
  const traced = (events: SimEvent[], pid?: number) =>
    events
      .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
      .filter((e) => e.text.startsWith('[dev] Balgath:') && (pid === undefined || e.pid === pid))
      .map((e) => e.text);

  it('narrates every phase change to the players near him when dev commands are on', () => {
    const w = world(true);
    // A third player far off in the fen, well outside the trace's reach.
    const farId = inner(w.sim).addPlayer('mage', 'Farwatch');
    const far = w.sim.entities.get(farId) as Entity;
    inner(w.sim).setGm(farId, true);
    place(w.sim, far, w.boss.pos.x + WARPATH_DEV_TRACE_RANGE + 40, w.boss.pos.z);
    w.intoTravel();
    finishLeg(w);
    const lines = traced(w.events, w.owner.id);
    expect(lines[0]).toBe('[dev] Balgath: fighting the raid (focus, 30s).');
    expect(lines).toContain('[dev] Balgath: marching to the rim picket.');
    expect(lines).toContain('[dev] Balgath: wrecking the rim picket.');
    expect(lines.filter((l) => l.includes('fighting the raid'))).toHaveLength(2);
    // The tank standing on him hears the same lines; the far player hears none of them.
    expect(traced(w.events, w.tank.id)).toEqual(lines);
    expect(traced(w.events, far.id)).toEqual([]);
    // A lost target and a give-up are narrated too.
    w.chase(40, () => w.boss.warpathPhase === 'travel');
    // The tank vanishes off his table mid-leg (a player death is retargeted by the death
    // path itself before the warpath ever sees it; a vanish is caught here).
    w.boss.threat.delete(w.tank.id);
    w.boss.aggroTargetId = null;
    w.tick();
    expect(traced(w.events, w.owner.id).at(-1)).toBe(
      `[dev] Balgath: lost his target mid-travel, now on ${w.sim.entities.get(w.boss.aggroTargetId ?? -1)?.name}.`,
    );
    place(w.sim, w.boss, w.boss.spawnPos.x - def().giveUp.tetherRadius - 1, w.boss.spawnPos.z);
    place(w.sim, w.owner, w.boss.pos.x + 3, w.boss.pos.z);
    w.tick();
    expect(traced(w.events, w.owner.id).at(-1)).toBe(
      '[dev] Balgath: gives up (tether) and walks home.',
    );
  });

  it('is completely silent without dev commands, and never changes the world', () => {
    const off = world(false);
    const on = world(true);
    for (const w of [off, on]) {
      w.intoTravel();
      finishLeg(w);
      w.chase(20);
    }
    expect(traced(off.events)).toEqual([]);
    expect(traced(on.events).length).toBeGreaterThan(0);
    // Same fight to the tick: the trace reads, it never writes and never draws.
    expect(on.boss.pos).toEqual(off.boss.pos);
    expect(on.boss.hp).toBe(off.boss.hp);
    expect(on.boss.warpathPhase).toBe(off.boss.warpathPhase);
    expect(on.owner.pos).toEqual(off.owner.pos);
    const nonTrace = (w: ReturnType<typeof world>) =>
      w.events.filter((e) => !(e.type === 'log' && e.text.startsWith('[dev]'))).length;
    expect(nonTrace(on)).toBe(nonTrace(off));
  });
});
