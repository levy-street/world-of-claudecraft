// Balgath's ranged-punish kit (src/sim/mob/boss_ranged_mechanics.ts): Boulder Toss,
// Foreman's Glare and the Barrow Burden shared soak.
//
// NO GODMODE here, for the reason tests/boss_slams.test.ts spells out: dealDamage returns
// silently for a `gm` target, so a godded subject makes every "was not hit" assertion pass
// for the wrong reason. Subjects are mortal and topped up where they must survive.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The live-fight suites tick a real Sim for minutes of fight time: well past the shared
// default under CI shard contention.
vi.setConfig({ testTimeout: 180_000 });

import {
  farCandidates,
  farthestCandidates,
  glareLineLength,
  insideGlare,
} from '../src/sim/boss_ranged_geometry';
import { lineOfSightClear } from '../src/sim/colliders';
import { MOBS } from '../src/sim/data';
import {
  BOULDER_ABILITY,
  BURDEN_ABILITY,
  BURDEN_AURA_ID,
  GLARE_ABILITY,
  glareReach,
  rangedMechanicBlocked,
  resetBossRangedMechanics,
  tickBossRangedMechanics,
} from '../src/sim/mob/boss_ranged_mechanics';
import { musterCampPlan } from '../src/sim/muster_camp_plan';
import { playersInsideSoak, sharedSoakFraction } from '../src/sim/shared_soak';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';

const kit = () => {
  const d = MOBS[BALGATH]?.rangedMechanics;
  if (!d) throw new Error('balgath_cyclops declares no rangedMechanics');
  return d;
};

function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
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
  resetBossRangedMechanics(ctx, boss);
  sim.drainEvents();
  return { sim, ctx, boss, players };
}

/** Park every other mechanic far in the future so only `kind` can come due. */
function only(a: Arena, kind: 'boulder' | 'glare' | 'burden'): void {
  a.boss.boulderTimer = kind === 'boulder' ? DT : 999;
  a.boss.glareTimer = kind === 'glare' ? DT : 999;
  a.boss.burdenTimer = kind === 'burden' ? DT : 999;
  a.boss.mechanicLockTimer = 0;
}

function tick(a: Arena, n = 1): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    tickBossRangedMechanics(a.ctx, a.boss);
    out.push(...a.sim.drainEvents());
  }
  return out;
}

function topUp(a: Arena): void {
  for (const p of a.players) p.hp = p.maxHp;
}

const byAbility = (events: SimEvent[], ability: string, fx: string) =>
  events.filter(
    (e) =>
      e.type === 'spellfxAt' &&
      (e as { ability?: string }).ability === ability &&
      (e as { fx: string }).fx === fx,
  ) as Extract<SimEvent, { type: 'spellfxAt' }>[];

const damageTo = (events: SimEvent[], id: number, name: string) =>
  events.filter(
    (e) =>
      e.type === 'damage' &&
      (e as { targetId: number }).targetId === id &&
      (e as { ability?: string }).ability === name,
  );

describe('ranged kit tuning', () => {
  it('declares three mechanics with readable wind-ups and melee-proof minimum ranges', () => {
    const k = kit();
    expect(k.boulder.windup).toBeGreaterThanOrEqual(1.8);
    expect(k.boulder.windup).toBeLessThanOrEqual(2.6);
    expect(k.glare.windup).toBeGreaterThanOrEqual(2);
    expect(k.burden.windup).toBeGreaterThanOrEqual(4);
    // Past the cleave's reach, so a melee player hugging him is never the pick.
    const cleave = MOBS[BALGATH]?.slams?.cleave.range ?? 20;
    expect(k.boulder.minRange).toBeGreaterThanOrEqual(cleave - 2);
    expect(k.glare.minRange).toBeGreaterThanOrEqual(cleave - 2);
    expect(k.boulder.count).toBe(2);
  });

  it('keeps every circle escapable inside its own wind-up at a walk', () => {
    // A player at the centre must be able to leave the circle before it lands.
    const k = kit();
    const run = 7;
    expect(k.boulder.radius / run).toBeLessThan(k.boulder.windup * 0.6);
    expect(k.glare.halfWidth / run).toBeLessThan(k.glare.windup * 0.5);
  });

  it('prices the boulder and glare beside his other aimed blows', () => {
    const k = kit();
    const hammer = MOBS[BALGATH]?.slams?.hammer;
    const cleave = MOBS[BALGATH]?.slams?.cleave;
    if (!hammer || !cleave) throw new Error('no slams');
    for (const m of [k.boulder, k.glare]) {
      expect(m.min).toBeGreaterThanOrEqual(hammer.min * 0.8);
      expect(m.max).toBeLessThanOrEqual(cleave.max);
    }
  });

  it('names every mechanic in English, distinct from each other', () => {
    const k = kit();
    const names = [k.boulder.name, k.glare.name, k.burden.name];
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(['Boulder Toss', 'Foreman’s Glare', 'Barrow Burden']);
  });
});

describe('boulder targeting (pure)', () => {
  const at = (id: number, x: number, dead = false) => ({ id, dead, pos: { x, z: 0 } });
  it('picks the two farthest past the minimum range, farthest first, ties by id', () => {
    const cands = [at(1, 5), at(2, 30), at(3, 50), at(4, 30), at(5, 70), at(6, 45, true)];
    const picked = farthestCandidates(cands, { x: 0, z: 0 }, 18, 60, 2).map((c) => c.id);
    expect(picked).toEqual([3, 2]);
  });
  it('ignores anyone inside the minimum range, even if nobody else is there', () => {
    expect(farthestCandidates([at(1, 5), at(2, 17.9)], { x: 0, z: 0 }, 18, 60, 2)).toEqual([]);
  });
  it('returns one when only one stands far out', () => {
    const picked = farCandidates([at(1, 5), at(2, 25)], { x: 0, z: 0 }, 18, 60);
    expect(picked.map((c) => c.id)).toEqual([2]);
  });
});

describe('glare line geometry (pure)', () => {
  const line = { originX: 0, originZ: 0, dirX: 0, dirZ: 1, length: 40, halfWidth: 2.5 };
  it('is a rectangle from his feet out along the line', () => {
    expect(insideGlare(line, 0, 10)).toBe(true);
    expect(insideGlare(line, 2.4, 39)).toBe(true);
    expect(insideGlare(line, 2.6, 10)).toBe(false);
    expect(insideGlare(line, 0, 40.5)).toBe(false);
    expect(insideGlare(line, 0, -1), 'never behind him').toBe(false);
  });
  it('is cut short where the beam was stopped', () => {
    expect(insideGlare(line, 0, 20, 15)).toBe(false);
    expect(insideGlare(line, 0, 14, 15)).toBe(true);
  });
  it('runs past the target by the overshoot, clamped', () => {
    expect(glareLineLength(30, 12, 30, 70)).toBe(42);
    expect(glareLineLength(10, 12, 30, 70)).toBe(30);
    expect(glareLineLength(65, 12, 30, 70)).toBe(70);
  });
});

describe('shared soak split (pure)', () => {
  it('splits the total evenly by the soaker count', () => {
    expect(sharedSoakFraction(1.1, 1)).toBeCloseTo(1.1);
    expect(sharedSoakFraction(1.1, 5)).toBeCloseTo(0.22);
    expect(sharedSoakFraction(1.1, 0)).toBeCloseTo(1.1);
  });
  it('counts only the living inside the circle', () => {
    const p = (id: number, x: number, dead = false) => ({ id, dead, pos: { x, z: 0 } });
    const inside = playersInsideSoak(
      [p(1, 0), p(2, 5.9), p(3, 6.1), p(4, 1, true)],
      { x: 0, z: 0 },
      6,
    );
    expect(inside.map((e) => e.id)).toEqual([1, 2]);
  });
});

describe('Boulder Toss', () => {
  let a: Arena;
  beforeEach(() => {
    a = arena(3);
  });

  it('marks the two farthest players past the minimum distance and lands after the wind-up', () => {
    const L = lair();
    const [tank, near, far1, far2] = a.players;
    place(a.sim, tank, L.x + 3, L.z);
    place(a.sim, near, L.x + 10, L.z);
    place(a.sim, far1, L.x, L.z + 30);
    place(a.sim, far2, L.x - 40, L.z);
    only(a, 'boulder');
    const start = tick(a);
    const marks = byAbility(start, BOULDER_ABILITY, 'runeCircle');
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.targetId).sort()).toEqual([far1.id, far2.id].sort());
    for (const m of marks) {
      expect(m.radius).toBe(kit().boulder.radius);
      expect(m.duration).toBe(kit().boulder.windup);
    }
    // The boss animates the rip-and-heave off the same cue id.
    expect(
      start.some(
        (e) =>
          e.type === 'spellfx' &&
          (e as { fx: string }).fx === 'windup' &&
          (e as { ability?: string }).ability === BOULDER_ABILITY,
      ),
    ).toBe(true);
    // Nothing lands early.
    const ticks = Math.round(kit().boulder.windup / DT);
    const mid = tick(a, ticks - 2);
    expect(byAbility(mid, BOULDER_ABILITY, 'nova')).toHaveLength(0);
    const land = tick(a, 2);
    expect(byAbility(land, BOULDER_ABILITY, 'nova')).toHaveLength(2);
  });

  it('hits only whoever is still inside a circle, and the snapshot does not follow them', () => {
    const L = lair();
    const [tank, stayer, mover] = a.players;
    place(a.sim, tank, L.x + 3, L.z);
    place(a.sim, stayer, L.x, L.z + 30);
    place(a.sim, mover, L.x - 40, L.z);
    a.players[3].dead = true;
    only(a, 'boulder');
    tick(a);
    // The mover steps six yards aside; the stayer keeps casting.
    place(a.sim, mover, L.x - 40, L.z + 6);
    topUp(a);
    const events = tick(a, Math.round(kit().boulder.windup / DT) + 1);
    expect(damageTo(events, stayer.id, 'Boulder Toss')).toHaveLength(1);
    expect(damageTo(events, mover.id, 'Boulder Toss')).toHaveLength(0);
    expect(damageTo(events, tank.id, 'Boulder Toss')).toHaveLength(0);
  });

  it('does not start at all while everyone is in melee', () => {
    only(a, 'boulder');
    const events = tick(a, 3);
    expect(byAbility(events, BOULDER_ABILITY, 'runeCircle')).toHaveLength(0);
    // Held at due, but not competing for the lock: the rest of his kit runs untouched.
    expect(a.boss.boulderTimer ?? 0).toBeLessThanOrEqual(0);
    expect(a.boss.rangedReadyOverdue).toBeUndefined();
    // The moment someone steps far out, it is the oldest thing waiting and goes next.
    place(a.sim, a.players[1], lair().x, lair().z + 30);
    expect(byAbility(tick(a), BOULDER_ABILITY, 'runeCircle')).toHaveLength(1);
  });

  it('crushes a muster soldier standing in the circle', () => {
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 30);
    const soldierId = (
      a.sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('muster_footman', L.x + 1, L.z + 31);
    const soldier = a.sim.entities.get(soldierId);
    if (!soldier) throw new Error('no soldier');
    place(a.sim, soldier, L.x + 1, L.z + 31);
    only(a, 'boulder');
    tick(a, Math.round(kit().boulder.windup / DT) + 2);
    expect(soldier.dead).toBe(true);
  });

  it('draws no rng to pick its targets', () => {
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 30);
    only(a, 'boulder');
    const rng = (a.sim as unknown as { rng: object }).rng;
    const before = JSON.stringify(rng);
    tick(a);
    expect(a.boss.rangedKind).toBe('boulder');
    expect(JSON.stringify(rng)).toBe(before);
  });
});

describe("Foreman's Glare", () => {
  let a: Arena;
  beforeEach(() => {
    a = arena(2);
  });

  it('draws a line through a far player and beams everyone in it after the wind-up', () => {
    const L = lair();
    const [tank, inLine, beside] = a.players;
    place(a.sim, tank, L.x + 3, L.z + 0.5);
    place(a.sim, inLine, L.x, L.z + 25);
    place(a.sim, beside, L.x + 8, L.z + 25);
    only(a, 'glare');
    const start = tick(a);
    const marks = byAbility(start, GLARE_ABILITY, 'runeCircle');
    expect(marks).toHaveLength(1);
    const m = marks[0];
    expect(m.targetId).toBe(inLine.id);
    expect(m.dirX ?? 0).toBeCloseTo(0, 3);
    expect(m.dirZ ?? 0).toBeCloseTo(1, 3);
    expect(m.radius).toBeCloseTo(glareLineLength(25, 12, 30, 70));
    expect(m.duration).toBe(kit().glare.windup);
    topUp(a);
    const events = tick(a, Math.round(kit().glare.windup / DT) + 1);
    expect(byAbility(events, GLARE_ABILITY, 'nova')).toHaveLength(1);
    expect(damageTo(events, inLine.id, 'Foreman’s Glare')).toHaveLength(1);
    expect(damageTo(events, beside.id, 'Foreman’s Glare')).toHaveLength(0);
    expect(damageTo(events, tank.id, 'Foreman’s Glare'), 'the tank is off the line').toHaveLength(
      0,
    );
  });

  it('spares a player who stepped out of the line during the wind-up', () => {
    const L = lair();
    const [, target] = a.players;
    place(a.sim, target, L.x, L.z + 25);
    a.players[2].dead = true;
    only(a, 'glare');
    tick(a);
    place(a.sim, target, L.x + 4, L.z + 25);
    const events = tick(a, Math.round(kit().glare.windup / DT) + 1);
    expect(damageTo(events, target.id, 'Foreman’s Glare')).toHaveLength(0);
  });

  it('is stopped by a muster barricade, and a player behind it is untouched', () => {
    // A real barricade from the shipped camp plan, with the eye in front of it and one
    // player hiding behind it on the same line.
    const seed = 7;
    const barricade = musterCampPlan(seed).find(
      (p) => p.key === 'musterBarricade' && p.tierClass === 'structure',
    );
    if (!barricade) throw new Error('no barricade in the muster plan');
    const nx = Math.sin(barricade.rot);
    const nz = Math.cos(barricade.rot);
    // Behind the stakes (the box sits 0.25 yd behind the origin) and in front of them.
    const hide = { x: barricade.x - nx * 3, z: barricade.z - nz * 3 };
    const eye = { x: barricade.x + nx * 18, z: barricade.z + nz * 18 };
    const exposed = { x: barricade.x + nx * 6, z: barricade.z + nz * 6 };
    expect(lineOfSightClear(seed, eye, hide), 'the barricade must cross the sight line').toBe(
      false,
    );
    expect(lineOfSightClear(seed, eye, exposed)).toBe(true);

    const b = arena(2, seed, eye);
    const [tank, hider, front] = b.players;
    place(b.sim, tank, eye.x - nx * 3, eye.z - nz * 3 + 0.01);
    place(b.sim, hider, hide.x, hide.z);
    place(b.sim, front, exposed.x, exposed.z);
    // Point the line straight at the hider by making them the only far player.
    b.boss.glareTimer = DT;
    b.boss.boulderTimer = 999;
    b.boss.burdenTimer = 999;
    b.boss.mechanicLockTimer = 0;
    // The front player stands 12 yards out: inside the minimum, so the pick is the hider.
    const start = tick(b);
    const mark = byAbility(start, GLARE_ABILITY, 'runeCircle')[0];
    expect(mark?.targetId).toBe(hider.id);
    for (const p of b.players) p.hp = p.maxHp;
    const events = tick(b, Math.round(kit().glare.windup / DT) + 1);
    const fired = byAbility(events, GLARE_ABILITY, 'nova')[0];
    // The beam's travelled length stops at the barricade, short of the hider.
    expect(fired.radius ?? 99).toBeLessThan(18 + 1);
    expect(fired.radius ?? 0).toBeGreaterThan(12);
    expect(damageTo(events, hider.id, 'Foreman’s Glare')).toHaveLength(0);
    expect(damageTo(events, front.id, 'Foreman’s Glare')).toHaveLength(1);
  });

  it('leaves a muster soldier in the line unharmed (the eye burns players only)', () => {
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 25);
    a.players[2].dead = true;
    const soldierId = (
      a.sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('muster_footman', L.x, L.z + 15);
    const soldier = a.sim.entities.get(soldierId);
    if (!soldier) throw new Error('no soldier');
    place(a.sim, soldier, L.x, L.z + 15);
    const hp = soldier.hp;
    only(a, 'glare');
    tick(a, Math.round(kit().glare.windup / DT) + 2);
    expect(soldier.dead).toBe(false);
    expect(soldier.hp).toBe(hp);
  });

  it('marches the full length when nothing is in the way', () => {
    const line = { originX: 0, originZ: -500, dirX: 1, dirZ: 0, length: 40, halfWidth: 2.5 };
    const clear = lineOfSightClear(7, { x: 0, z: -500 }, { x: 40, z: -500 });
    if (clear) expect(glareReach(7, line)).toBe(40);
  });

  it('draws exactly one rng value to choose among the far players', () => {
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 25);
    place(a.sim, a.players[2], L.x - 25, L.z);
    only(a, 'glare');
    const rng = (
      a.sim as unknown as { rng: { setObserver(f: ((v: number) => void) | null): void } }
    ).rng;
    let draws = 0;
    rng.setObserver(() => draws++);
    tick(a);
    rng.setObserver(null);
    expect(a.boss.rangedKind).toBe('glare');
    expect(draws).toBe(1);
  });
});

describe('Barrow Burden (shared soak)', () => {
  it('marks a non-tank player with the soak aura for the whole wind-up', () => {
    const a = arena(2);
    only(a, 'burden');
    tick(a);
    const marked = a.players.filter((p) => p.auras.some((x) => x.id === BURDEN_AURA_ID));
    expect(marked).toHaveLength(1);
    expect(marked[0].id).not.toBe(a.sim.player.id);
    const aura = marked[0].auras.find((x) => x.id === BURDEN_AURA_ID);
    expect(aura?.remaining).toBeGreaterThan(kit().burden.windup);
    expect(aura?.remaining).toBeLessThan(kit().burden.windup + 0.5);
    expect(aura?.stacks).toBe(kit().burden.recommended);
    expect(aura?.value2).toBe(kit().burden.totalFraction);
  });

  it('is never laid on a lone player: a shared soak needs someone to share it', () => {
    const a = arena(0);
    only(a, 'burden');
    tick(a, 5);
    expect(a.sim.player.auras.some((x) => x.id === BURDEN_AURA_ID)).toBe(false);
    expect(a.boss.rangedKind).toBeUndefined();
  });

  const soak = (inside: number) => {
    const a = arena(5);
    const L = lair();
    only(a, 'burden');
    tick(a);
    const carrier = a.players.find((p) => p.auras.some((x) => x.id === BURDEN_AURA_ID));
    if (!carrier) throw new Error('nobody marked');
    // Move the carrier out on their own, then bring `inside - 1` others to them.
    place(a.sim, carrier, L.x + 30, L.z);
    let brought = 0;
    for (const p of a.players) {
      if (p === carrier) continue;
      if (brought < inside - 1) {
        place(a.sim, p, L.x + 30 + (brought % 2 ? 1.5 : -1.5), L.z + 1);
        brought++;
      } else {
        place(a.sim, p, L.x - 20, L.z);
      }
    }
    topUp(a);
    const hpBefore = new Map(a.players.map((p) => [p.id, p.hp]));
    tick(a, Math.round(kit().burden.windup / DT) + 1);
    return { a, carrier, hpBefore };
  };

  it('is lethal to a lone carrier', () => {
    const { carrier } = soak(1);
    expect(carrier.dead || carrier.hp <= 0).toBe(true);
  });

  it('is split five ways when five stand in it', () => {
    const { a, carrier, hpBefore } = soak(5);
    const share = sharedSoakFraction(kit().burden.totalFraction, 5);
    let hit = 0;
    for (const p of a.players) {
      const lost = (hpBefore.get(p.id) ?? 0) - p.hp;
      const inside = Math.hypot(p.pos.x - carrier.pos.x, p.pos.z - carrier.pos.z) <= 6;
      if (inside) {
        hit++;
        expect(p.dead).toBe(false);
        expect(lost).toBeGreaterThan(0);
        expect(lost).toBeLessThanOrEqual(Math.ceil(p.maxHp * share) + 1);
      } else {
        expect(lost).toBe(0);
      }
    }
    expect(hit).toBe(5);
    expect(
      carrier.auras.some((x) => x.id === BURDEN_AURA_ID),
      'the mark is spent',
    ).toBe(false);
  });

  it('lands its impact cue on the carrier', () => {
    const a = arena(1);
    only(a, 'burden');
    const events = tick(a, Math.round(kit().burden.windup / DT) + 2);
    const nova = byAbility(events, BURDEN_ABILITY, 'nova');
    expect(nova).toHaveLength(1);
    expect(nova[0].radius).toBe(kit().burden.radius);
  });

  it('lands nothing if the mark is gone before the wind-up ends (no warning, no hit)', () => {
    const a = arena(2);
    only(a, 'burden');
    tick(a);
    const carrier = a.players.find((p) => p.auras.some((x) => x.id === BURDEN_AURA_ID));
    if (!carrier) throw new Error('nobody marked');
    carrier.auras = carrier.auras.filter((x) => x.id !== BURDEN_AURA_ID);
    topUp(a);
    const events = tick(a, Math.round(kit().burden.windup / DT) + 2);
    expect(damageTo(events, carrier.id, 'Barrow Burden')).toHaveLength(0);
    expect(carrier.hp).toBe(carrier.maxHp);
  });

  it('lifts the mark when the pull resets, so no ring lingers that will never land', () => {
    const a = arena(2);
    only(a, 'burden');
    tick(a);
    resetBossRangedMechanics(a.ctx, a.boss);
    expect(a.players.some((p) => p.auras.some((x) => x.id === BURDEN_AURA_ID))).toBe(false);
    expect(a.boss.rangedWindup).toBe(0);
  });
});

describe('coordination', () => {
  it('never starts while another telegraph is winding or the spacing lock runs', () => {
    const a = arena(2);
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 30);
    only(a, 'boulder');
    a.boss.slamWindup = 1;
    expect(rangedMechanicBlocked(a.boss)).toBe(true);
    expect(byAbility(tick(a), BOULDER_ABILITY, 'runeCircle')).toHaveLength(0);
    a.boss.slamWindup = 0;
    a.boss.mechanicLockTimer = 2;
    expect(byAbility(tick(a), BOULDER_ABILITY, 'runeCircle')).toHaveLength(0);
    a.boss.mechanicLockTimer = 0;
    a.boss.castingAbility = 'balgath_scry';
    expect(byAbility(tick(a), BOULDER_ABILITY, 'runeCircle')).toHaveLength(0);
    a.boss.castingAbility = null;
    expect(byAbility(tick(a), BOULDER_ABILITY, 'runeCircle')).toHaveLength(1);
  });

  it('claims the spacing lock through its wind-up, so nothing else can start on top', () => {
    const a = arena(1);
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 30);
    only(a, 'boulder');
    tick(a);
    expect(a.boss.mechanicLockTimer ?? 0).toBeGreaterThan(kit().boulder.windup);
  });

  it('fires the most overdue first when two come due together', () => {
    const a = arena(1);
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 30);
    a.boss.mechanicLockTimer = 0;
    a.boss.boulderTimer = -1;
    a.boss.glareTimer = -3;
    a.boss.burdenTimer = 999;
    tick(a);
    expect(a.boss.rangedKind).toBe('glare');
    expect(a.boss.boulderTimer ?? 0).toBeLessThan(0);
  });

  it('holds while he runs a warpath leg', () => {
    const a = arena(1);
    const L = lair();
    place(a.sim, a.players[1], L.x, L.z + 30);
    only(a, 'boulder');
    a.boss.warpathPhase = 'travel';
    tick(a, 5);
    expect(a.boss.rangedKind).toBeUndefined();
  });
});

describe('a live fight', () => {
  /**
   * The real sim loop, boss engaged and marching his circuit, a tank on him and three
   * casters parked 30 yards out, everyone kept alive. Every tick: at most ONE wind-up of
   * any kind is live, which is the coordination promise the whole kit is built on.
   */
  function run(seed: number, seconds: number) {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const L = lair();
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, L.x, L.z);
    const boss = sim.entities.get(id);
    if (!boss) throw new Error('no boss');
    const players = [sim.player];
    for (let i = 0; i < 3; i++) {
      const pid = sim.addPlayer('mage', `Caster${i}`);
      sim.setPlayerLevel(20, pid);
      const p = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
      if (p) players.push(p);
    }
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const counts = new Map<string, number>();
    let overlap = 0;
    const trace: string[] = [];
    sim.drainEvents();
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      const ang = [0, 1.2, 2.4, 3.6];
      // The raid plays it right: the tank holds him, the casters stand 30 yards out, and
      // when the burden goes down every caster stacks on its carrier.
      const carrier = players.find((q) => q.auras.some((x) => x.id === BURDEN_AURA_ID));
      players.forEach((p, k) => {
        if (carrier && k > 0 && carrier !== p) place(sim, p, carrier.pos.x + 1, carrier.pos.z);
        else {
          const r = k === 0 ? 4 : 30;
          place(sim, p, boss.pos.x + Math.sin(ang[k]) * r, boss.pos.z + Math.cos(ang[k]) * r);
        }
        p.hp = p.maxHp;
      });
      // Somebody keeps hitting him, or his 30-second give-up rule ends the pull.
      if (i % 20 === 0) ctx.dealDamage(sim.player, boss, 5, false, 'physical', null, 'hit');
      if (!boss.inCombat) {
        boss.inCombat = true;
        boss.aiState = 'attack';
        boss.aggroTargetId = sim.player.id;
      }
      const tickEvents = sim.tick();
      const live =
        ((boss.slamWindup ?? 0) > 0 ? 1 : 0) +
        ((boss.rangedWindup ?? 0) > 0 ? 1 : 0) +
        ((boss.stompWindupRemaining ?? 0) > 0 ? 1 : 0) +
        ((boss.pulseWindupRemaining ?? 0) > 0 ? 1 : 0) +
        (boss.castingAbility ? 1 : 0);
      if (live > 1) overlap++;
      for (const e of tickEvents) {
        if (e.type !== 'spellfxAt' && e.type !== 'spellfx') continue;
        const ab = (e as { ability?: string }).ability ?? '';
        const fx = (e as { fx: string }).fx;
        if (fx === 'runeCircle' || fx === 'windup') {
          const key = `${ab}:${fx}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        if (
          ab.startsWith('mob_balgath_boulder') ||
          ab.startsWith('mob_balgath_glare') ||
          ab.startsWith('mob_balgath_burden')
        ) {
          trace.push(`${i}:${ab}:${fx}:${(e as { x?: number }).x?.toFixed(2) ?? ''}`);
        }
      }
    }
    const dead = players.filter((p) => p.dead).length;
    return { counts, overlap, trace, dead };
  }

  it('never has two wind-ups live at once, and all three ranged mechanics come up', () => {
    const { counts, overlap, dead } = run(7, 170);
    expect(dead, 'a raid that plays it right survives').toBe(0);
    expect(overlap).toBe(0);
    expect(counts.get(`${BOULDER_ABILITY}:windup`) ?? 0).toBeGreaterThanOrEqual(2);
    expect(counts.get(`${GLARE_ABILITY}:windup`) ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get(`${BURDEN_ABILITY}:windup`) ?? 0).toBeGreaterThanOrEqual(1);
    // The slams still come up: the kit shares the lock, it does not starve them.
    expect(counts.get('mob_balgath_hammer:windup') ?? 0).toBeGreaterThanOrEqual(2);
    expect(counts.get('mob_balgath_cleave:windup') ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic: the same seed replays the same ranged trace', () => {
    const one = run(11, 70).trace;
    const two = run(11, 70).trace;
    expect(one.length).toBeGreaterThan(0);
    expect(two).toEqual(one);
  });
});
