// A Hammer Council fight over a REAL Sim (tests/smith_heart_council*.test.ts):
// a claim of the Smith's Heart, a few players placed on the Quarry floor, the
// council pulled, and the handles the council tests read.

import { SMITH_HEART_DUNGEON } from '../../src/sim/content/smith_heart';
import { HAMMER_PIT } from '../../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { displacePlayerForDev } from '../../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../../src/sim/dev/smith_heart_dev';
import {
  type CouncilFightState,
  councilBodies,
  councilPillars,
  councilState,
} from '../../src/sim/encounters/smith_heart';
import { enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

export interface CouncilFight {
  sim: Sim;
  inst: InstanceSlot;
  pids: number[];
  players: Entity[];
  dev: (line: string, pid?: number) => boolean;
  /** Instance-local -> world. */
  world: (x: number, z: number) => { x: number; z: number };
  local: (e: Entity) => { x: number; z: number };
  put: (e: Entity, x: number, z: number) => void;
  bodies: () => NonNullable<ReturnType<typeof councilBodies>>;
  state: () => CouncilFightState | null;
  pillars: () => ReturnType<typeof councilPillars>;
  tick: (n?: number) => SimEvent[];
}

/** A claim with `n` players (warriors) spread on the Quarry floor. */
export function councilFight(n = 6, seed = 17): CouncilFight {
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
  // A ring of raiders 14 yd round the Quarry's middle, toward the Pit Mouth.
  players.forEach((p, i) => {
    const a = Math.PI * 1.4 + (i - n / 2) * 0.35;
    put(p, HAMMER_PIT.x + Math.sin(a) * 14, HAMMER_PIT.z + Math.cos(a) * 14);
    p.maxHp = 50000;
    p.hp = 50000;
  });
  sim.tick();
  const dev = (line: string, pid = pids[0]) => handleSmithHeartDevChat(sim.ctx, line, pid);
  const bodies = () => {
    const b = councilBodies(sim.ctx, inst);
    if (!b) throw new Error('no council');
    return b;
  };
  return {
    sim,
    inst,
    pids,
    players,
    dev,
    world,
    local,
    put,
    bodies,
    state: () => councilState(bodies()),
    pillars: () => councilPillars(sim.ctx, inst),
    tick: (k = 1) => {
      const out: SimEvent[] = [];
      for (let i = 0; i < k; i++) {
        // Keep the raid alive through long runs (the tests measure hits).
        for (const p of players) if (!p.dead) p.hp = Math.max(p.hp, 40000);
        out.push(...sim.tick());
      }
      return out;
    },
  };
}

/** Damage events of `name` on `targetId` among `events`. */
export function hitsOf(events: readonly SimEvent[], name: string, targetId?: number): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.type !== 'damage') continue;
    const d = e as SimEvent & { ability?: string | null; targetId?: number; amount?: number };
    if (d.ability !== name) continue;
    if (targetId !== undefined && d.targetId !== targetId) continue;
    out.push(d.amount ?? 0);
  }
  return out;
}
