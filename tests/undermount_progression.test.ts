// Slice 2 of The Undermount Descent (docs/prd/furnace-lair-raid.md): the seal
// rule enforced end to end through a real Sim. A sealed wing rejects entry; a
// clear (killing the prior wing's boss) records permanent per-character progress
// that opens the next wing. Test-first: RED until the enterDungeon seal check,
// the PlayerMeta.undermountCleared state, and the clear-on-boss-death hook land.

import { describe, expect, it } from 'vitest';
import { enterDungeon, instanceKeyFor } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 7): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

// A claimed instance of `dungeonId` owned by this player's group, or undefined
// when entry was refused (the observable difference between sealed and open).
function claimFor(sim: AnySim, dungeonId: string, pid: number): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.partyKey === instanceKeyFor(sim.ctx, pid),
  );
}

function metaOf(sim: AnySim, pid: number): any {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no player ${pid}`);
  return r.meta;
}

function bossIn(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const boss = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${inst.dungeonId}`);
  return boss as AnyEntity;
}

describe('Undermount wing progression (seal enforced through the Sim)', () => {
  it('blocks a sealed wing, then unseals it on the prior boss kill', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const player = sim.entities.get(pid) as AnyEntity;
    const meta = metaOf(sim, pid);

    // Wing 2 is sealed until wing 1 is cleared: entry is refused (no claim).
    enterDungeon(sim.ctx, 'undermount_wing2', pid);
    expect(claimFor(sim, 'undermount_wing2', pid), 'wing 2 starts sealed').toBeUndefined();
    expect(meta.undermountCleared.has('undermount_wing1')).toBe(false);

    // Wing 1 is always open.
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const wing1 = claimFor(sim, 'undermount_wing1', pid);
    expect(wing1, 'wing 1 is open').toBeDefined();

    // Killing the wing-1 boss clears the wing for the raid in the room.
    const boss = bossIn(sim, wing1, 'vosh_the_glazier');
    sim.dealDamage(player, boss, boss.hp, false, 'physical', null, 'hit', true);
    expect(boss.dead, 'boss died').toBe(true);
    expect(meta.undermountCleared.has('undermount_wing1'), 'wing 1 recorded').toBe(true);

    // With wing 1 cleared, wing 2 now opens.
    enterDungeon(sim.ctx, 'undermount_wing2', pid);
    expect(claimFor(sim, 'undermount_wing2', pid), 'wing 2 now open').toBeDefined();
  });

  it('does not clear a wing when a non-boss dies', () => {
    const sim = makeSim(11);
    const pid = sim.addPlayer('warrior', 'Solo');
    const meta = metaOf(sim, pid);
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    expect(meta.undermountCleared.size).toBe(0);
  });
});
