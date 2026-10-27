// A Guardian of the Heat fight over a REAL Sim (tests/smith_heart_heat*.
// test.ts): a claim of the Smith's Heart, a few players placed on the
// Hearth's floor, and the handles the heat tests read.

import { SMITH_HEART_DUNGEON } from '../../src/sim/content/smith_heart';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { displacePlayerForDev } from '../../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../../src/sim/dev/smith_heart_dev';
import { type HeatFightState, heatGuardian } from '../../src/sim/encounters/smith_heart';
import { enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** Where the players wait: along the floor's south edge, far from the
 *  guardian, out of every crystal socket's reach and off the channel. */
export const HEAT_WAIT_SPOTS: readonly { x: number; z: number }[] = [
  { x: -190, z: -40 },
  { x: -196, z: -41 },
  { x: -202, z: -41 },
  { x: -208, z: -41 },
  { x: -223, z: -41 },
  { x: -229, z: -40 },
  { x: -235, z: -40 },
];

export interface HeatFight {
  sim: Sim;
  inst: InstanceSlot;
  pids: number[];
  players: Entity[];
  dev: (line: string, pid?: number) => boolean;
  world: (x: number, z: number) => { x: number; z: number };
  local: (e: Entity) => { x: number; z: number };
  put: (e: Entity, x: number, z: number) => void;
  boss: () => Entity;
  state: () => HeatFightState | null;
  objects: (prefix: string) => Entity[];
  /** Keep the raid alive through the run (the tests measure hits). */
  tick: (n?: number, keepAlive?: boolean) => SimEvent[];
}

/** A claim with `n` warriors on the Hearth's floor (at most seven). */
export function heatFight(n = 5, seed = 31): HeatFight {
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
    const at = HEAT_WAIT_SPOTS[i % HEAT_WAIT_SPOTS.length];
    put(p, at.x, at.z);
    p.maxHp = 50000;
    p.hp = 50000;
  });
  sim.tick();
  const dev = (line: string, pid = pids[0]) => handleSmithHeartDevChat(sim.ctx, line, pid);
  const boss = () => {
    const b = heatGuardian(sim.ctx, inst);
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
    state: () => boss().smithHeartHeat ?? null,
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
