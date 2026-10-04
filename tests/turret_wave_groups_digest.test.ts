import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { FIRE_AND_FLY_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { horizontalAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, turretChargesLeft } from '../src/sim/minigames/turret_defense_plan';
import { startTurretShockwave } from '../src/sim/minigames/turret_shockwave';
import { turretWorldProbe } from '../src/sim/turret_defense_session';
import type { PrivateSalt } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// Replay digests of every scenario, pinned on the engine before waves became groups of
// bricks (lot G1, at 41b240ead3): the events of every tick and the whole engine state at
// every revision, on the real arena ground, for several seeds and two aimers. The rewrite of
// the scenarios in the new format must replay them byte for byte.

const probe: ThrowProbe = turretWorldProbe(WORLD_SEED);
const center = instanceOrigin(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index, 0);
const START = 1000;
const MAX_TICKS = 20 * 60 * 12;
const SALT: PrivateSalt = [0x1234abcd, 0x0badf00d];

function fnv(h: number, text: string): number {
  let v = h;
  for (let i = 0; i < text.length; i++) {
    v = (v ^ text.charCodeAt(i)) >>> 0;
    v = Math.imul(v, 0x01000193) >>> 0;
  }
  return v;
}

/** The state a reader can see change: everything but the plan, the clock, the seed and the spawn scheduler. */
function snapshot(state: TurretDefenseState): string {
  return JSON.stringify({
    rev: state.rev,
    phase: state.phase,
    phaseEndTick: state.phaseEndTick,
    wave: state.wave,
    integrity: state.integrity,
    readyTick: state.readyTick,
    shockReadyTick: state.shockReadyTick,
    shockwave: state.shockwave,
    frags: state.frags,
    aimX: state.aimX,
    aimZ: state.aimZ,
    nextShotId: state.nextShotId,
    nextMonsterId: state.nextMonsterId,
    nextBarrelId: state.nextBarrelId,
    shots: state.shots,
    monsters: state.monsters,
    barrels: state.barrels,
    rallies: state.rallies ?? [],
    stats: state.stats,
    result: state.result,
  });
}

/** A small deterministic offset (yd) per seed and tick, so the aim is not always dead on. */
function jitter(seed: number, tick: number, axis: number): number {
  const h = fnv(0x811c9dc5, `${seed}:${tick}:${axis}`);
  return ((h % 1000) / 1000 - 0.5) * 3;
}

/** `slow` fires a shell 0.6 s after each reload, a little off: the field crowds, the tower takes strikes. */
type Aimer = 'nearest' | 'armed' | 'slow';
const SLOW_DELAY = 12;

function nearest(state: TurretDefenseState, tick: number) {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = horizontalAt(m.seg, tick);
    const d = Math.hypot(p.x - state.cx, p.z - state.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function crowdAround(state: TurretDefenseState, tick: number, at: { x: number; z: number }) {
  let n = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = horizontalAt(m.seg, tick);
    if (Math.hypot(p.x - at.x, p.z - at.z) <= 7) n++;
  }
  return n;
}

function digestRun(scenario: number, seed: number, aimer: Aimer, salted: boolean): string {
  const plan = resolveTurretPlan(FIRE_AND_FLY_SCENARIOS[scenario]);
  const state = createTurretDefense(plan, center, seed, START, salted ? SALT : undefined);
  let h = fnv(0x811c9dc5, JSON.stringify(plan.kinds));
  let rev = -1;
  const take = (events: readonly TurretEvent[]) => {
    for (const e of events) h = fnv(h, JSON.stringify(e));
  };
  for (let t = START + 1; t <= START + MAX_TICKS; t++) {
    take(tickTurretDefense(state, t, probe));
    if (state.phase === 'won' || state.phase === 'lost') {
      h = fnv(h, `${t}|${snapshot(state)}`);
      break;
    }
    if (aimer === 'armed' && state.phase === 'wave' && t >= state.shockReadyTick) {
      const winding = state.monsters.some((m) => m.state === 'windup');
      if (winding && turretChargesLeft(state).shockwave > 0)
        take(startTurretShockwave(state, t, probe).events);
    }
    if (t >= state.readyTick + (aimer === 'slow' ? SLOW_DELAY : 0)) {
      const target = nearest(state, t);
      if (target) {
        const off = aimer !== 'nearest';
        const x = target.x + (off ? jitter(seed, t, 0) : 0);
        const z = target.z + (off ? jitter(seed, t, 1) : 0);
        const frag =
          aimer === 'armed' &&
          state.phase === 'wave' &&
          turretChargesLeft(state).fragmentation > 0 &&
          crowdAround(state, t, target) >= 3;
        take(fireTurret(state, t, x, z, probe, frag ? 'frag' : 'shell').events);
      }
    }
    if (state.rev !== rev) {
      rev = state.rev;
      h = fnv(h, `${t}|${snapshot(state)}`);
    }
  }
  return `${state.phase}:${state.wave}:${state.integrity}:${h.toString(16).padStart(8, '0')}`;
}

const RUNS: readonly [number, number, Aimer, boolean][] = FIRE_AND_FLY_SCENARIOS.flatMap((_, s) => [
  [s, 1, 'nearest', false] as const,
  [s, 5, 'armed', false] as const,
  [s, 9, 'armed', true] as const,
  [s, 3, 'slow', false] as const,
  [s, 4, 'slow', true] as const,
]);

const DIGESTS: Readonly<Record<string, string>> = {
  // Re-taken when The Cracked Tower was recomposed from varied bricks (its content changed).
  'brittle/1/nearest/plain': 'won:7:7:2d89b03d',
  'brittle/3/slow/plain': 'won:7:7:478d09ce',
  'brittle/4/slow/salted': 'won:7:7:1016bbc1',
  'brittle/5/armed/plain': 'won:7:7:958a3d05',
  'brittle/9/armed/salted': 'won:7:7:0b14faac',
  // Re-taken when The Deluge was recomposed from varied bricks (its content changed).
  'deluge/1/nearest/plain': 'won:7:70:098bfd5a',
  'deluge/3/slow/plain': 'won:7:53:21192485',
  'deluge/4/slow/salted': 'won:7:56:62f86189',
  'deluge/5/armed/plain': 'won:7:70:57b61261',
  'deluge/9/armed/salted': 'won:7:70:72923dda',
  'hard/1/nearest/plain': 'won:5:70:5b1b2ec2',
  'hard/3/slow/plain': 'won:5:7:bfebb1c9',
  'hard/4/slow/salted': 'won:5:37:e1306b21',
  'hard/5/armed/plain': 'won:5:70:6fed057f',
  'hard/9/armed/salted': 'won:5:70:254af163',
  'introduction/1/nearest/plain': 'won:6:70:bac1479f',
  'introduction/3/slow/plain': 'won:6:70:cfd80052',
  'introduction/4/slow/salted': 'won:6:60:0558a7a8',
  'introduction/5/armed/plain': 'won:6:70:c738fe9d',
  'introduction/9/armed/salted': 'won:6:70:b0c1f407',
  'pack/1/nearest/plain': 'won:7:70:5baeff4f',
  'pack/3/slow/plain': 'won:7:24:cab7c442',
  'pack/4/slow/salted': 'won:7:40:4a87621e',
  'pack/5/armed/plain': 'won:7:70:503a5e08',
  'pack/9/armed/salted': 'won:7:70:49fbc0f0',
  // Re-taken when The Powder Store was recomposed from varied bricks (its content changed).
  'powder/1/nearest/plain': 'won:7:70:be9762cc',
  'powder/3/slow/plain': 'won:7:69:9d36b270',
  'powder/4/slow/salted': 'won:7:66:6b5068bb',
  'powder/5/armed/plain': 'won:7:70:ba57b25e',
  'powder/9/armed/salted': 'won:7:70:5c168e43',
  'standard/1/nearest/plain': 'won:5:70:b7244f0c',
  'standard/3/slow/plain': 'won:5:20:5ff497b4',
  'standard/4/slow/salted': 'won:5:30:53b2e732',
  'standard/5/armed/plain': 'won:5:70:b1a39eec',
  'standard/9/armed/salted': 'won:5:70:d278dd2c',
};

describe('every scenario replays its pinned digest', () => {
  it.each(
    RUNS.map(
      ([s, seed, aimer, salted]) =>
        [FIRE_AND_FLY_SCENARIOS[s].boardKey, s, seed, aimer, salted] as const,
    ),
  )('%s (%i) seed %i %s salted %s', (key, s, seed, aimer, salted) => {
    const got = digestRun(s, seed, aimer, salted);
    const id = `${key}/${seed}/${aimer}/${salted ? 'salted' : 'plain'}`;
    expect(got).toBe(DIGESTS[id]);
  });
});
