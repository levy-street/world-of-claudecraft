// Wing 1 of The Undermount Descent: the Kiln-Keepers duo (Vosh the Glazier +
// Saan the Stoker). The wing clears only when BOTH keepers fall, and killing one
// frenzies the survivor (Kiln Fury), the kill-together tension. Test-first: RED
// until saan_the_stoker and the wing-1 duo spawn list are authored.

import { describe, expect, it } from 'vitest';
import { enterDungeon, instanceKeyFor } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 5): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function metaOf(sim: AnySim, pid: number): any {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no player ${pid}`);
  return r.meta;
}

function claimFor(sim: AnySim, dungeonId: string, pid: number): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.partyKey === instanceKeyFor(sim.ctx, pid),
  );
}

function bossIn(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const boss = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${inst.dungeonId}`);
  return boss as AnyEntity;
}

describe('Kiln-Keepers duo (wing 1)', () => {
  it('spawns both keepers in the wing-1 instance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const inst = claimFor(sim, 'undermount_wing1', pid);
    expect(bossIn(sim, inst, 'vosh_the_glazier')).toBeDefined();
    expect(bossIn(sim, inst, 'saan_the_stoker')).toBeDefined();
  });

  it('clears only when BOTH keepers fall, and the survivor frenzies', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const player = sim.entities.get(pid) as AnyEntity;
    const meta = metaOf(sim, pid);
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const inst = claimFor(sim, 'undermount_wing1', pid);
    const vosh = bossIn(sim, inst, 'vosh_the_glazier');
    const saan = bossIn(sim, inst, 'saan_the_stoker');

    // Kill Vosh first: the wing does NOT clear, and Saan flies into Kiln Fury.
    sim.dealDamage(player, vosh, vosh.hp, false, 'physical', null, 'hit', true);
    expect(vosh.dead).toBe(true);
    expect(meta.undermountCleared.has('undermount_wing1'), 'not cleared on first keeper').toBe(
      false,
    );
    expect(
      saan.auras.some((a: any) => a.id === 'undermount_keeper_frenzy'),
      'survivor frenzied',
    ).toBe(true);

    // Kill Saan: now the wing clears.
    sim.dealDamage(player, saan, saan.hp, false, 'physical', null, 'hit', true);
    expect(saan.dead).toBe(true);
    expect(meta.undermountCleared.has('undermount_wing1'), 'cleared on last keeper').toBe(true);
  });
});
