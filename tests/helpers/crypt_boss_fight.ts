// Shared harness for the Hollow Crypt wing-boss suites (Sexton Marrow, the Lady
// of the Bonechill, Cantor Ilvane): a real claimed Hollow Crypt with a real
// party, every mob but the kept ones cleared, every damage event and spellfx cue
// recorded. The readers (put, run, until, took, aura...) are the Bastion
// harness's, which work on any claim.

import { DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { claimedInstanceAt, enterDungeon } from '../../src/sim/instances/dungeons';
import { Sim } from '../../src/sim/sim';
import type { Entity } from '../../src/sim/types';
import type { Fight } from './bastion_fight';

export * from './bastion_fight';

export function cryptFight(
  difficulty: 'normal' | 'heroic',
  extra: number,
  keep: ReadonlySet<string>,
  seed = 23,
): Fight {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Mourner${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev crypt enter ${difficulty}`, tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'hollow_crypt', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no crypt claim');
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e && !e.dead && !keep.has(e.templateId)) sim.ctx.handleDeath(e, tank);
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, tank, others, hits: [], cues: [] };
}
