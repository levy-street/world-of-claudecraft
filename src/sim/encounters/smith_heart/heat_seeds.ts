// The Guardian of the Heat's Hearthseeds (docs/design/raid/smith_heart.md
// section 7.4), phase 2.
//
//   Hearthseeds  every 30 s (first 6 s into the phase) the guardian heaves
//                molten rock out of the wellspring and hurls a seed of the
//                first flame where each player stands (at most ten; the raid
//                is stacked close to the guardian): each spot shows at once,
//                the seed strikes it seedFlight later (its landing cue: the
//                thrown meteors land there then). Each glows and throbs for
//                10 s from the throw, then bursts: the closer a player stands, the harder it
//                strikes (falling off with the square of the distance, to
//                nothing at 22 yd). So the raid drops them together and runs.
//   Seedflames   heroic: each burst hatches a small fire elemental that hunts
//                one hashed player (the mob AI fights it, its target held);
//                the raid burns them down together.
//
// Deterministic: a seed per player in entity-id order, the hunts hashed; the
// only rng draws are the damage rolls, seed by seed, player by player.

import { DT, type Entity } from '../../types';
import {
  HEAT_CUES,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_OBJECTS,
  heatTimed,
  seedFalloff,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  cueAt,
  cueOnBoss,
  dropFightObject,
  fireHit,
  type HeatScope,
  liveEntity,
  livePlayers,
  pickPlayers,
  roll,
  spawnFightObject,
  spawnHeatMob,
} from './heat_scope';
import type { HeatSeed } from './heat_state';
import { heatSay } from './heat_voice';

/** The seeds fall, one where each player stands. Returns how many. Exported
 *  for the dev trigger. */
export function dropSeeds(s: HeatScope): number {
  const st = s.st;
  st.seedTimer = T.seedEvery;
  st.seedWaves++;
  let n = 0;
  for (const p of livePlayers(s)) {
    if (n >= T.seedCap) break;
    const here = at(s, p);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      heatTimed(HEAT_OBJECTS.seedPrefix, T.seedLife),
      HEAT_NAMES.seed,
      here.x,
      here.z,
      T.seedReach,
    );
    st.seeds.push({
      objectId: obj.id,
      x: here.x,
      z: here.z,
      life: T.seedLife,
      flight: T.seedFlight,
    });
    n++;
  }
  if (n > 0) {
    cueOnBoss(s, HEAT_CUES.seedThrow);
    heatSay(s, s.boss, 'seeds');
  }
  return n;
}

/** A seed bursts: everyone in reach struck by the falloff; heroic hatches a
 *  Seedflame. Returns who it struck. Exported for the tests. */
export function burstSeed(s: HeatScope, seed: HeatSeed): Entity[] {
  dropFightObject(s.ctx, s.inst, seed.objectId);
  cueAt(s, HEAT_CUES.seedBurst, seed.x, seed.z, T.seedReach);
  const hit: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    const mid = seedFalloff(Math.hypot(here.x - seed.x, here.z - seed.z));
    if (mid < 1) continue;
    hit.push(p);
    fireHit(s, p, roll(s, mid * 0.95, mid * 1.05), HEAT_NAMES.seed);
  }
  if (s.rules.seedHatch) hatch(s, seed);
  return hit;
}

/** A Seedflame climbs out of a burst and hunts a hashed player. */
function hatch(s: HeatScope, seed: HeatSeed): Entity | null {
  const e = spawnHeatMob(s, HEAT_MOBS.seedflame, seed.x, seed.z, 0);
  if (!e) return null;
  const [quarry] = pickPlayers(s, 1, 900 + s.st.casts++);
  if (quarry) {
    s.ctx.aggroMob(e, quarry, false);
    e.forcedTargetId = quarry.id;
    e.forcedTargetTimer = 1;
  }
  s.st.sprouts.push({ id: e.id, quarry: quarry?.id ?? null });
  cueAt(s, HEAT_CUES.hatch, seed.x, seed.z, 1.5);
  return e;
}

/** One tick of the seeds (their bursts) and the Seedflames (their hunts). */
export function stepSeeds(s: HeatScope): void {
  const st = s.st;
  if (st.seeds.length > 0) {
    const ripe: HeatSeed[] = [];
    for (const seed of st.seeds) {
      if (seed.flight > 0) {
        seed.flight -= DT;
        if (seed.flight <= 1e-9) {
          // Landed: once (a flight never counts down past its cue).
          seed.flight = 0;
          cueAt(s, HEAT_CUES.seed, seed.x, seed.z, 1.5);
        }
      }
      seed.life -= DT;
      if (seed.life <= 1e-9) ripe.push(seed);
    }
    if (ripe.length > 0) {
      st.seeds = st.seeds.filter((x) => x.life > 1e-9);
      for (const seed of ripe) burstSeed(s, seed);
    }
  }
  if (st.sprouts.length === 0) return;
  st.sprouts = st.sprouts.filter((sp) => liveEntity(s, sp.id));
  for (const sp of st.sprouts) {
    const e = liveEntity(s, sp.id);
    if (!e) continue;
    if (!liveEntity(s, sp.quarry) || !s.players.some((p) => p.id === sp.quarry)) {
      const [next] = pickPlayers(s, 1, 900 + st.casts++);
      sp.quarry = next?.id ?? null;
      if (next) s.ctx.aggroMob(e, next, false);
    }
    if (sp.quarry !== null) {
      e.forcedTargetId = sp.quarry;
      e.forcedTargetTimer = 1;
      e.aggroTargetId = sp.quarry;
    }
  }
}

/** Every seed off the floor. */
export function clearSeeds(s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>): void {
  for (const seed of s.st.seeds) dropFightObject(s.ctx, s.inst, seed.objectId);
  s.st.seeds = [];
  s.st.sprouts = [];
}
