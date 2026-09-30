import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  emitTurretSelfKeys,
  turretPlanWireJson,
  turretStateWireJson,
} from '../server/turret_self_wire';
import { TURRET_SCENARIO_HARD } from '../src/sim/content/fire_and_fly_scenarios';
import { BUILTIN_WORLD } from '../src/sim/data';
import { horizontalAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, turretChargesLeft } from '../src/sim/minigames/turret_defense_plan';
import {
  TURRET_STREAM,
  type TurretDrawSource,
  type TurretRunKey,
  turretDraw,
  turretKeyedHash,
  turretRunKey,
} from '../src/sim/minigames/turret_defense_rng';
import { startTurretShockwave } from '../src/sim/minigames/turret_shockwave';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { PrivateSalt, TurretSession, WorldContent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

const drawLog = vi.hoisted(() => [] as { stream: number; runKey?: TurretRunKey }[]);

vi.mock('../src/sim/minigames/turret_defense_rng', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sim/minigames/turret_defense_rng')>();
  return {
    ...real,
    turretDraw: (source: TurretDrawSource, stream: number, a: number, b?: number) => {
      drawLog.push({ stream, runKey: source.runKey });
      return real.turretDraw(source, stream, a, b);
    },
  };
});

const ROOT = join(__dirname, '..');
const SALT: PrivateSalt = [0xdeadbeef, 0x5eed1234];
const OTHER_SALT: PrivateSalt = [0xdeadbeef, 0x5eed1235];
const flat: ThrowProbe = { ground: () => 0, water: () => null };
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function legacyDraw(seed: number, stream: number, a: number, b = 0): number {
  let h = 0x811c9dc5;
  for (const n of [seed, stream, a, b]) {
    h = (h ^ (n >>> 0)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return new Rng(h).next();
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x >>> 0; v; v &= v - 1) n++;
  return n;
}

/** A run under a steady aimer (the oldest monster, whenever the cannon is ready) and where
 *  each monster stepped onto the field. With `weapons`, frag shells while they last and a
 *  Shockwave on a windup. */
function run(
  seed: number,
  salt?: PrivateSalt,
  plan = resolveTurretPlan(),
  maxTicks = 1600,
  weapons = false,
) {
  const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, 0, salt);
  const spawns = new Map<number, string>();
  for (let tick = 1; tick <= maxTicks && state.phase !== 'won' && state.phase !== 'lost'; tick++) {
    tickTurretDefense(state, tick, flat);
    for (const m of state.monsters) {
      if (!spawns.has(m.id)) {
        const at = horizontalAt(m.seg, tick);
        spawns.set(m.id, `${at.x.toFixed(3)},${at.z.toFixed(3)}`);
      }
    }
    const target = state.monsters.find((m) => m.state === 'march' || m.state === 'windup');
    if (weapons && target?.state === 'windup') startTurretShockwave(state, tick, flat);
    if (target && tick >= state.readyTick) {
      const at = horizontalAt(target.seg, tick);
      const frag = weapons && turretChargesLeft(state).fragmentation > 0;
      fireTurret(state, tick, at.x, at.z, flat, frag ? 'frag' : 'shell');
    }
  }
  return { state, spawns: [...spawns.values()] };
}

describe('the keyed mixer', () => {
  it('replays the same output from the same key and words', () => {
    expect(turretKeyedHash(1, 2, [3, 4, 5])).toBe(turretKeyedHash(1, 2, [3, 4, 5]));
    expect(turretRunKey(SALT, 77)).toEqual(turretRunKey(SALT, 77));
  });

  it('flips about half the output bits for one flipped key or message bit', () => {
    let flips = 0;
    let trials = 0;
    for (let i = 0; i < 64; i++) {
      const words = [i * 7919, i, 3];
      const base = turretKeyedHash(0x1234 + i, 0x9876 * i, words);
      for (let bit = 0; bit < 32; bit++) {
        flips += popcount(base ^ turretKeyedHash((0x1234 + i) ^ (1 << bit), 0x9876 * i, words));
        flips += popcount(base ^ turretKeyedHash(0x1234 + i, (0x9876 * i) ^ (1 << bit), words));
        const flipped = [words[0] ^ (1 << bit), words[1], words[2]];
        flips += popcount(base ^ turretKeyedHash(0x1234 + i, 0x9876 * i, flipped));
        trials += 3;
      }
    }
    expect(flips / trials).toBeGreaterThan(15.5);
    expect(flips / trials).toBeLessThan(16.5);
  });

  it('folds every salt lane and the seed into the run key', () => {
    const key = turretRunKey(SALT, 77);
    expect(turretRunKey(OTHER_SALT, 77)).not.toEqual(key);
    expect(turretRunKey([SALT[0] ^ 1, SALT[1]], 77)).not.toEqual(key);
    expect(turretRunKey(SALT, 78)).not.toEqual(key);
    expect(key[0]).not.toBe(key[1]);
  });

  it('keeps the unsalted draw exactly the one the engine always drew', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const stream of Object.values(TURRET_STREAM)) {
        expect(turretDraw({ seed }, stream, seed * 3, seed & 5)).toBe(
          legacyDraw(seed, stream, seed * 3, seed & 5),
        );
      }
    }
  });

  it('moves every draw with the salt, and replays it with the same salt', () => {
    const salted = { seed: 9, runKey: turretRunKey(SALT, 9) };
    const other = { seed: 9, runKey: turretRunKey(OTHER_SALT, 9) };
    let same = 0;
    for (let id = 0; id < 200; id++) {
      const draw = turretDraw(salted, TURRET_STREAM.spawnAngle, id);
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
      expect(draw).toBe(turretDraw({ ...salted }, TURRET_STREAM.spawnAngle, id));
      if (draw === turretDraw({ seed: 9 }, TURRET_STREAM.spawnAngle, id)) same++;
      if (draw === turretDraw(other, TURRET_STREAM.spawnAngle, id)) same++;
    }
    expect(same).toBe(0);
  });
});

describe('a salted run', () => {
  it('carries a run key only when salted, and an unsalted run matches the seed-only engine', () => {
    expect(createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 5, 0)).not.toHaveProperty(
      'runKey',
    );
    expect(createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 5, 0, SALT).runKey).toEqual(
      turretRunKey(SALT, 5),
    );
  });

  it('replays exactly from the same seed and salt, and moves with either', () => {
    const a = run(42, SALT);
    expect(a.state.stats.shots).toBeGreaterThan(10);
    expect(a.state.stats.hits).toBeGreaterThan(0);
    expect(a.spawns.length).toBeGreaterThan(5);
    expect(run(42, SALT)).toEqual(a);
    for (const other of [run(42, OTHER_SALT), run(42), run(43, SALT)]) {
      expect(other.spawns[0]).not.toBe(a.spawns[0]);
      expect(other.spawns.slice(0, 5)).not.toEqual(a.spawns.slice(0, 5));
    }
  });

  it('keys every engine draw site with the run key, on every stream', () => {
    drawLog.length = 0;
    const { state } = run(42, SALT, resolveTurretPlan(TURRET_SCENARIO_HARD), 12000, true);
    const key = state.runKey;
    expect(key).toBeDefined();
    expect(new Set(drawLog.map((d) => d.stream))).toEqual(new Set(Object.values(TURRET_STREAM)));
    const unkeyed = drawLog.filter((d) => d.runKey?.[0] !== key?.[0] || d.runKey?.[1] !== key?.[1]);
    expect(unkeyed).toEqual([]);
  });
});

describe('the salt stays on the host', () => {
  function seatedSim(privateSalt?: PrivateSalt) {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      noPlayer: true,
      world: EMPTY_WORLD,
      ...(privateSalt ? { privateSalt } : {}),
    });
    const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
    sim.chat('/dev turret', pid);
    const meta = sim.meta(pid)!;
    const session = meta.vehicle as TurretSession;
    expect(session.kind).toBe('turret');
    return { sim, pid, meta, session };
  }

  it('keys a server seat with the boot salt, and an offline seat with the seed alone', () => {
    const online = seatedSim(SALT);
    expect(online.session.defense.runKey).toEqual(turretRunKey(SALT, online.session.defense.seed));
    const offline = seatedSim();
    expect(offline.sim.cfg.privateSalt).toBeUndefined();
    expect(offline.session.defense).not.toHaveProperty('runKey');
  });

  it('never puts the salt or the run key on the view, the tur and turp keys, the events or the save', () => {
    const { sim, pid, meta, session } = seatedSim(SALT);
    const events: unknown[] = [];
    for (let i = 0; i < 400; i++) {
      sim.tick();
      events.push(...sim.drainEvents());
    }
    expect(session.defense.monsters.length).toBeGreaterThan(0);
    const secrets = [...SALT, ...(session.defense.runKey ?? [])].map(String);
    expect(secrets).toHaveLength(4);
    const view = turretSessionView(session);
    expect(view.defense).not.toHaveProperty('runKey');
    expect(view.defense).not.toHaveProperty('seed');
    const raw: string[] = [];
    emitTurretSelfKeys((_key, json) => raw.push(json), meta, sim.tickCount);
    const texts = [
      JSON.stringify(view),
      turretStateWireJson(session, sim.tickCount),
      turretPlanWireJson(session.defense.plan),
      ...raw,
      JSON.stringify(events),
      JSON.stringify(sim.serializeCharacter(pid)),
    ];
    for (const text of texts) {
      expect(text).not.toContain('runKey');
      expect(text).not.toContain('privateSalt');
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });

  it('leaves the offline client and the RL env without a salt', () => {
    for (const host of ['headless/env_server.ts', 'src/main.ts', 'src/editor/3d/viewport.ts']) {
      expect(readFileSync(join(ROOT, host), 'utf8')).not.toContain('privateSalt');
    }
  });
});
