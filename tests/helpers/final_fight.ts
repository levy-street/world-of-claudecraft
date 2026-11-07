// A Masterless Strength fight over a REAL Sim (tests/smith_heart_final*.
// test.ts): a claim of the Smith's Heart, a few players placed on the Anvil
// of the World, and the handles the final's tests read.

import { SMITH_HEART_DUNGEON } from '../../src/sim/content/smith_heart';
import type { SmithHeartVein } from '../../src/sim/content/smith_heart_layout';
import { heartQuarterSpot } from '../../src/sim/content/smith_heart_quarters';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { displacePlayerForDev } from '../../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../../src/sim/dev/smith_heart_dev';
import { type FinalFightState, finalBoss } from '../../src/sim/encounters/smith_heart';
import { enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { addThreat } from '../../src/sim/threat';
import type { Entity, SimEvent, WorldContent } from '../../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

export interface FinalFight {
  sim: Sim;
  inst: InstanceSlot;
  pids: number[];
  players: Entity[];
  dev: (line: string, pid?: number) => boolean;
  world: (x: number, z: number) => { x: number; z: number };
  local: (e: Entity) => { x: number; z: number };
  put: (e: Entity, x: number, z: number) => void;
  boss: () => Entity;
  state: () => FinalFightState | null;
  objects: (prefix: string) => Entity[];
  /** Pull the boss and stand it (rooted) in `vein`'s quarter, the raid
   *  gathered round it there. */
  pullIn: (vein: SmithHeartVein) => void;
  /** Stand every player in a ring of `r` yards round instance-local (x, z). */
  gather: (x: number, z: number, r: number) => void;
  /** Keep the raid alive through the run (the tests measure hits). */
  tick: (n?: number, keepAlive?: boolean) => SimEvent[];
  /** One tick of `e` WALKING (its real move input, colliders and all)
   *  toward instance-local (x, z); stops within `near` yards. Returns
   *  whether it has arrived. */
  walkStep: (e: Entity, x: number, z: number, near?: number) => boolean;
}

/** A claim with `n` warriors in the Heart. */
export function finalFight(n = 5, seed = 41): FinalFight {
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
  const gather = (x: number, z: number, r: number) => {
    players.forEach((p, i) => {
      const a = (i / players.length) * Math.PI * 2;
      put(p, x + Math.sin(a) * r, z + Math.cos(a) * r);
    });
  };
  // Level 20 raiders with a great store of health (a permanent stamina
  // buff that survives every aura-driven recalculation), so the tests measure
  // hits and nobody dies of them.
  for (const pid of pids) sim.setPlayerLevel(20, pid);
  for (const p of players) {
    p.auras.push({
      id: 'test_final_vigour',
      name: 'Test Vigour',
      kind: 'buff_sta',
      remaining: 99999,
      duration: 99999,
      permanent: true,
      value: 6000,
      sourceId: p.id,
      school: 'physical',
    });
    p.maxHp = 60000;
    p.hp = 60000;
  }
  gather(188, 150, 3);
  sim.tick();
  const dev = (line: string, pid = pids[0]) => handleSmithHeartDevChat(sim.ctx, line, pid);
  const boss = () => {
    const b = finalBoss(sim.ctx, inst);
    if (!b) throw new Error('no boss');
    return b;
  };
  const objects = (prefix: string) =>
    inst.objectIds
      .map((id) => sim.ctx.entities.get(id))
      .filter((e): e is Entity => !!e && e.templateId.startsWith(prefix));
  const tick = (k = 1, keepAlive = true) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < k; i++) {
      if (keepAlive) for (const p of players) if (!p.dead) p.hp = p.maxHp;
      out.push(...sim.tick());
    }
    return out;
  };
  const walkStep = (e: Entity, x: number, z: number, near = 1) => {
    const meta = sim.ctx.players.get(e.id);
    if (!meta) throw new Error('not a player');
    const here = local(e);
    const d = Math.hypot(x - here.x, z - here.z);
    meta.moveInput.forward = d > near;
    if (d > near) e.facing = Math.atan2(x - here.x, z - here.z);
    tick(1);
    if (d <= near) meta.moveInput.forward = false;
    return d <= near;
  };
  const pullIn = (vein: SmithHeartVein) => {
    dev(`/dev heart final quarter ${vein}`);
    const spot = heartQuarterSpot(vein);
    gather(spot.x, spot.z, 3);
    dev('/dev heart final pull');
    // The whole raid on its threat table (the tank far ahead), as a raid
    // that fights it would be: a frozen or stunned tank never empties it.
    const b = boss();
    addThreat(b, pids[0], 100000);
    for (const pid of pids.slice(1)) addThreat(b, pid, 10);
    gather(spot.x, spot.z, 3);
    tick(2);
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
    boss,
    state: () => boss().smithHeartFinal ?? null,
    objects,
    pullIn,
    gather,
    tick,
    walkStep,
  };
}
