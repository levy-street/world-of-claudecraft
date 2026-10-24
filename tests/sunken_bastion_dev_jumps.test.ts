// The Sunken Bastion playtest jumps (src/sim/dev/sunken_bastion_dev.ts): every
// boss and the Gaol Turnkey has a `/dev bastion tp` name that lands the player
// in its room, on its floor (the Beacon Crown is a raised roof), in sight of it.

import { describe, expect, it } from 'vitest';
import { OLEN_ID, OSSICK_ID, TURNKEY_ID, VAEL_ID } from '../src/sim/encounters/sunken_bastion';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

describe('/dev bastion tp: a jump to every boss', () => {
  const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const me = sim.player;
  sim.chat('/dev level 20', me.id);
  sim.chat('/dev bastion enter', me.id);
  const inst = claimedInstanceAt(sim.ctx, me.pos);
  if (!inst) throw new Error('no bastion claim');
  const bossOf = (templateId: string) => {
    for (const id of inst.mobIds) {
      const e = sim.ctx.entities.get(id);
      if (e?.templateId === templateId) return e;
    }
    throw new Error(`no ${templateId}`);
  };

  for (const [alias, templateId] of [
    ['olen', OLEN_ID],
    ['turnkey', TURNKEY_ID],
    ['ossick', OSSICK_ID],
    ['vael', VAEL_ID],
  ] as const) {
    it(`${alias} lands in ${templateId}'s room, on its floor`, () => {
      sim.chat(`/dev bastion tp ${alias}`, me.id);
      const boss = bossOf(templateId);
      expect(Math.hypot(me.pos.x - boss.pos.x, me.pos.z - boss.pos.z)).toBeLessThan(45);
      expect(Math.abs(me.pos.y - boss.pos.y)).toBeLessThan(3);
    });
  }
});
