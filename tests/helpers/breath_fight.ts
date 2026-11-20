// A Guardian of the Breath fight over a REAL Sim (tests/smith_heart_breath*.
// test.ts): a claim of the Smith's Heart, a few players placed on the Storm
// Cornice, and the handles the breath tests read.

import { SMITH_HEART_DUNGEON } from '../../src/sim/content/smith_heart';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { displacePlayerForDev } from '../../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../../src/sim/dev/smith_heart_dev';
import {
  BREATH_OBJECTS,
  type BreathFightState,
  breathGuardian,
  breathWindOf,
} from '../../src/sim/encounters/smith_heart';
import { enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

export interface BreathFight {
  sim: Sim;
  inst: InstanceSlot;
  pids: number[];
  players: Entity[];
  dev: (line: string, pid?: number) => boolean;
  world: (x: number, z: number) => { x: number; z: number };
  local: (e: Entity) => { x: number; z: number };
  put: (e: Entity, x: number, z: number) => void;
  boss: () => Entity;
  state: () => BreathFightState | null;
  wind: () => ReturnType<typeof breathWindOf>;
  objects: (prefix: string) => Entity[];
  /** Keep the raid alive through the run (the tests measure hits). */
  tick: (n?: number, keepAlive?: boolean) => SimEvent[];
}

/** A claim with `n` warriors on the Cornice, west of the guardian. */
export function breathFight(n = 6, seed = 23): BreathFight {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pids: number[] = [];
  for (let i = 0; i < n; i++) pids.push(sim.addPlayer('warrior', `Raider${i + 1}`));
  if (!enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pids[0])) throw new Error('enter');
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
  const world = (x: number, z: number) => ({ x: o.x + x, z: o.z + z });
  const local = (e: Entity) => ({ x: e.pos.x - o.x, z: e.pos.z - o.z });
  const put = (e: Entity, x: number, z: number) =>
    displacePlayerForDev(sim.ctx, e, o.x + x, o.z + z);
  const players = pids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  players.forEach((p, i) => {
    put(p, -12 + (i % 3) * 3, 192 + Math.floor(i / 3) * 4);
    p.maxHp = 50000;
    p.hp = 50000;
  });
  sim.tick();
  const dev = (line: string, pid = pids[0]) => handleSmithHeartDevChat(sim.ctx, line, pid);
  const boss = () => {
    const b = breathGuardian(sim.ctx, inst);
    if (!b) throw new Error('no guardian');
    return b;
  };
  const objects = (prefix: string) =>
    inst.objectIds
      .map((id) => sim.ctx.entities.get(id))
      .filter((e): e is Entity => !!e && e.templateId.startsWith(prefix));
  return {
    sim,
    inst,
    pids,
    players,
    dev,
    world,
    local,
    put,
    boss,
    state: () => boss().smithHeartBreath ?? null,
    wind: () => {
      const w = objects(BREATH_OBJECTS.windPrefix)[0];
      return w ? breathWindOf(w.templateId) : null;
    },
    objects,
    tick: (k = 1, keepAlive = true) => {
      const out: SimEvent[] = [];
      for (let i = 0; i < k; i++) {
        if (keepAlive) for (const p of players) if (!p.dead) p.hp = Math.max(p.hp, 40000);
        out.push(...sim.tick());
      }
      return out;
    },
  };
}
