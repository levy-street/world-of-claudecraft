// The Drowned Temple playtest jumps (src/sim/dev/drowned_temple_dev.ts): every
// boss and the Mere Hydra has a `/dev temple tp` name that lands the player
// beside it, on its floor, in sight of it.

import { describe, expect, it } from 'vitest';
import {
  COLOSSUS_ID,
  HYDRA_CENTER_ID,
  SELTHE_ID,
  YSOLEI_ID,
} from '../src/sim/encounters/drowned_temple';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

describe('/dev temple tp: a jump to every boss', () => {
  const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const me = sim.player;
  sim.chat('/dev level 20', me.id);
  sim.chat('/dev temple enter', me.id);
  const inst = claimedInstanceAt(sim.ctx, me.pos);
  if (!inst) throw new Error('no temple claim');
  const bossOf = (templateId: string) => {
    for (const id of inst.mobIds) {
      const e = sim.ctx.entities.get(id);
      if (e?.templateId === templateId) return e;
    }
    throw new Error(`no ${templateId}`);
  };

  for (const [alias, templateId] of [
    ['selthe', SELTHE_ID],
    ['hydra', HYDRA_CENTER_ID],
    ['colossus', COLOSSUS_ID],
    ['ysolei', YSOLEI_ID],
  ] as const) {
    it(`${alias} lands beside ${templateId}, on its floor`, () => {
      sim.chat(`/dev temple tp ${alias}`, me.id);
      const boss = bossOf(templateId);
      expect(Math.hypot(me.pos.x - boss.pos.x, me.pos.z - boss.pos.z)).toBeLessThan(45);
      expect(Math.abs(me.pos.y - boss.pos.y)).toBeLessThan(3);
    });
  }
});
