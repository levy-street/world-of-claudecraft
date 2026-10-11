// Wake of the Fallen Star (src/sim/mob/boss_starwake.ts + src/sim/boss_starwake_geometry.ts):
// Balgath's star waking, the lava fissures, the geysers and the molten pools.
//
// NO GODMODE, for the reason tests/boss_slams.test.ts spells out: dealDamage returns
// silently for a `gm` target, so a godded subject makes every "was not hit" assertion pass
// for the wrong reason. Subjects are mortal and topped up where they must survive.
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 180_000 });

import {
  insideCircle,
  insideFissure,
  laneClearDistance,
  nearestSafeSpot,
  type StarwakeFissure,
  starwakeLanes,
  starwakeLayout,
  starwakeMode,
} from '../src/sim/boss_starwake_geometry';
import { MUSTER_CAMPS, MUSTER_COMMAND_KEEP_OUT } from '../src/sim/content/mirefen_muster';
import { MOBS } from '../src/sim/data';
import {
  IGNIVAR_METEOR_COUNT_NORMAL,
  IGNIVAR_METEOR_MAX_RANGE,
  IGNIVAR_METEOR_MIN_SEPARATION,
  IGNIVAR_METEOR_RADIUS,
  IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
  IGNIVAR_METEOR_TELEGRAPH_SECONDS,
  ignivarMeteorWarningId,
} from '../src/sim/ignivar_meteors';
import { rangedMechanicBlocked } from '../src/sim/mob/boss_ranged_mechanics';
import {
  forceBossStarwake,
  resetBossStarwake,
  STARWAKE_COLLATERAL_REACH,
  STARWAKE_FISSURE_ABILITY,
  STARWAKE_GEYSER_ABILITY,
  STARWAKE_WAKE_ABILITY,
  starwakeFissuresOf,
  starwakeGeysersOf,
  starwakeLayoutDef,
  starwakePoolsOf,
  starwakeTotal,
  tickBossStarwake,
} from '../src/sim/mob/boss_starwake';
import {
  STARWAKE_METEOR_TELEGRAPH_SECONDS,
  starwakeShowerActive,
  starwakeWavePoints,
} from '../src/sim/mob/boss_starwake_meteors';
import { mechanicLevelMult } from '../src/sim/mob/mechanic_level_scale';
import { mechanicSpacingBlocked } from '../src/sim/mob/mechanic_spacing';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight, MIREFEN_IMPACT_CRATER } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

// Every player here is level 20: his mechanics land at their level-20 size.
const LEVEL_20_MULT = mechanicLevelMult(MOBS.balgath_cyclops.mechanicLevelScale, 20);

const BALGATH = 'balgath_cyclops';

const def = () => {
  const d = MOBS[BALGATH]?.starwake;
  if (!d) throw new Error('balgath_cyclops declares no starwake');
  return d;
};

function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}

function picket(id: string): { x: number; z: number } {
  const camp = MUSTER_CAMPS.find((c) => c.id === id);
  if (!camp) throw new Error(`no picket ${id}`);
  return camp.center;
}

interface Arena {
  sim: Sim;
  ctx: SimContext;
  boss: Entity;
  players: Entity[];
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.onGround = true;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
}

/** A boss held planted in melee with `extra` more players beside the default one. */
function arena(extra: number, seed = 7, at = lair()): Arena {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const id = (
    sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
  ).spawnDevBoss(BALGATH, at.x, at.z);
  const boss = sim.entities.get(id);
  if (!boss) throw new Error('no boss');
  place(sim, boss, at.x, at.z);
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const players = [sim.player];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('priest', `Raider${i}`);
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
    if (!p) throw new Error('no raider');
    players.push(p);
  }
  for (const p of players) place(sim, p, at.x + 3, at.z);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  boss.swingTimer = Number.POSITIVE_INFINITY;
  resetBossStarwake(boss);
  boss.mechanicLockTimer = 0;
  sim.drainEvents();
  return { sim, ctx, boss, players };
}

function tick(a: Arena, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    tickBossStarwake(a.ctx, a.boss);
    out.push(...a.sim.drainEvents());
  }
  return out;
}

function topUp(a: Arena): void {
  for (const p of a.players) p.hp = p.maxHp;
}

type FxAt = Extract<SimEvent, { type: 'spellfxAt' }>;
const fx = (events: SimEvent[], ability: string, kind: string): FxAt[] =>
  events.filter((e): e is FxAt => e.type === 'spellfxAt' && e.ability === ability && e.fx === kind);

const damageTo = (events: SimEvent[], id: number, name: string) =>
  events.filter(
    (e) =>
      e.type === 'damage' &&
      (e as { targetId: number }).targetId === id &&
      (e as { ability?: string }).ability === name,
  );

/** Force a cast and run it to the moment its telegraph goes down. */
function toTelegraph(a: Arena): SimEvent[] {
  expect(forceBossStarwake(a.ctx, a.boss)).toBe(true);
  const out = a.sim.drainEvents();
  out.push(...tick(a, def().warn));
  return out;
}

describe('tuning', () => {
  it('replaces the Barrowglass Scry: no bigCast left on him', () => {
    expect(MOBS[BALGATH]?.bigCast).toBeUndefined();
  });

  it('sits the star at the crater the renderer draws', () => {
    expect(def().star.x).toBe(MIREFEN_IMPACT_CRATER.x);
    expect(def().star.z).toBe(MIREFEN_IMPACT_CRATER.z);
  });

  it('warns, crawls and holds long enough to read, on the Scry cadence', () => {
    const d = def();
    expect(d.every).toBe(40);
    expect(d.warn).toBeGreaterThanOrEqual(2);
    // Five seconds from the paths appearing to the eruption, three of them with the whole
    // pattern already down ("about 3 s after the telegraph completes").
    expect(d.crawl + d.hold).toBeGreaterThanOrEqual(5);
    expect(d.hold).toBeCloseTo(3, 5);
    expect(starwakeTotal(d)).toBeCloseTo(d.warn + d.crawl + d.hold, 9);
  });

  it('prices every hit beside his other kit, and the pools as a nudge', () => {
    const d = def();
    const scryMax = 90;
    expect(d.fissures.max).toBeLessThanOrEqual(scryMax);
    expect(d.geysers.max).toBeLessThan(d.fissures.max);
    expect(d.pool.max * (d.pool.seconds / d.pool.interval)).toBeLessThan(200);
    expect(d.pool.seconds).toBeGreaterThanOrEqual(6);
    expect(d.pool.seconds).toBeLessThanOrEqual(10);
  });

  it('names localize through the sim mechanic matcher, byte-identical', () => {
    expect(localizeSimAuraName(def().name)).toBe('Wake of the Fallen Star');
    expect(localizeSimAuraName(def().pool.name)).toBe('Molten Fen');
    expect(localizeSimAuraName(def().meteors.name)).toBe('Star Debris');
  });
});

describe('geometry', () => {
  const layoutDef = starwakeLayoutDef(def());
  const d = def();

  it('runs from the star when he fights near the crater, and from his feet at a far picket', () => {
    expect(starwakeMode(layoutDef, lair())).toBe('star');
    expect(starwakeMode(layoutDef, picket('rim'))).toBe('star');
    expect(starwakeMode(layoutDef, picket('crater'))).toBe('star');
    expect(starwakeMode(layoutDef, picket('west'))).toBe('feet');
    expect(starwakeMode(layoutDef, picket('south'))).toBe('feet');
    // Standing on the star itself there is no "toward him": his feet.
    expect(starwakeMode(layoutDef, d.star)).toBe('feet');
  });

  it('fans toward him from the star and runs through the fight', () => {
    const boss = picket('rim');
    const layout = starwakeLayout(layoutDef, boss, 0.5, [0, 0, 0, 0]);
    expect(layout.fissures).toHaveLength(d.fissures.fanCount);
    expect(layout.origin).toEqual({ x: d.star.x, z: d.star.z });
    const reach = Math.hypot(boss.x - d.star.x, boss.z - d.star.z);
    for (const f of layout.fissures) {
      expect(f.originX).toBe(d.star.x);
      expect(f.length).toBeGreaterThan(reach);
      expect(Math.hypot(f.dirX, f.dirZ)).toBeCloseTo(1, 9);
    }
  });

  it('rings his feet evenly at a far picket', () => {
    const boss = picket('south');
    const layout = starwakeLayout(layoutDef, boss, 0.2, [0, 0, 0, 0, 0]);
    expect(layout.fissures).toHaveLength(d.fissures.ringCount);
    for (const f of layout.fissures) {
      expect(f.originX).toBe(boss.x);
      expect(f.length).toBe(d.fissures.ringLength);
    }
  });

  // The guarantee: every lane between neighbouring fissures is clear of BOTH strips on its
  // centre line from laneClearDistance out to the tips, at every rotation and at the
  // worst-case wobble, in both modes.
  const SPOTS = [lair(), picket('rim'), picket('crater'), picket('west'), picket('south')];
  it.each(SPOTS.map((s) => [s]))(
    'leaves a safe lane between every pair of fissures at %o',
    (boss) => {
      const count =
        starwakeMode(layoutDef, boss) === 'star' ? d.fissures.fanCount : d.fissures.ringCount;
      const wobbles = [
        Array.from({ length: count }, () => 0),
        Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 1 : -1)),
        Array.from({ length: count }, (_, i) => (i % 2 === 0 ? -1 : 1)),
      ];
      for (const turn of [0, 0.25, 0.5, 0.75, 0.999]) {
        for (const jitter of wobbles) {
          const layout = starwakeLayout(layoutDef, boss, turn, jitter);
          const lanes = starwakeLanes(layout);
          expect(lanes.length).toBe(layout.mode === 'feet' ? count : count - 1);
          const len = layout.fissures[0].length;
          for (const lane of lanes) {
            const clearFrom = laneClearDistance(lane.halfAngle, d.fissures.halfWidth);
            // Wide lanes, not a hair's breadth: clear within a few yards of the origin.
            expect(clearFrom).toBeLessThan(layout.mode === 'feet' ? 6 : 12);
            for (let r = clearFrom + 0.05; r <= len; r += 0.5) {
              const x = layout.origin.x + lane.dirX * r;
              const z = layout.origin.z + lane.dirZ * r;
              for (const f of layout.fissures) {
                expect(insideFissure(f, d.fissures.halfWidth, x, z)).toBe(false);
              }
            }
          }
        }
      }
    },
  );

  it('a strip starts at its origin and ends at its tip', () => {
    const f: StarwakeFissure = { originX: 0, originZ: 0, dirX: 0, dirZ: 1, length: 10 };
    expect(insideFissure(f, 2.5, 0, 5)).toBe(true);
    expect(insideFissure(f, 2.5, 2.4, 5)).toBe(true);
    expect(insideFissure(f, 2.5, 2.6, 5)).toBe(false);
    expect(insideFissure(f, 2.5, 0, -0.1)).toBe(false);
    expect(insideFissure(f, 2.5, 0, 10.1)).toBe(false);
    expect(insideCircle({ x: 0, z: 0, radius: 3 }, 3, 0)).toBe(true);
    expect(insideCircle({ x: 0, z: 0, radius: 3 }, 3.01, 0)).toBe(false);
  });
});

describe('the warning', () => {
  it('opens a cast bar of `warn` seconds, lights the star for the whole run, and yells', () => {
    const a = arena(0);
    expect(forceBossStarwake(a.ctx, a.boss)).toBe(true);
    const evs = a.sim.drainEvents();
    expect(a.boss.castingAbility).toBe(def().name);
    expect(a.boss.castTotal).toBeCloseTo(def().warn, 9);
    const wake = fx(evs, STARWAKE_WAKE_ABILITY, 'burst');
    expect(wake).toHaveLength(1);
    expect(wake[0].x).toBe(def().star.x);
    expect(wake[0].z).toBe(def().star.z);
    expect(wake[0].duration).toBeCloseTo(starwakeTotal(def()), 9);
    expect(wake[0].sourceId).toBe(a.boss.id);
    expect(evs.some((e) => e.type === 'chat' && e.text === def().yell)).toBe(true);
    // Nothing is on the ground yet, and nobody is hurt.
    expect(fx(evs, STARWAKE_FISSURE_ABILITY, 'runeCircle')).toHaveLength(0);
    expect(evs.some((e) => e.type === 'damage')).toBe(false);
  });

  it('ignores pushback: the bar reads the true time left', () => {
    const a = arena(0);
    forceBossStarwake(a.ctx, a.boss);
    tick(a, 1);
    a.boss.castRemaining += 1; // a landed hit pushing the bar back
    tick(a, DT);
    expect(a.boss.castRemaining).toBeCloseTo(def().warn - 1 - DT, 5);
  });

  it('holds the spacing lock for the whole run, so nothing else can start', () => {
    const a = arena(0);
    forceBossStarwake(a.ctx, a.boss);
    expect(a.boss.mechanicLockTimer ?? 0).toBeGreaterThanOrEqual(starwakeTotal(def()));
    tick(a, def().warn + 0.5);
    // Past the bar, with the marks down: the ranged kit and the slams stay locked out.
    expect(a.boss.castingAbility).toBeNull();
    expect(rangedMechanicBlocked(a.boss)).toBe(true);
    expect(mechanicSpacingBlocked(a.boss)).toBe(true);
  });
});

describe('the telegraph', () => {
  it('lays every fissure and geyser at the end of the bar, drawn until the eruption', () => {
    const a = arena(4);
    const evs = toTelegraph(a);
    const d = def();
    const fissures = fx(evs, STARWAKE_FISSURE_ABILITY, 'runeCircle');
    const geysers = fx(evs, STARWAKE_GEYSER_ABILITY, 'runeCircle');
    expect(fissures).toHaveLength(d.fissures.fanCount); // his lair is in star mode
    // One per fissure, plus min(targets, players in range).
    expect(geysers).toHaveLength(d.fissures.fanCount + Math.min(d.geysers.targets, 5));
    for (const e of [...fissures, ...geysers]) {
      expect(e.duration).toBeCloseTo(d.crawl + d.hold, 9);
    }
    const laid = starwakeFissuresOf(a.boss);
    fissures.forEach((e, i) => {
      expect(e.x).toBe(laid[i].originX);
      expect(e.radius).toBe(laid[i].length);
      expect(e.dirX).toBe(laid[i].dirX);
    });
    const targeted = geysers.filter((g) => g.targetId !== undefined);
    expect(targeted).toHaveLength(d.geysers.targets);
    for (const g of targeted) expect(g.radius).toBe(d.geysers.radius);
    // Distinct players.
    expect(new Set(targeted.map((g) => g.targetId)).size).toBe(targeted.length);
  });

  it('a lone tester still gets his geyser', () => {
    const a = arena(0);
    const evs = toTelegraph(a);
    const targeted = fx(evs, STARWAKE_GEYSER_ABILITY, 'runeCircle').filter(
      (g) => g.targetId === a.sim.player.id,
    );
    expect(targeted).toHaveLength(1);
  });

  it('bursts from under his feet at a far picket', () => {
    const a = arena(0, 7, picket('south'));
    toTelegraph(a);
    const laid = starwakeFissuresOf(a.boss);
    expect(laid).toHaveLength(def().fissures.ringCount);
    for (const f of laid) {
      expect(f.originX).toBeCloseTo(a.boss.pos.x, 9);
      expect(f.originZ).toBeCloseTo(a.boss.pos.z, 9);
    }
  });
});

describe('the eruption', () => {
  it('lands exactly `hold` seconds after the crawl completes, and only inside the marks', () => {
    const a = arena(3);
    toTelegraph(a);
    const d = def();
    const [victim, inStrip, inLane, bystander] = a.players;
    const fissures = starwakeFissuresOf(a.boss);
    const geysers = starwakeGeysersOf(a.boss);
    // The geyser victim stays put; one player steps into a strip, one into a lane, and one
    // walks right out of everything.
    const f0 = fissures[0];
    place(a.sim, inStrip, f0.originX + f0.dirX * 20, f0.originZ + f0.dirZ * 20);
    const lane = starwakeLanes({
      mode: 'star',
      origin: { x: f0.originX, z: f0.originZ },
      fissures,
    })[0];
    place(a.sim, inLane, f0.originX + lane.dirX * 20, f0.originZ + lane.dirZ * 20);
    place(a.sim, bystander, a.boss.pos.x - 80, a.boss.pos.z);
    // Only the victim's own circle stays where it was drawn; the rest must not cover the
    // two probe spots, or the test would be measuring luck.
    for (const c of geysers) {
      if (insideCircle(c, inLane.pos.x, inLane.pos.z))
        place(a.sim, inLane, f0.originX + lane.dirX * 14, f0.originZ + lane.dirZ * 14);
    }
    topUp(a);
    const vx = victim.pos.x;
    const vz = victim.pos.z;
    const victimInMark = geysers.some((c) => insideCircle(c, vx, vz));
    const quiet = tick(a, d.crawl + d.hold - 2 * DT);
    expect(quiet.some((e) => e.type === 'damage')).toBe(false);
    const evs = tick(a, 2 * DT);
    expect(fx(evs, STARWAKE_FISSURE_ABILITY, 'nova')).toHaveLength(fissures.length);
    expect(fx(evs, STARWAKE_GEYSER_ABILITY, 'nova')).toHaveLength(geysers.length);
    expect(damageTo(evs, inStrip.id, d.name).length).toBeGreaterThanOrEqual(1);
    const inLaneMarked =
      fissures.some((f) => insideFissure(f, d.fissures.halfWidth, inLane.pos.x, inLane.pos.z)) ||
      geysers.some((c) => insideCircle(c, inLane.pos.x, inLane.pos.z));
    if (!inLaneMarked) expect(damageTo(evs, inLane.id, d.name)).toHaveLength(0);
    expect(damageTo(evs, bystander.id, d.name)).toHaveLength(0);
    if (victimInMark) expect(damageTo(evs, victim.id, d.name).length).toBeGreaterThanOrEqual(1);
    // Every hit is inside the classic-era band (times his mechanic multiplier and the level-20
    // size of his mechanics, mob/mechanic_level_scale.ts).
    const mult = (a.boss.mechanicDamageMult ?? 1) * LEVEL_20_MULT;
    for (const e of damageTo(evs, inStrip.id, d.name)) {
      const amount = (e as { amount: number }).amount;
      expect(amount).toBeLessThanOrEqual(Math.round(d.fissures.max * mult) + d.geysers.max * mult);
    }
    expect(a.boss.starwakeElapsed).toBeUndefined();
  });

  const soldierAt = (a: Arena, x: number, z: number): Entity => {
    const id = (
      a.sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('muster_footman', x, z);
    const soldier = a.sim.entities.get(id);
    if (!soldier) throw new Error('no soldier');
    place(a.sim, soldier, x, z);
    soldier.hp = soldier.maxHp;
    return soldier;
  };

  it('crushes a muster soldier caught in a fissure in the fight round him', () => {
    const a = arena(0, 7, picket('south'));
    toTelegraph(a);
    const f0 = starwakeFissuresOf(a.boss)[0];
    // Feet mode: the strip leaves from under him, so ten yards down it is the fight.
    const soldier = soldierAt(a, f0.originX + f0.dirX * 10, f0.originZ + f0.dirZ * 10);
    tick(a, def().crawl + def().hold + DT);
    expect(soldier.dead).toBe(true);
  });

  it('never razes a distant picket a fissure happens to cross', () => {
    const a = arena(0);
    toTelegraph(a);
    const f0 = starwakeFissuresOf(a.boss)[0];
    // Down the strip but past the fight (STARWAKE_COLLATERAL_REACH from him).
    let d = f0.length - 1;
    const at = () => ({ x: f0.originX + f0.dirX * d, z: f0.originZ + f0.dirZ * d });
    while (
      d > 0 &&
      Math.hypot(at().x - a.boss.pos.x, at().z - a.boss.pos.z) <= STARWAKE_COLLATERAL_REACH + 1
    )
      d -= 1;
    expect(Math.hypot(at().x - a.boss.pos.x, at().z - a.boss.pos.z)).toBeGreaterThan(
      STARWAKE_COLLATERAL_REACH,
    );
    const soldier = soldierAt(a, at().x, at().z);
    tick(a, def().crawl + def().hold + DT);
    expect(soldier.dead).toBe(false);
  });
});

/** Run a forced cast to the tick before the eruption. */
function toEruptionEve(a: Arena): void {
  toTelegraph(a);
  tick(a, def().crawl + def().hold - DT);
}

/** Run a forced cast through the eruption tick; returns that tick's events. */
function toEruption(a: Arena): SimEvent[] {
  toEruptionEve(a);
  return tick(a, DT);
}

const METEOR = () => def().meteors.name;

/** Tick one at a time, recording each tick's meteor falls, until the shower is over. */
function runShower(a: Arena, onTick?: (i: number) => void): { falls: FxAt[][]; all: SimEvent[] } {
  const falls: FxAt[][] = [];
  const all: SimEvent[] = [];
  const limit = Math.round((def().meteors.seconds + STARWAKE_METEOR_TELEGRAPH_SECONDS + 2) / DT);
  for (let i = 0; i < limit && starwakeShowerActive(a.boss); i++) {
    onTick?.(i);
    const evs = tick(a, DT);
    all.push(...evs);
    const f = fx(evs, METEOR(), 'meteorFall');
    if (f.length > 0) falls.push(f);
  }
  return { falls, all };
}

describe("the meteor shower (Star Debris: Ignivar's Falling Cinders, reused)", () => {
  it('rains for the pools life in waves of 2 to 3, every 0.5 to 0.7 s, a notch under a geyser', () => {
    const d = def();
    const m = d.meteors;
    expect(STARWAKE_METEOR_TELEGRAPH_SECONDS).toBe(IGNIVAR_METEOR_TELEGRAPH_SECONDS);
    expect(m.name).toBe('Star Debris');
    expect(d.school).toBe('fire');
    expect(m.seconds).toBe(d.pool.seconds);
    expect([m.waveMin, m.waveMax]).toEqual([0.5, 0.7]);
    expect([m.perWaveMin, m.perWaveMax]).toEqual([2, 3]);
    // A wave is a cut of Ignivar's Normal pattern, so it can never ask for more.
    expect(m.perWaveMax).toBeLessThanOrEqual(IGNIVAR_METEOR_COUNT_NORMAL);
    expect(m.min).toBeLessThan(d.geysers.min);
    expect(m.max).toBeLessThan(d.geysers.max);
    expect(m.min).toBeGreaterThan(0);
  });

  it('nothing falls before the eruption; the first wave comes down on the eruption tick', () => {
    const a = arena(0);
    toTelegraph(a);
    const early = tick(a, def().crawl + def().hold - DT);
    expect(early.some((e) => e.type === 'spellfxAt' && e.fx === 'meteorFall')).toBe(false);
    expect(starwakeShowerActive(a.boss)).toBe(false);
    const evs = tick(a, DT);
    expect(fx(evs, STARWAKE_FISSURE_ABILITY, 'nova').length).toBeGreaterThan(0);
    const first = fx(evs, METEOR(), 'meteorFall');
    expect(first.length).toBeGreaterThanOrEqual(def().meteors.perWaveMin);
    expect(first.length).toBeLessThanOrEqual(def().meteors.perWaveMax);
    expect(starwakeShowerActive(a.boss)).toBe(true);
  });

  it('many meteors, each exactly an Ignivar meteor, landing on its own warning id', () => {
    for (const seed of [1, 7, 42]) {
      const a = arena(4, seed);
      a.players.forEach((p, i) => {
        const ang = (i / a.players.length) * Math.PI * 2;
        place(a.sim, p, a.boss.pos.x + Math.sin(ang) * 12, a.boss.pos.z + Math.cos(ang) * 12);
        p.maxHp = 100_000;
      });
      topUp(a);
      const first = toEruption(a);
      const shower = a.boss.starwakeShower;
      if (!shower) throw new Error('no shower');
      const origin = { x: shower.originX, z: shower.originZ };
      const key = shower.key;
      const rest = runShower(a);
      const waves = [fx(first, METEOR(), 'meteorFall'), ...rest.falls];
      const falls = waves.flat();
      // Some 25 to 35 over the eight seconds.
      expect(falls.length).toBeGreaterThanOrEqual(25);
      expect(falls.length).toBeLessThanOrEqual(38);
      expect(waves.length).toBeGreaterThanOrEqual(12);
      const ids = new Set<string>();
      falls.forEach((e, serial) => {
        expect(e.school).toBe('fire');
        expect(e.radius).toBe(IGNIVAR_METEOR_RADIUS);
        expect(e.duration).toBe(IGNIVAR_METEOR_TELEGRAPH_SECONDS);
        expect(e.warningLead).toBe(IGNIVAR_METEOR_REVEAL_DELAY_SECONDS);
        expect(e.persistentId).toBe(ignivarMeteorWarningId(a.boss.id, key, serial));
        expect(e.sourceId).toBe(a.boss.id);
        expect(Math.hypot(e.x - origin.x, e.z - origin.z)).toBeLessThanOrEqual(
          IGNIVAR_METEOR_MAX_RANGE + 1e-6,
        );
        ids.add(e.persistentId ?? '');
      });
      expect(ids.size).toBe(falls.length);
      // Never stacked in one wave: Ignivar's Normal minimum separation.
      for (const w of waves) {
        expect(w.length).toBeLessThanOrEqual(def().meteors.perWaveMax);
        for (let i = 0; i < w.length; i++) {
          for (let j = i + 1; j < w.length; j++) {
            expect(Math.hypot(w[i].x - w[j].x, w[i].z - w[j].z)).toBeGreaterThanOrEqual(
              IGNIVAR_METEOR_MIN_SEPARATION - 1e-6,
            );
          }
        }
      }
      // Every meteor lands once, on the id its warning carried, and the shower ends.
      const impacts = fx([...first, ...rest.all], METEOR(), 'meteorImpact');
      expect(impacts.map((e) => e.persistentId).sort()).toEqual([...ids].sort());
      expect(a.boss.starwakeShower).toBeUndefined();
    }
  });

  it('spreads over the fight: on players, along the cracks, round the star', () => {
    const a = arena(4);
    a.players.forEach((p, i) => {
      const ang = (i / a.players.length) * Math.PI * 2;
      place(a.sim, p, a.boss.pos.x + Math.sin(ang) * 12, a.boss.pos.z + Math.cos(ang) * 12);
      p.maxHp = 100_000;
    });
    topUp(a);
    toEruptionEve(a);
    const fissures = starwakeFissuresOf(a.boss);
    const spots = a.players.map((p) => ({ x: p.pos.x, z: p.pos.z }));
    const first = tick(a, DT);
    // Freeze the raid in place so the player anchors stay put.
    const falls = [...fx(first, METEOR(), 'meteorFall'), ...runShower(a).falls.flat()];
    const onPlayer = falls.filter((e) =>
      spots.some((s) => Math.hypot(e.x - s.x, e.z - s.z) < 1e-6),
    );
    const onCrack = falls.filter((e) => fissures.some((f) => insideFissure(f, 0.01, e.x, e.z)));
    const byStar = falls.filter((e) => Math.hypot(e.x - def().star.x, e.z - def().star.z) <= 8);
    expect(onPlayer.length).toBeGreaterThanOrEqual(3);
    expect(onCrack.length).toBeGreaterThanOrEqual(2);
    expect(byStar.length).toBeGreaterThanOrEqual(2);
  });

  it('pins the wave layout to Ignivar: a player anchor is his exact first candidate', () => {
    const a = arena(0);
    toEruptionEve(a);
    const me = a.players[0];
    const at = { x: me.pos.x, z: me.pos.z };
    const evs = tick(a, DT);
    const shower = a.boss.starwakeShower;
    if (!shower) throw new Error('no shower');
    const wave0 = fx(evs, METEOR(), 'meteorFall').map((e) => ({ x: e.x, z: e.z }));
    expect(wave0).toEqual(
      starwakeWavePoints(def(), shower, 0, [{ id: me.id, ...at }], a.boss.aggroTargetId),
    );
    expect(wave0[0]).toEqual(at);
  });

  it('never anchors a player outside the arena (no meteor dragged onto its rim)', () => {
    const shower = { key: 12345, originX: 0, originZ: 0, lines: [] };
    const far = { id: 1, x: IGNIVAR_METEOR_MAX_RANGE + 8, z: 0 };
    for (let wave = 0; wave < 20; wave += 2) {
      const pts = starwakeWavePoints(def(), shower, wave, [far], null);
      const onRim = pts.filter(
        (p) => Math.abs(Math.hypot(p.x, p.z) - IGNIVAR_METEOR_MAX_RANGE) < 1e-6 && p.z === 0,
      );
      expect(onRim).toHaveLength(0);
    }
    const near = { id: 2, x: 12, z: 3 };
    expect(starwakeWavePoints(def(), shower, 0, [near], null)[0]).toEqual({ x: 12, z: 3 });
  });

  it('hits a player standing in a circle when it lands, never one outside', () => {
    const a = arena(1);
    const first = toEruption(a);
    const wave0 = fx(first, METEOR(), 'meteorFall');
    const [inCircle, outside] = a.players;
    place(a.sim, inCircle, wave0[0].x, wave0[0].z);
    place(a.sim, outside, a.boss.pos.x - 80, a.boss.pos.z);
    inCircle.maxHp = 100_000;
    topUp(a);
    const before = tick(a, STARWAKE_METEOR_TELEGRAPH_SECONDS - DT);
    expect(damageTo(before, inCircle.id, METEOR())).toHaveLength(0);
    expect(fx(before, METEOR(), 'meteorImpact')).toHaveLength(0);
    const evs = tick(a, DT);
    const hits = damageTo(evs, inCircle.id, METEOR());
    expect(hits).toHaveLength(1);
    const mult = (a.boss.mechanicDamageMult ?? 1) * LEVEL_20_MULT;
    const amount = (hits[0] as { amount: number }).amount;
    expect(amount).toBeGreaterThanOrEqual(Math.round(def().meteors.min * mult) - 1);
    expect(amount).toBeLessThanOrEqual(Math.round(def().meteors.max * mult) + 1);
    expect(damageTo(evs, outside.id, METEOR())).toHaveLength(0);
    expect(fx(evs, METEOR(), 'meteorImpact').map((e) => e.persistentId)).toEqual(
      wave0.map((e) => e.persistentId),
    );
  });

  it('a raider who keeps moving takes two at most; one who stands still takes many', () => {
    for (const seed of [1, 7, 42, 99]) {
      const a = arena(1, seed);
      const [still, mover] = a.players;
      for (const p of a.players) p.maxHp = 1_000_000;
      topUp(a);
      toEruptionEve(a);
      const c = { x: a.boss.pos.x, z: a.boss.pos.z };
      // Run speed round him, 15 yards out.
      let ang = 0;
      const step = () => {
        ang += (7 / 15) * DT;
        place(a.sim, mover, c.x + Math.sin(ang) * 15, c.z + Math.cos(ang) * 15);
        still.hp = still.maxHp;
        mover.hp = mover.maxHp;
      };
      step();
      const evs = tick(a, DT);
      evs.push(...runShower(a, step).all);
      expect(damageTo(evs, mover.id, METEOR()).length).toBeLessThanOrEqual(2);
      expect(damageTo(evs, still.id, METEOR()).length).toBeGreaterThan(2);
    }
  });

  it('crushes a muster soldier in a circle in the fight round him, as the fissures do', () => {
    const a = arena(0);
    const first = toEruption(a);
    const m = fx(first, METEOR(), 'meteorFall').find(
      (p) => Math.hypot(p.x - a.boss.pos.x, p.z - a.boss.pos.z) <= STARWAKE_COLLATERAL_REACH - 1,
    );
    if (!m) throw new Error('no meteor inside the fight');
    const id = (
      a.sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('muster_footman', m.x, m.z);
    const soldier = a.sim.entities.get(id);
    if (!soldier) throw new Error('no soldier');
    place(a.sim, soldier, m.x, m.z);
    soldier.hp = soldier.maxHp;
    tick(a, STARWAKE_METEOR_TELEGRAPH_SECONDS + DT);
    expect(soldier.dead).toBe(true);
  });

  it('never lands in the command camp, and a player inside it is never an anchor', () => {
    const k = MUSTER_COMMAND_KEEP_OUT;
    for (const seed of [1, 7, 42]) {
      // Beside the camp's edge, a raider standing at its centre inside it.
      const a = arena(3, seed, { x: k.x + k.radius + 6, z: k.z });
      place(a.sim, a.players[1], k.x, k.z);
      for (const p of a.players) p.maxHp = 100_000;
      topUp(a);
      const first = toEruption(a);
      const falls = [...fx(first, METEOR(), 'meteorFall'), ...runShower(a).falls.flat()];
      expect(falls.length).toBeGreaterThan(10);
      for (const m of falls) {
        expect(Math.hypot(m.x - k.x, m.z - k.z)).toBeGreaterThanOrEqual(
          k.radius + IGNIVAR_METEOR_RADIUS,
        );
      }
    }
  });

  it('the pull reset drops the shower, and a felled Foreman lands none', () => {
    const a = arena(0);
    toEruption(a);
    expect(starwakeShowerActive(a.boss)).toBe(true);
    resetBossStarwake(a.boss);
    expect(starwakeShowerActive(a.boss)).toBe(false);
    const evs = tick(a, STARWAKE_METEOR_TELEGRAPH_SECONDS + DT);
    expect(fx(evs, METEOR(), 'meteorImpact')).toHaveLength(0);
    const b = arena(0);
    toEruption(b);
    b.boss.dead = true;
    const after = tick(b, STARWAKE_METEOR_TELEGRAPH_SECONDS + DT);
    expect(fx(after, METEOR(), 'meteorImpact')).toHaveLength(0);
    expect(after.some((e) => e.type === 'damage')).toBe(false);
  });

  it('a new star waits for the last shower to finish', () => {
    const a = arena(0);
    toEruption(a);
    expect(forceBossStarwake(a.ctx, a.boss)).toBe(false);
    a.boss.starwakeTimer = DT;
    a.boss.mechanicLockTimer = 0;
    tick(a, DT);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    // It holds at due right through the shower; then it may go.
    place(a.sim, a.players[0], a.boss.pos.x - 90, a.boss.pos.z);
    runShower(a);
    expect(a.boss.starwakeElapsed).toBeDefined();
    resetBossStarwake(a.boss);
    toEruption(a);
    runShower(a);
    a.boss.starwakeTimer = 1000;
    expect(starwakeShowerActive(a.boss)).toBe(false);
    expect(forceBossStarwake(a.ctx, a.boss)).toBe(true);
  });

  it('places without rng: a shower that strikes nobody draws nothing', () => {
    const a = arena(0);
    toTelegraph(a);
    // The lone tester walks far off, so nothing strikes anyone.
    place(a.sim, a.players[0], a.boss.pos.x - 90, a.boss.pos.z);
    tick(a, def().crawl + def().hold - DT);
    let draws = 0;
    const next = a.ctx.rng.next.bind(a.ctx.rng);
    a.ctx.rng.next = () => {
      draws++;
      return next();
    };
    const evs = tick(a, DT);
    evs.push(...runShower(a).all);
    expect(fx(evs, METEOR(), 'meteorFall').length).toBeGreaterThan(20);
    expect(draws).toBe(0);
  });

  it('lays the same shower for the same seed', () => {
    const run = () => {
      const a = arena(2, 13);
      for (const p of a.players) p.maxHp = 100_000;
      topUp(a);
      const first = toEruption(a);
      const falls = [...fx(first, METEOR(), 'meteorFall'), ...runShower(a).falls.flat()];
      return falls.map((e) => [e.x, e.z, e.persistentId]);
    };
    expect(run()).toEqual(run());
  });
});

describe('the pools', () => {
  it('each geyser leaves a pool of its own radius that burns once a second for its life', () => {
    const a = arena(1);
    toTelegraph(a);
    const d = def();
    const geysers = starwakeGeysersOf(a.boss);
    const [stayer, walker] = a.players;
    // After the telegraph goes down: one player walks off, one stands in a pool-to-be.
    const spot = geysers[0];
    place(a.sim, walker, a.boss.pos.x - 90, a.boss.pos.z);
    tick(a, d.crawl + d.hold);
    const pools = starwakePoolsOf(a.boss);
    expect(pools).toHaveLength(geysers.length);
    pools.forEach((p, i) => {
      expect(p.radius).toBe(geysers[i].radius);
      expect(p.remaining).toBeCloseTo(d.pool.seconds, 9);
    });
    // Now step into the first pool and stay the whole time.
    place(a.sim, stayer, spot.x, spot.z);
    stayer.maxHp = 100_000;
    stayer.hp = stayer.maxHp;
    const burn = tick(a, d.pool.seconds + 1);
    const ticks = damageTo(burn, stayer.id, d.pool.name);
    expect(ticks).toHaveLength(Math.round(d.pool.seconds / d.pool.interval));
    for (const t of ticks) {
      const amount = (t as { amount: number }).amount;
      const mult = (a.boss.mechanicDamageMult ?? 1) * LEVEL_20_MULT;
      expect(amount).toBeGreaterThanOrEqual(Math.round(d.pool.min * mult) - 1);
      expect(amount).toBeLessThanOrEqual(Math.round(d.pool.max * mult) + 1);
    }
    expect(damageTo(burn, walker.id, d.pool.name)).toHaveLength(0);
    expect(starwakePoolsOf(a.boss)).toHaveLength(0);
  });

  it('a soldier standing in a pool dies', () => {
    const a = arena(0);
    toTelegraph(a);
    tick(a, def().crawl + def().hold);
    // The targeted pool under the lone tester, who stood beside him.
    const pools = starwakePoolsOf(a.boss);
    const pool = pools[pools.length - 1];
    const id = (
      a.sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('muster_footman', 0, 0);
    const soldier = a.sim.entities.get(id);
    if (!soldier) throw new Error('no soldier');
    place(a.sim, soldier, pool.x, pool.z);
    soldier.hp = soldier.maxHp;
    tick(a, def().pool.interval + DT);
    expect(soldier.dead).toBe(true);
  });

  it('never cover the ground round him: a safe spot is always a few steps away', () => {
    for (const at of [lair(), picket('rim'), picket('south'), picket('west')]) {
      for (const seed of [1, 7, 42, 99]) {
        const a = arena(7, seed, at);
        // A realistic raid spread round him.
        a.players.forEach((p, i) => {
          const ang = (i / a.players.length) * Math.PI * 2;
          place(a.sim, p, at.x + Math.sin(ang) * 9, at.z + Math.cos(ang) * 9);
        });
        toTelegraph(a);
        const fissures = starwakeFissuresOf(a.boss);
        const geysers = starwakeGeysersOf(a.boss);
        const hw = def().fissures.halfWidth;
        // During the telegraph (strips AND circles): every player has somewhere to stand
        // within a short run of the five seconds they are given.
        for (const p of a.players) {
          const safe = nearestSafeSpot(p.pos, fissures, hw, geysers, 12);
          expect(safe).not.toBeNull();
        }
        tick(a, def().crawl + def().hold);
        // After it (the pools): most of the ground within 20 yards of him is still clear.
        const pools = starwakePoolsOf(a.boss);
        let clear = 0;
        let total = 0;
        for (let x = -20; x <= 20; x += 1) {
          for (let z = -20; z <= 20; z += 1) {
            if (x * x + z * z > 400) continue;
            total++;
            if (!pools.some((c) => insideCircle(c, at.x + x, at.z + z))) clear++;
          }
        }
        expect(clear / total).toBeGreaterThan(0.6);
        expect(nearestSafeSpot(a.boss.pos, [], hw, pools, 10)).not.toBeNull();
      }
    }
  });
});

describe('cadence and gating', () => {
  it('starts on its own after `every` seconds planted, and not before', () => {
    const a = arena(0);
    a.boss.starwakeTimer = 1;
    tick(a, 1 - DT);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    tick(a, 2 * DT);
    expect(a.boss.starwakeElapsed).toBeDefined();
    expect(a.boss.starwakeTimer).toBeCloseTo(def().every, 5);
  });

  it('holds at due while another telegraph is winding', () => {
    const a = arena(0);
    a.boss.starwakeTimer = DT;
    a.boss.rangedWindup = 1;
    tick(a, 0.5);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    expect(a.boss.starwakeTimer ?? 0).toBeLessThan(0);
    a.boss.rangedWindup = 0;
    a.boss.mechanicLockTimer = 0;
    tick(a, DT);
    expect(a.boss.starwakeElapsed).toBeDefined();
  });

  it('waits out the shared spacing lock and an aimed slam on the ground', () => {
    const a = arena(0);
    a.boss.starwakeTimer = DT;
    a.boss.mechanicLockTimer = 2;
    tick(a, 0.5);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    a.boss.mechanicLockTimer = 0;
    a.boss.slamWindup = 1;
    tick(a, 0.2);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    a.boss.slamWindup = 0;
    tick(a, DT);
    expect(a.boss.starwakeElapsed).toBeDefined();
  });

  it('a Foreman felled mid-telegraph lands nothing', () => {
    const a = arena(0);
    toTelegraph(a);
    a.boss.dead = true;
    const evs = tick(a, def().crawl + def().hold + 1);
    expect(fx(evs, STARWAKE_FISSURE_ABILITY, 'nova')).toHaveLength(0);
    expect(evs.some((e) => e.type === 'damage')).toBe(false);
  });

  it('never starts a cast his focus phase cannot hold, nor mid-march', () => {
    const a = arena(0);
    a.boss.starwakeTimer = DT;
    a.boss.warpathPhase = 'focus';
    a.boss.warpathTimer = starwakeTotal(def()) - 1;
    tick(a, 0.2);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    a.boss.warpathTimer = 30;
    tick(a, DT);
    expect(a.boss.starwakeElapsed).toBeDefined();
    const b = arena(0);
    b.boss.starwakeTimer = DT;
    b.boss.warpathPhase = 'travel';
    tick(b, 1);
    expect(b.boss.starwakeElapsed).toBeUndefined();
  });

  it('a cast in flight still resolves if he sets off mid-way', () => {
    const a = arena(0);
    toTelegraph(a);
    a.boss.warpathPhase = 'travel';
    a.boss.aiState = 'chase';
    const evs = tick(a, def().crawl + def().hold + DT);
    expect(fx(evs, STARWAKE_FISSURE_ABILITY, 'nova').length).toBeGreaterThan(0);
  });

  it('the pull reset drops the cast, its bar and the pools', () => {
    const a = arena(0);
    toTelegraph(a);
    tick(a, def().crawl + def().hold);
    forceBossStarwake(a.ctx, a.boss);
    expect(starwakePoolsOf(a.boss).length).toBeGreaterThan(0);
    resetBossStarwake(a.boss);
    expect(a.boss.starwakeElapsed).toBeUndefined();
    expect(a.boss.starwakePools).toBeUndefined();
    expect(a.boss.castingAbility).toBeNull();
    expect(a.boss.starwakeTimer).toBe(def().every);
  });

  it('is inert for any other mob: no fields, no draws', () => {
    const a = arena(0);
    const id = (
      a.sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('muster_footman', a.boss.pos.x + 5, a.boss.pos.z);
    const other = a.sim.entities.get(id);
    if (!other) throw new Error('no mob');
    const before = a.ctx.rng.next.bind(a.ctx.rng);
    let draws = 0;
    a.ctx.rng.next = () => {
      draws++;
      return before();
    };
    tickBossStarwake(a.ctx, other);
    expect(draws).toBe(0);
    expect(other.starwakeTimer).toBeUndefined();
    expect(forceBossStarwake(a.ctx, other)).toBe(false);
  });
});

describe('determinism', () => {
  it('lays the same pattern and deals the same damage for the same seed', () => {
    const run = () => {
      const a = arena(4, 11);
      const evs = toTelegraph(a);
      const fissures = [...(a.boss.starwakeFissures ?? [])];
      evs.push(...tick(a, def().crawl + def().hold + 3));
      return {
        fissures,
        dmg: evs.filter((e) => e.type === 'damage').map((e) => (e as { amount: number }).amount),
      };
    };
    const one = run();
    const two = run();
    expect(two).toEqual(one);
    expect(one.fissures.length).toBeGreaterThan(0);
  });

  it('draws exactly 1 + fissures + targeted picks at the telegraph', () => {
    const a = arena(4);
    forceBossStarwake(a.ctx, a.boss);
    tick(a, def().warn - DT);
    // range() and int() each consume exactly one next(), so next() counts every draw.
    let draws = 0;
    const next = a.ctx.rng.next.bind(a.ctx.rng);
    a.ctx.rng.next = () => {
      draws++;
      return next();
    };
    tick(a, DT);
    const count = def().fissures.fanCount;
    expect(starwakeFissuresOf(a.boss)).toHaveLength(count);
    expect(draws).toBe(1 + count + def().geysers.targets);
  });
});
