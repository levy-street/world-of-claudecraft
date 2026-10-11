// Soft separation for engaged mobs (src/sim/mob/mob_separation.ts). The
// owner's playtest (2026-10-04): mobs fighting one target piled up inside one
// another. They may still overlap (up to about half their summed radii), but
// a gentle push now spreads an exact stack into a tight cluster round the
// target, never through a wall, off a ledge, or out of reach.
import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import {
  clampSeparationStep,
  keepTargetDistance,
  SEPARATION_BASE_RADIUS,
  SEPARATION_MAX_RADIUS,
  SEPARATION_MAX_STEP,
  type SeparationBody,
  separateEngagedMob,
  separationMinDistance,
  separationPush,
  separationRadius,
  separationTurn,
} from '../src/sim/mob/mob_separation';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, MELEE_RANGE } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const body = (id: number, x: number, z: number, radius = 0.7): SeparationBody => ({
  id,
  x,
  z,
  radius,
});

describe('mob separation: the pure core', () => {
  it('a body is its authored bodyRadius, else the base body times its scale, capped', () => {
    expect(separationRadius(3, 1.4)).toBe(3);
    expect(separationRadius(undefined, 1)).toBeCloseTo(SEPARATION_BASE_RADIUS, 9);
    expect(separationRadius(undefined, 2)).toBeCloseTo(SEPARATION_BASE_RADIUS * 2, 9);
    expect(separationRadius(40, 1)).toBe(SEPARATION_MAX_RADIUS);
    // A hound is broader than a man at the same scale; an unlisted family is a man.
    expect(separationRadius(undefined, 1, 'beast')).toBeGreaterThan(
      separationRadius(undefined, 1, 'humanoid'),
    );
    expect(separationRadius(undefined, 1, 'undead')).toBeCloseTo(SEPARATION_BASE_RADIUS, 9);
  });

  it('bodies may overlap up to half their summed radii before any push', () => {
    const min = separationMinDistance(0.7, 0.7);
    expect(min).toBeCloseTo(0.7, 9);
    const free = separationPush(body(1, 0, 0), [{ body: body(2, min + 1e-3, 0), yields: true }]);
    expect(free).toEqual({ x: 0, z: 0 });
    const close = separationPush(body(1, 0, 0), [{ body: body(2, min * 0.5, 0), yields: true }]);
    // Pushed straight away from the neighbour (it stands on +x).
    expect(close.x).toBeLessThan(0);
    expect(close.z).toBeCloseTo(0, 9);
  });

  it('an exact stack splits the two bodies in opposite directions, the same way every run', () => {
    const a = separationPush(body(10, 5, 5), [{ body: body(11, 5, 5), yields: true }]);
    const b = separationPush(body(11, 5, 5), [{ body: body(10, 5, 5), yields: true }]);
    expect(Math.hypot(a.x, a.z)).toBeGreaterThan(0);
    expect(a.x).toBeCloseTo(-b.x, 9);
    expect(a.z).toBeCloseTo(-b.z, 9);
    expect(separationPush(body(10, 5, 5), [{ body: body(11, 5, 5), yields: true }])).toEqual(a);
  });

  it('the small body gives way to the big one, and a body that never moves leaves it all to you', () => {
    const smallNearBig = separationPush(body(1, 0, 0, 0.7), [
      { body: body(2, 0.5, 0, 2.5), yields: true },
    ]);
    const bigNearSmall = separationPush(body(2, 0.5, 0, 2.5), [
      { body: body(1, 0, 0, 0.7), yields: true },
    ]);
    expect(Math.abs(smallNearBig.x)).toBeGreaterThan(Math.abs(bigNearSmall.x));
    const yielding = separationPush(body(1, 0, 0), [{ body: body(2, 0.2, 0), yields: true }]);
    const fixed = separationPush(body(1, 0, 0), [{ body: body(2, 0.2, 0), yields: false }]);
    expect(Math.abs(fixed.x)).toBeGreaterThan(Math.abs(yielding.x));
  });

  it('a nudge never exceeds one tick of the soft speed cap', () => {
    const crowd = [1, 2, 3, 4, 5, 6].map((i) => ({ body: body(i + 1, 0, 0, 5), yields: false }));
    const step = separationPush(body(1, 0.01, 0, 5), crowd);
    expect(Math.hypot(step.x, step.z)).toBeLessThanOrEqual(SEPARATION_MAX_STEP + 1e-12);
    const s = { x: 3, z: 4 };
    clampSeparationStep(s, 1);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(1, 9);
  });

  it('the push slides a mob round its target, never out past its fighting range', () => {
    // Target at the origin; the mob stood 3 yd out and was pushed to 4.5.
    const kept = keepTargetDistance(4.5, 0, 0, 0, 3, 4);
    expect(Math.hypot(kept.x, kept.z)).toBeCloseTo(4, 9);
    // Already farther (still closing): it may not drift out any further.
    const far = keepTargetDistance(0, 9, 0, 0, 8, 4);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(8, 9);
    // Inside the limit nothing changes.
    expect(keepTargetDistance(1, 1, 0, 0, 3, 4)).toEqual({ x: 1, z: 1 });
  });
});

interface Bench {
  sim: Sim;
  me: Entity;
  ox: number;
  oz: number;
}

/** A quiet spot on the Sunken Bastion's tidal flats, clear of every pack. */
function bastionBench(seed = 91): Bench {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev bastion enter normal', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no bastion claim');
  const me = sim.player;
  me.maxHp = 1e7;
  me.hp = 1e7;
  const o = instanceOrigin(DUNGEONS.sunken_bastion.index, inst.slot);
  placeAt({ sim, me, ox: o.x, oz: o.z }, me, o.x - 10, o.z - 200);
  sim.drainEvents();
  return { sim, me, ox: o.x, oz: o.z };
}

function placeAt(b: Bench, e: Entity, x: number, z: number): void {
  e.pos = b.sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  b.sim.rebucket(e);
}

/** A mob engaged on the player, spawned at an exact spot. */
function engagedAt(b: Bench, templateId: string, x: number, z: number): Entity {
  const t = MOBS[templateId];
  const mob = createMob(b.sim.ctx.nextId++, t, t.minLevel, b.sim.ctx.groundPos(x, z));
  const inst = claimedInstanceAt(b.sim.ctx, b.me.pos);
  if (inst) {
    applyDungeonMobTuning(mob, inst.dungeonId, inst.difficulty);
    inst.mobIds.push(mob.id);
  }
  b.sim.ctx.addEntity(mob);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = b.me.id;
  mob.threat.set(b.me.id, 100);
  return mob;
}

/** Tick the whole sim, keeping everyone alive and every kit quiet. */
function run(b: Bench, mobs: Entity[], seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    b.me.hp = b.me.maxHp;
    for (const m of mobs) {
      m.hp = m.maxHp;
      m.breathTimer = 999;
      if (m.trashKit) for (const k of Object.keys(m.trashKit.timers)) m.trashKit.timers[k] = 99;
    }
    each?.();
    b.sim.tick();
  }
}

const gap = (a: Entity, c: Entity) => Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z);
const radiusOf = (e: Entity) =>
  separationRadius(MOBS[e.templateId]?.bodyRadius, e.scale, MOBS[e.templateId]?.family);

describe('mob separation in the sim', () => {
  it('two mobs stacked on one target end apart, both still in reach of it', () => {
    const b = bastionBench();
    const x = b.me.pos.x + 3;
    const z = b.me.pos.z;
    const pair = [engagedAt(b, 'bastion_warhound', x, z), engagedAt(b, 'bastion_warhound', x, z)];
    expect(gap(pair[0], pair[1])).toBe(0);
    run(b, pair, 2);
    const min = separationMinDistance(radiusOf(pair[0]), radiusOf(pair[1]));
    // Soft: it stops short of the full allowance once the push is too small
    // to be worth a step (SEPARATION_MIN_STEP).
    expect(gap(pair[0], pair[1])).toBeGreaterThan(min * 0.8);
    for (const m of pair) expect(gap(m, b.me)).toBeLessThanOrEqual(MELEE_RANGE);
  });

  it('five mobs on one target spread into a tight cluster round it, not one blob', () => {
    const b = bastionBench();
    const x = b.me.pos.x + 3.5;
    const z = b.me.pos.z;
    const ids = ['bastion_warhound', 'drowned_watchman', 'bastion_warhound', 'tidebound_acolyte'];
    const pack = [0, 1, 2, 3, 4].map((i) => engagedAt(b, ids[i % ids.length], x, z));
    run(b, pack, 3);
    for (let i = 0; i < pack.length; i++) {
      for (let j = i + 1; j < pack.length; j++) {
        const min = separationMinDistance(radiusOf(pack[i]), radiusOf(pack[j]));
        expect(gap(pack[i], pack[j])).toBeGreaterThan(min * 0.75);
      }
    }
    // Still a cluster: everyone is in melee reach of the target.
    for (const m of pack) expect(gap(m, b.me)).toBeLessThanOrEqual(MELEE_RANGE);
  });

  it('is deterministic: the same pull spreads to the very same spots every run', () => {
    const spread = () => {
      const b = bastionBench();
      const x = b.me.pos.x + 3;
      const z = b.me.pos.z + 1;
      const pack = [0, 1, 2, 3].map(() => engagedAt(b, 'bastion_warhound', x, z));
      run(b, pack, 2);
      return pack.map((m) => [m.pos.x, m.pos.y, m.pos.z]);
    };
    expect(spread()).toEqual(spread());
  });

  it('a boss never moves for its adds, and an add steps out of the boss instead', () => {
    const b = bastionBench();
    // Gorrak: a plain boss with no encounter script. Both stand in reach of
    // the player, so neither one's own AI walks: only the separation could.
    const x = b.me.pos.x + 2.5;
    const z = b.me.pos.z;
    const boss = engagedAt(b, 'gorrak', x, z);
    const add = engagedAt(b, 'bastion_warhound', x, z);
    const bossAt = { ...boss.pos };
    run(b, [boss, add], 2);
    expect(boss.pos.x).toBe(bossAt.x);
    expect(boss.pos.z).toBe(bossAt.z);
    expect(gap(add, boss)).toBeGreaterThan(
      separationMinDistance(radiusOf(add), radiusOf(boss)) * 0.8,
    );
  });

  it('a mob planted for an area cast holds its spot; the one stacked on it steps out', () => {
    const b = bastionBench();
    const x = b.me.pos.x + 3;
    const z = b.me.pos.z;
    const watchman = engagedAt(b, 'drowned_watchman', x, z);
    const hound = engagedAt(b, 'bastion_warhound', x, z);
    b.sim.tick();
    watchman.breathTimer = 0;
    for (let i = 0; i < 10 && watchman.castingAbility === null; i++) b.sim.tick();
    expect(watchman.castingAbility).not.toBeNull();
    const drawn = { ...watchman.pos };
    let ticks = 0;
    while (watchman.castingAbility !== null && ticks < 60) {
      b.me.hp = b.me.maxHp;
      b.sim.tick();
      ticks++;
      expect(Math.hypot(watchman.pos.x - drawn.x, watchman.pos.z - drawn.z)).toBeLessThan(0.01);
    }
    expect(gap(hound, watchman)).toBeGreaterThan(0.3);
  });

  it('a crowd too big to spread settles instead of jittering for the whole fight', () => {
    const b = bastionBench();
    const x = b.me.pos.x + 2;
    const z = b.me.pos.z;
    const crowd = Array.from({ length: 14 }, () => engagedAt(b, 'bastion_warhound', x, z));
    const movedPerSecond: number[] = [];
    for (let s = 0; s < 8; s++) {
      let moved = 0;
      run(b, crowd, 0.05);
      for (let t = 1; t < 20; t++) {
        const before = crowd.map((m) => ({ x: m.pos.x, z: m.pos.z }));
        run(b, crowd, 0.05);
        crowd.forEach((m, i) => {
          if (m.pos.x !== before[i].x || m.pos.z !== before[i].z) moved++;
        });
      }
      movedPerSecond.push(moved);
    }
    // The first second spreads the stack; by the end the bodies hold still.
    expect(movedPerSecond[0]).toBeGreaterThan(10);
    expect(movedPerSecond[7]).toBeLessThan(movedPerSecond[0] / 4);
  });

  it('never pushes the player it fights', () => {
    const b = bastionBench();
    const at = { ...b.me.pos };
    const pack = [0, 1, 2].map(() => engagedAt(b, 'bastion_warhound', at.x, at.z));
    run(b, pack, 1);
    expect(b.me.pos.x).toBe(at.x);
    expect(b.me.pos.z).toBe(at.z);
  });

  it('never carries a mob into a wall or off a ledge', () => {
    // Walk out from the bench in each direction to the first place the floor
    // drops more than a yard or a collider bites: the edge of the flats.
    const b = bastionBench();
    const seed = b.sim.cfg.seed;
    const home = { ...b.me.pos };
    let checked = 0;
    for (const [ux, uz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let edge: { x: number; z: number } | null = null;
      for (let s = 0.25; s < 120; s += 0.25) {
        const x = home.x + ux * s;
        const z = home.z + uz * s;
        const dropped = Math.abs(groundHeight(x, z, seed) - groundHeight(home.x, home.z, seed)) > 1;
        const r = b.sim.ctx.resolveMovePoint(x, z, 0.5, b.me);
        if (dropped || Math.hypot(r.x - x, r.z - z) > 1e-3) {
          edge = { x: home.x + ux * (s - 0.75), z: home.z + uz * (s - 0.75) };
          break;
        }
      }
      if (!edge) continue;
      checked++;
      const sub = bastionBench();
      const floor = groundHeight(edge.x, edge.z, seed);
      // The target stands just inside the edge, the pack stacked on it.
      placeAt(sub, sub.me, edge.x - ux * 1, edge.z - uz * 1);
      const pack = [0, 1, 2, 3, 4].map(() => engagedAt(sub, 'bastion_warhound', edge.x, edge.z));
      run(sub, pack, 2, () => placeAt(sub, sub.me, edge.x - ux * 1, edge.z - uz * 1));
      for (const m of pack) {
        // On the same floor it started on (no drop off the edge)...
        expect(Math.abs(groundHeight(m.pos.x, m.pos.z, seed) - floor)).toBeLessThan(1);
        // ...and outside every collider.
        const r = sub.sim.ctx.resolveMovePoint(m.pos.x, m.pos.z, 0.5, m);
        expect(Math.hypot(r.x - m.pos.x, r.z - m.pos.z)).toBeLessThan(1e-3);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  /** Tick until it is `mob`'s separation turn, then stack it on `on`. */
  function onItsTurn(b: Bench, mob: Entity, on: Entity): void {
    for (let i = 0; i < 8 && !separationTurn(mob.id, b.sim.ctx.tickCount); i++) b.sim.tick();
    expect(separationTurn(mob.id, b.sim.ctx.tickCount)).toBe(true);
    mob.pos = { ...on.pos };
    mob.prevPos = { ...mob.pos };
  }

  it('draws no rng: a nudge is a pure function of positions, radii and ids', () => {
    const b = bastionBench();
    const x = b.me.pos.x + 3;
    const z = b.me.pos.z;
    const a = engagedAt(b, 'bastion_warhound', x, z);
    const c = engagedAt(b, 'bastion_warhound', x, z);
    onItsTurn(b, a, c);
    let draws = 0;
    b.sim.rng.setObserver(() => {
      draws++;
    });
    const before = { ...a.pos };
    separateEngagedMob(b.sim.ctx, a);
    b.sim.rng.setObserver(null);
    expect(Math.hypot(a.pos.x - before.x, a.pos.z - before.z)).toBeGreaterThan(0);
    expect(draws).toBe(0);
  });

  it('never moves a pet, a rooted mob, a fleeing one, or one in the air', () => {
    const cases: [string, (m: Entity, b: Bench) => void][] = [
      [
        'pet',
        (m, b) => {
          m.ownerId = b.me.id;
        },
      ],
      [
        'rooted',
        (m) => {
          m.auras.push({
            id: 'test_root',
            name: 'Test Root',
            kind: 'root',
            remaining: 10,
            duration: 10,
            value: 0,
            sourceId: 0,
            school: 'nature',
          } as Entity['auras'][number]);
        },
      ],
      [
        'fleeing',
        (m) => {
          m.aiState = 'flee';
        },
      ],
      [
        'airborne',
        (m) => {
          m.pos.y += 3;
        },
      ],
    ];
    for (const [name, setUp] of cases) {
      const b = bastionBench();
      const x = b.me.pos.x + 3;
      const z = b.me.pos.z;
      const m = engagedAt(b, 'bastion_warhound', x, z);
      const other = engagedAt(b, 'bastion_warhound', x, z);
      onItsTurn(b, m, other);
      setUp(m, b);
      const before = { ...m.pos };
      separateEngagedMob(b.sim.ctx, m);
      expect({ name, pos: m.pos }).toEqual({ name, pos: before });
    }
  });
});
