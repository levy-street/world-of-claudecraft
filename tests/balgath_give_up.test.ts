// Balgath gives the pull up (mob/warpath.ts warpathGiveUp), by the owner's two rules:
//
//   1. He is never kitable out of his area. Past `giveUp.tetherRadius` (100 yards) from his
//      bed, in ANY phase, he drops the fight and walks home (the ordinary evade: immune on
//      the way, full health on arrival). A focus fight dragged near the tether marches on
//      to his next stop instead, and every stop and leg sits inside it, so a raid actually
//      fighting him never resets him on it.
//   2. He never stays "engaged" with nobody fighting him. No living player inside
//      `giveUp.playerRange` (60), or nobody hurting him for `giveUp.unharriedSeconds` (30),
//      and he goes home the same way. Any hit resets the 30 seconds.
//
// A pull ended this way is a real end for the Mirefen muster: the fallen stand up after
// MUSTER_STAND_DOWN_SECONDS and the lent pikes go back with them.
import { describe, expect, it } from 'vitest';
import { MUSTER_RACK } from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { MUSTER_STAND_DOWN_SECONDS, type MusterArmyState } from '../src/sim/mirefen_muster';
import {
  focusDraggedToLeash,
  WARPATH_TETHER_MARCH_MARGIN,
  warpathGiveUp,
} from '../src/sim/mob/warpath';
import { MUSTER_PIKE_MAX_LEVEL, MUSTER_SHARDPIKE_ID } from '../src/sim/muster_pike';
import { Sim } from '../src/sim/sim';
import type { Entity, MobTemplate, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';
/** Fenbridge, the town west of the fen a kiter would drag him toward. */
const FENBRIDGE = { x: 0, z: 300 };
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function bed(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}

function def(): NonNullable<MobTemplate['warpath']> {
  const d = MOBS[BALGATH]?.warpath;
  if (!d) throw new Error('Balgath has no warpath');
  return d;
}

interface Internals {
  musterArmy: MusterArmyState;
  spawnDevBoss(t: string, x: number, z: number): number;
  setGm(pid?: number, on?: boolean): void;
  dealDamage(...a: unknown[]): number;
}
const inner = (sim: Sim) => sim as unknown as Internals;

const fromBed = (e: Entity) => Math.hypot(e.pos.x - bed().x, e.pos.z - bed().z);
const apart = (a: Entity, b: Entity) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

/** Balgath in his bed, a godded level 20 standing off it, and the pull opened. */
function pulled(opts: { pike?: boolean } = {}) {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: WORLD });
  // A pike bearer is a level 19 at most: the rack turns a level 20 away (muster_pike.ts).
  sim.setPlayerLevel(opts.pike ? MUSTER_PIKE_MAX_LEVEL : 20);
  // Godded, or he kills the lone tester and every rule below is measured on a corpse.
  inner(sim).setGm(sim.playerId, true);
  const player = sim.player;
  place(sim, player, MUSTER_RACK.x + 2, MUSTER_RACK.z - 2);
  const id = inner(sim).spawnDevBoss(BALGATH, bed().x, bed().z);
  const boss = sim.entities.get(id) as Entity;
  for (let i = 0; i < 25 && inner(sim).musterArmy.soldierIds.length === 0; i++) sim.tick();
  const army = inner(sim).musterArmy;
  if (opts.pike) {
    player.targetId = army.rackId;
    sim.interact();
    expect(sim.players.get(sim.playerId)?.equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
  }
  place(sim, player, bed().x, bed().z - 18);
  for (let i = 0; i < 40 && !boss.inCombat; i++) sim.tick();
  expect(boss.inCombat, 'the pull never opened').toBe(true);
  const hit = () =>
    inner(sim).dealDamage(player, boss, 20, false, 'physical', 'probe', 'hit', true);
  /** Keep the player `keep` yards off him (a raider chasing), hitting once a second. */
  const chase = (seconds: number, done: () => boolean, keep = 8, harry = true): number => {
    for (let i = 0; i < 20 * seconds; i++) {
      if (harry && i % 20 === 0 && boss.aiState !== 'evade') hit();
      if (apart(player, boss) > keep) {
        const a = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
        place(sim, player, player.pos.x + Math.sin(a) * 0.35, player.pos.z + Math.cos(a) * 0.35);
      }
      sim.tick();
      if (done()) return i / 20;
    }
    return Number.POSITIVE_INFINITY;
  };
  /** Tick until he is home and out of combat; returns the seconds it took. */
  const walkHome = (limit = 90): number => {
    for (let i = 0; i < 20 * limit; i++) {
      if (!boss.inCombat && boss.aiState !== 'evade') return i / 20;
      sim.tick();
    }
    return Number.POSITIVE_INFINITY;
  };
  return { sim, player, boss, army, hit, chase, walkHome };
}

describe('the give-up rule, as a pure function', () => {
  it('pins the owner-approved numbers', () => {
    expect(def().giveUp).toEqual({
      tetherRadius: 100,
      playerRange: 60,
      aloneGraceSeconds: 5,
      unharriedSeconds: 30,
    });
  });

  it('quits past the tether, with nobody near, or with nobody hurting him, and not otherwise', () => {
    const g = def().giveUp;
    expect(warpathGiveUp(g.tetherRadius - 0.1, 0, 0, def())).toBeNull();
    expect(warpathGiveUp(g.tetherRadius + 0.1, 0, 0, def())).toBe('tether');
    // The tether is absolute: a raid on him and hitting him does not buy him past it.
    expect(warpathGiveUp(g.tetherRadius + 0.1, 0, 0, def())).toBe('tether');
    expect(warpathGiveUp(10, g.aloneGraceSeconds - 0.05, 0, def())).toBeNull();
    expect(warpathGiveUp(10, g.aloneGraceSeconds, 0, def())).toBe('alone');
    expect(warpathGiveUp(10, 0, g.unharriedSeconds - 0.05, def())).toBeNull();
    expect(warpathGiveUp(10, 0, g.unharriedSeconds, def())).toBe('unharried');
    // And the regen window stays strictly inside the give-up window: he heals first.
    expect(def().regen.unharriedSeconds).toBeLessThan(g.unharriedSeconds);
  });
});

describe('every stop and leg of his circuit is inside the tether', () => {
  it('with room to spare, so the march-on margin never bites on the circuit itself', () => {
    const limit = def().giveUp.tetherRadius - WARPATH_TETHER_MARCH_MARGIN;
    const stops = [bed(), ...def().destinations];
    let worst = 0;
    // Every leg, the opening march from his bed included, sampled end to end.
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i];
      const b = i + 1 < stops.length ? stops[i + 1] : def().destinations[0];
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        worst = Math.max(worst, Math.hypot(x - bed().x, z - bed().z));
      }
    }
    expect(worst).toBeLessThan(limit - 2);
    // A fight dragged 45 yards off any stop still ends by the tether or the march before
    // Fenbridge: the tether keeps every stop more than 45 yards short of the town.
    for (const s of def().destinations) {
      expect(Math.hypot(s.x - FENBRIDGE.x, s.z - FENBRIDGE.z)).toBeGreaterThan(90);
    }
  });
});

describe('he can never be kited out of his area', () => {
  it('a kiter dragging him toward Fenbridge never gets him past the tether or near the town', () => {
    const { sim, player, boss, hit } = pulled();
    let worst = 0;
    let nearestTown = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 * 400; i++) {
      // The kiter stands 9 yards on his town side and chips him every second, so every
      // focus phase is spent chasing west and nothing ever runs out the 30-second clock.
      const a = Math.atan2(FENBRIDGE.x - boss.pos.x, FENBRIDGE.z - boss.pos.z);
      place(sim, player, boss.pos.x + Math.sin(a) * 9, boss.pos.z + Math.cos(a) * 9);
      if (i % 20 === 0 && boss.aiState !== 'evade') hit();
      sim.tick();
      worst = Math.max(worst, fromBed(boss));
      nearestTown = Math.min(
        nearestTown,
        Math.hypot(boss.pos.x - FENBRIDGE.x, boss.pos.z - FENBRIDGE.z),
      );
    }
    // Not vacuous: the kite really did drag him well out of his bowl.
    expect(worst).toBeGreaterThan(60);
    expect(worst).toBeLessThanOrEqual(def().giveUp.tetherRadius);
    expect(nearestTown).toBeGreaterThan(40);
  });

  it('a body displaced past the tether mid-run evades home at once, immune, and heals', () => {
    const { sim, player, boss, hit, chase, walkHome } = pulled();
    expect(chase(60, () => boss.warpathPhase === 'travel')).toBeLessThan(60);
    boss.hp = boss.maxHp * 0.6;
    // Thrown past the tether (nothing in the fight does this today: the rule is absolute).
    place(sim, boss, bed().x - def().giveUp.tetherRadius - 1, bed().z);
    place(sim, player, boss.pos.x + 4, boss.pos.z);
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.warpathPhase).toBeUndefined();
    // Immune on the way home and never re-pulled by the raid standing on him.
    const hpWalking = boss.hp;
    hit();
    expect(boss.hp).toBe(hpWalking);
    expect(walkHome()).toBeLessThan(90);
    expect(fromBed(boss)).toBeLessThan(2);
    expect(boss.hp).toBe(boss.maxHp);
  });

  it('a body displaced past the tether mid-wreck evades too', () => {
    const { sim, boss, chase } = pulled();
    expect(chase(90, () => boss.warpathPhase === 'wreck')).toBeLessThan(90);
    place(sim, boss, bed().x, bed().z - def().giveUp.tetherRadius - 1);
    sim.tick();
    expect(boss.aiState).toBe('evade');
  });

  it('a focus fight dragged near the tether marches on to his next stop instead', () => {
    const { sim, player, boss, chase } = pulled();
    expect(chase(10, () => false)).toBe(Number.POSITIVE_INFINITY);
    expect(boss.warpathPhase).toBe('focus');
    // Inside the tether, inside the march margin, and nowhere near the soft leash.
    const r = def().giveUp.tetherRadius - WARPATH_TETHER_MARCH_MARGIN + 1;
    place(sim, boss, bed().x - r, bed().z);
    boss.leashAnchor = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z };
    place(sim, player, boss.pos.x + 4, boss.pos.z);
    expect(focusDraggedToLeash(boss)).toBe(true);
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.warpathPhase).toBe('travel');
  });
});

describe('he never stays engaged with nobody fighting him', () => {
  it('evades home once no living player has been within range for the grace window', () => {
    const { sim, player, boss, chase, walkHome } = pulled();
    chase(5, () => false);
    expect(boss.inCombat).toBe(true);
    // Just inside the range he holds...
    const inside = def().giveUp.playerRange - 2;
    place(sim, player, boss.pos.x + inside, boss.pos.z);
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    // ...a brief swing out of range inside the grace does not reset him...
    const outside = def().giveUp.playerRange + 10;
    const hold = (seconds: number, dx: number) => {
      for (let t = 0; t < seconds; t += 0.05) {
        place(sim, player, boss.pos.x + dx, boss.pos.z);
        sim.tick();
      }
    };
    hold(def().giveUp.aloneGraceSeconds - 1, outside);
    expect(boss.aiState).not.toBe('evade');
    hold(0.5, inside);
    expect(boss.aiState).not.toBe('evade');
    // ...but a whole grace window with nobody in range, and he is gone.
    hold(def().giveUp.aloneGraceSeconds + 0.2, outside);
    expect(boss.aiState).toBe('evade');
    expect(walkHome()).toBeLessThan(60);
    expect(boss.hp).toBe(boss.maxHp);
  });

  it('evades once nobody has hurt him for the whole window, never before', () => {
    const { boss, chase } = pulled();
    chase(10, () => false);
    expect(boss.aiState).not.toBe('evade');
    // The raid stays right on him and stops hitting.
    const quit = chase(60, () => boss.aiState === 'evade', 8, false);
    expect(quit).toBeGreaterThan(def().giveUp.unharriedSeconds - 1.2);
    expect(quit).toBeLessThan(def().giveUp.unharriedSeconds + 0.2);
  });

  it('restarts the whole window on any hit', () => {
    const { boss, hit, chase } = pulled();
    chase(20, () => false, 8, false);
    expect(boss.aiState).not.toBe('evade');
    hit();
    // Twenty quiet seconds were already banked: one hit puts all thirty back.
    const quit = chase(60, () => boss.aiState === 'evade', 8, false);
    expect(quit).toBeGreaterThan(def().giveUp.unharriedSeconds - 1.2);
  });

  it('is not held by a dead or released player standing on him', () => {
    const { player, boss, chase } = pulled();
    chase(5, () => false);
    player.dead = true;
    player.ghost = true;
    player.hp = 0;
    const quit = chase(5, () => boss.aiState === 'evade', 4, false);
    expect(quit).toBeLessThan(2);
  });

  it('never evades while a raid keeps chasing and hitting him through a whole lap', () => {
    const { boss, chase } = pulled();
    const wrecked: number[] = [];
    let evaded = false;
    let worst = 0;
    chase(300, () => {
      if (boss.aiState === 'evade') evaded = true;
      worst = Math.max(worst, fromBed(boss));
      const at = boss.warpathDestination ?? -1;
      if (boss.warpathPhase === 'wreck' && wrecked[wrecked.length - 1] !== at) wrecked.push(at);
      const lapDone = wrecked.length === def().destinations.length && boss.warpathPhase === 'focus';
      return evaded || lapDone;
    });
    // ...and every picket razed after it, he keeps fighting the raid rather than giving up.
    chase(40, () => {
      if (boss.aiState === 'evade') evaded = true;
      worst = Math.max(worst, fromBed(boss));
      return evaded;
    });
    expect(evaded, 'he gave up a pull the raid was fighting').toBe(false);
    expect(wrecked).toEqual([0, 1, 2, 3]);
    expect(worst).toBeLessThan(def().giveUp.tetherRadius);
  });
});

describe('a pull he gave up is a real end for the muster', () => {
  const standDown = (quitBy: 'alone' | 'unharried') => {
    const { sim, player, boss, army, chase, walkHome } = pulled({ pike: true });
    chase(5, () => false);
    const victim = sim.entities.get(army.soldierIds[0]) as Entity;
    inner(sim).dealDamage(boss, victim, victim.maxHp * 10, false, 'physical', 'probe', 'hit', true);
    expect(victim.dead).toBe(true);
    // Somewhere out of his reach but inside the muster's (the pike stays lent till the end).
    const away = () => {
      const a = Math.atan2(124 - boss.pos.x, 256 - boss.pos.z);
      place(sim, player, boss.pos.x + Math.sin(a) * 70, boss.pos.z + Math.cos(a) * 70);
    };
    if (quitBy === 'alone') {
      // Kept out of range for the whole grace window, re-placed as he moves.
      for (
        let t = 0;
        t < def().giveUp.aloneGraceSeconds + 0.2 && boss.aiState !== 'evade';
        t += 0.05
      ) {
        away();
        sim.tick();
      }
    } else chase(40, () => boss.aiState === 'evade', 8, false);
    expect(boss.aiState).toBe('evade');
    if (quitBy === 'unharried') away();
    expect(walkHome()).toBeLessThan(60);
    expect(army.lent.has(sim.playerId)).toBe(true);
    // Down for the whole stand-down, pike still in hand...
    for (let i = 0; i < 20 * (MUSTER_STAND_DOWN_SECONDS - 2); i++) sim.tick();
    expect(boss.inCombat, 'he was re-pulled, so this measured nothing').toBe(false);
    expect(victim.dead).toBe(true);
    expect(army.lent.has(sim.playerId)).toBe(true);
    // ...then up, and the pike back on the rack.
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(victim.dead).toBe(false);
    expect(army.lent.has(sim.playerId)).toBe(false);
    expect(sim.players.get(sim.playerId)?.equipment.mainhand).not.toBe(MUSTER_SHARDPIKE_ID);
  };

  it('after everyone left: the fallen rise after the stand-down and the pikes go back', () => {
    standDown('alone');
  });

  it('after nobody hurt him: the fallen rise after the stand-down and the pikes go back', () => {
    standDown('unharried');
  });
});
