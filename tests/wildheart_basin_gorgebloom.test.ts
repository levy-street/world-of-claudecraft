// The Gorgebloom at the foot of the Weeping Falls (docs/design/dungeon-rework/
// wildheart_basin.md section 5.2, src/sim/encounters/wildheart_basin/
// gorgebloom.ts): Seed Rain on the loam beds, the clean stomp, the
// pollinated touch, the sprout clock (heroic Burrowing Seeds), Pollinate and
// heroic Pollen Cloud, Vine Lash, Gorge and Digesting, the Bloom Spit at a
// target out of its reach, the deed, and the reset. On a real claimed Basin
// with a real party (tests/helpers/wildheart_fight.ts).

import { describe, expect, it } from 'vitest';
import { GORGEBLOOM_LOAM_BEDS } from '../src/sim/content/wildheart_basin_layout';
import {
  BLOOM_DIGESTING,
  BLOOM_GORGE,
  BLOOM_POLLINATED,
  BLOOM_SEED_RAIN,
  BLOOM_SEED_STOMP,
  BLOOM_VINE_LASH,
  BLOOM_VINE_LASHED,
  GORGEBLOOM_DEED,
  GORGEBLOOM_ID,
  podSpot,
  BLOOM_TUNING as T,
  THORN_SPROUT_ID,
  WILDHEART_SEEDPOD,
  WILDHEART_SEEDPOD_RIPE,
} from '../src/sim/encounters/wildheart_basin';
import type { Entity } from '../src/sim/types';
import {
  aura,
  boss,
  earned,
  engage,
  type Fight,
  fight,
  hitsOn,
  live,
  local,
  objects,
  put,
  run,
  tick,
} from './helpers/wildheart_fight';

/** The tank at the bloom's petals, the others spread clear of every bed. */
function pull(f: Fight, pool = 1e6): Entity {
  const bloom = boss(f, GORGEBLOOM_ID);
  put(f, f.tank, 90, 40);
  const spots: [number, number][] = [
    [100, 30],
    [102, 58],
    [62, 36],
  ];
  f.others.forEach((p, i) => {
    put(f, p, spots[i][0], spots[i][1]);
  });
  engage(f, bloom, pool);
  return bloom;
}

function dev(f: Fight, what: string): void {
  f.sim.chat(`/dev wildheart trigger ${what}`, f.tank.id);
}

function pollinate(f: Fight, p: Entity, bloom: Entity): void {
  f.sim.ctx.applyAura(p, {
    id: BLOOM_POLLINATED,
    name: 'Pollinated',
    kind: 'vulnerability',
    remaining: T.pollinateSeconds,
    duration: T.pollinateSeconds,
    value: 0,
    sourceId: bloom.id,
    school: 'nature',
    undispellable: true,
  });
}

describe('Seed Rain and the pods', () => {
  it('a 1.5 s bar, then six pods, one inside each loam bed', () => {
    const f = fight();
    const bloom = pull(f);
    dev(f, 'seeds');
    expect(bloom.castingAbility).toBe(BLOOM_SEED_RAIN);
    run(f, T.seedCast + 0.1);
    const pods = objects(f, WILDHEART_SEEDPOD);
    expect(pods).toHaveLength(T.seedCount);
    for (const bed of GORGEBLOOM_LOAM_BEDS) {
      const inBed = pods.filter((p) => {
        const at = local(f, p);
        return Math.hypot(at.x - bed.x, at.z - bed.z) <= bed.r;
      });
      expect(inBed.length).toBe(1);
    }
    // The spots are hashed, never rolled: the same salt lands the same spot.
    expect(podSpot(bloom.id, 1, 0)).toEqual(podSpot(bloom.id, 1, 0));
  });

  it('a clean player who walks over a pod stomps it flat', () => {
    const f = fight();
    pull(f);
    dev(f, 'pods');
    const [pod] = objects(f, WILDHEART_SEEDPOD);
    const at = local(f, pod);
    put(f, f.others[0], at.x, at.z);
    tick(f);
    expect(f.sim.ctx.entities.has(pod.id)).toBe(false);
    expect(f.fx).toContain(BLOOM_SEED_STOMP);
    expect(live(f, THORN_SPROUT_ID)).toHaveLength(0);
  });

  it('a pollinated touch makes the pod sprout at once', () => {
    const f = fight();
    const bloom = pull(f);
    dev(f, 'pods');
    const [pod] = objects(f, WILDHEART_SEEDPOD);
    pollinate(f, f.others[0], bloom);
    const at = local(f, pod);
    put(f, f.others[0], at.x, at.z);
    tick(f);
    expect(f.sim.ctx.entities.has(pod.id)).toBe(false);
    expect(live(f, THORN_SPROUT_ID)).toHaveLength(1);
  });

  it('a pod left alone turns ripe for its last 4 s, then sprouts at 12 s', () => {
    const f = fight();
    pull(f);
    dev(f, 'pods');
    run(f, T.podSprout - T.podRipeFor + 0.1);
    expect(objects(f, WILDHEART_SEEDPOD_RIPE)).toHaveLength(T.seedCount);
    run(f, T.podRipeFor);
    expect(objects(f, WILDHEART_SEEDPOD_RIPE)).toHaveLength(0);
    expect(live(f, THORN_SPROUT_ID)).toHaveLength(T.seedCount);
  });

  it('heroic Burrowing Seeds: at 6 s the pod rises as a sprout beside the nearest player', () => {
    const f = fight('heroic');
    pull(f);
    dev(f, 'pods');
    run(f, T.heroicBurrow - 0.2);
    expect(live(f, THORN_SPROUT_ID)).toHaveLength(0);
    run(f, 0.3);
    const sprouts = live(f, THORN_SPROUT_ID);
    expect(sprouts).toHaveLength(T.seedCount);
    for (const s of sprouts) {
      const near = Math.min(
        ...[f.tank, ...f.others].map((p) => Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z)),
      );
      expect(near).toBeLessThan(4);
    }
  });
});

describe('Pollinate', () => {
  it('marks two non-tank players for 8 s', () => {
    const f = fight();
    pull(f);
    dev(f, 'pollinate');
    const gold = f.others.filter((p) => aura(p, BLOOM_POLLINATED));
    expect(gold).toHaveLength(T.pollinateCount);
    expect(aura(f.tank, BLOOM_POLLINATED)).toBeUndefined();
    expect(aura(gold[0], BLOOM_POLLINATED)?.remaining).toBe(T.pollinateSeconds);
  });

  it('heroic Pollen Cloud: 2 s within 3 yd of a pollinated player pollinates you too', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const f = fight(difficulty);
      const bloom = pull(f);
      dev(f, 'gorge');
      pollinate(f, f.others[0], bloom);
      const at = local(f, f.others[0]);
      put(f, f.others[1], at.x + 2, at.z);
      run(f, T.cloudSeconds + 0.1);
      expect(aura(f.others[1], BLOOM_POLLINATED) !== undefined, difficulty).toBe(
        difficulty === 'heroic',
      );
    }
  });
});

describe('Vine Lash, Gorge and the Bloom Spit', () => {
  it('Vine Lash: the bloom turns and holds a 30 yd lane, then 180 to 220 and a root in it', () => {
    const f = fight();
    const bloom = pull(f);
    dev(f, 'lash');
    expect(bloom.castingAbility).toBe(BLOOM_VINE_LASH);
    const target = f.sim.ctx.entities.get(bloom.castTargetId ?? -1) as Entity;
    expect(target).toBeDefined();
    const yaw = bloom.facing;
    // A second player steps into the lane, half way down it.
    const mid = f.others.find((p) => p !== target) as Entity;
    put(f, mid, bloom.pos.x - f.ox + Math.sin(yaw) * 12, bloom.pos.z - f.oz + Math.cos(yaw) * 12);
    const from = f.hits.length;
    run(f, T.lashCast + 0.1);
    for (const p of [target, mid]) {
      const h = hitsOn(f, p, 'Vine Lash', from);
      expect(h).toHaveLength(1);
      expect(h[0].amount).toBeGreaterThanOrEqual(T.lashMin);
      expect(h[0].amount).toBeLessThanOrEqual(T.lashMax);
      expect(aura(p, BLOOM_VINE_LASHED)?.kind).toBe('root');
    }
    const clear = f.others.find((p) => p !== target && p !== mid) as Entity;
    expect(hitsOn(f, clear, 'Vine Lash', from)).toHaveLength(0);
  });

  it('Gorge: a 1.5 s bar on the tank, then a heavy bite and Digesting', () => {
    const f = fight();
    const bloom = pull(f);
    tick(f);
    dev(f, 'gorge');
    expect(bloom.castingAbility).toBe(BLOOM_GORGE);
    expect(bloom.castTargetId).toBe(f.tank.id);
    const from = f.hits.length;
    run(f, T.gorgeCast + 0.1);
    expect(hitsOn(f, f.tank, 'Gorge', from)).toHaveLength(1);
    const dot = aura(f.tank, BLOOM_DIGESTING);
    expect(dot?.kind).toBe('dot');
    expect(dot?.value).toBe(T.digestPerSecond);
  });

  it('a target out of its reach is spat at (the rooted bloom is never kited)', () => {
    const f = fight();
    pull(f);
    run(f, 0.5);
    put(f, f.tank, 64, 50);
    const from = f.hits.length;
    run(f, T.spitDelay + T.spitEvery + 0.2);
    const spits = hitsOn(f, f.tank, 'Bloom Spit', from);
    expect(spits.length).toBeGreaterThan(0);
    for (const h of spits) {
      expect(h.amount).toBeGreaterThanOrEqual(T.spitMin);
      expect(h.amount).toBeLessThanOrEqual(T.spitMax);
    }
  });
});

describe('Weed Control, the wither and the reset', () => {
  it('no sprout grew: the kill earns the deed', () => {
    const f = fight();
    const bloom = pull(f, 5000);
    run(f, 1);
    f.sim.ctx.dealDamage(f.tank, bloom, 1e6, false, 'physical', 'Test', 'hit', false);
    tick(f);
    expect(bloom.dead).toBe(true);
    expect(earned(f, f.tank, GORGEBLOOM_DEED)).toBe(true);
  });

  it('a sprout grew: no deed, and its sprouts wither with it', () => {
    const f = fight();
    const bloom = pull(f, 5000);
    dev(f, 'pods');
    run(f, T.podSprout + 0.2);
    expect(live(f, THORN_SPROUT_ID).length).toBeGreaterThan(0);
    f.sim.ctx.dealDamage(f.tank, bloom, 1e6, false, 'physical', 'Test', 'hit', false);
    tick(f);
    expect(earned(f, f.tank, GORGEBLOOM_DEED)).toBe(false);
    expect(live(f, THORN_SPROUT_ID)).toHaveLength(0);
  });

  it('a wipe drops the pods, the gold and the sprouts', () => {
    const f = fight();
    const bloom = pull(f);
    dev(f, 'pods');
    dev(f, 'pollinate');
    bloom.inCombat = false;
    bloom.aggroTargetId = null;
    bloom.aiState = 'evade';
    tick(f);
    expect(objects(f, WILDHEART_SEEDPOD)).toHaveLength(0);
    for (const p of f.others) expect(aura(p, BLOOM_POLLINATED)).toBeUndefined();
    expect(bloom.wildheartFight).toBeUndefined();
  });
});
