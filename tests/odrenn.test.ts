// Wing 2 of The Undermount Descent: Odrenn the Temperer (verb: SORT).
// Marks derive from the tempering floor's geography (hot side x > 0 Scorched,
// quench side x < 0 Chilled) with a hysteresis band astride the centerline;
// mixed-mark pairs burn each other in range; the Cinder Arc chain-walks
// raiders standing inside ODRENN_ARC_RADIUS of each other; a permanent
// stacking Tempering buff is the aging clock. Test-first: RED until
// src/sim/encounters/odrenn.ts and the section-1 constants are authored.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { resetOdrennEncounter } from '../src/sim/encounters/odrenn';
import {
  ODRENN_ARC_RADIUS,
  ODRENN_HYSTERESIS_YD,
  ODRENN_MARK_BURN_RADIUS,
} from '../src/sim/encounters/undermount';
import { enterDungeon, heroicLockoutId, instanceKeyFor } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const WING2 = 'undermount_wing2';
const ODRENN = 'odrenn_the_temperer';
const SCORCHED = 'odrenn_scorched';
const CHILLED = 'odrenn_chilled';

function makeSim(seed = 7): AnySim {
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

function hasAura(e: AnyEntity, id: string): boolean {
  return (e.auras as any[]).some((a) => a.id === id);
}

/** Enter wing 2 (pre-clearing wing 1 on the meta), pull Odrenn, return the cast. */
function pullOdrenn(sim: AnySim, playerCount = 2): { boss: AnyEntity; pids: number[] } {
  const pids: number[] = [];
  for (let i = 0; i < playerCount; i++) pids.push(sim.addPlayer('warrior', `R${i}`));
  for (const pid of pids) metaOf(sim, pid).undermountCleared.add('undermount_wing1');
  enterDungeon(sim.ctx, WING2, pids[0]);
  const inst = claimFor(sim, WING2, pids[0]);
  const boss = bossIn(sim, inst, ODRENN);
  // Every raider stands in the arena with a raid-proof HP pool (the mechanics
  // under test are marks, burns, and arcs, not surviving elite melee).
  for (const pid of pids) {
    const p = sim.entities.get(pid) as AnyEntity;
    p.pos = { ...boss.pos };
    p.pos.z = boss.pos.z - 6;
    p.maxHp = 1_000_000;
    p.hp = 1_000_000;
  }
  const puller = sim.entities.get(pids[0]) as AnyEntity;
  sim.ctx.dealDamage(puller, boss, 1, false, 'physical', 'Pull', 'hit', true);
  return { boss, pids };
}

function place(sim: AnySim, pid: number, boss: AnyEntity, dx: number, dz: number): AnyEntity {
  const p = sim.entities.get(pid) as AnyEntity;
  p.pos = { x: boss.spawnPos.x + dx, y: p.pos.y, z: boss.spawnPos.z + dz };
  return p;
}

function ticks(sim: AnySim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('Odrenn the Temperer (wing 2)', () => {
  it('authors the exact guaranteed legs and 0.55 bonus groups', () => {
    const loot = MOBS[ODRENN].loot;
    const guaranteed = loot.filter((entry) => entry.rollGroup === 'undermount_wing2_guaranteed');
    const bonus = loot.filter((entry) => entry.rollGroup === 'undermount_wing2_bonus');
    expect(guaranteed.map((entry) => entry.itemId)).toEqual([
      'crownforged_warleggings',
      'nighttalon_prowlers',
      'soulflame_kilt',
      'stormcallers_legwraps',
    ]);
    expect(guaranteed.reduce((sum, entry) => sum + entry.chance, 0)).toBe(1);
    expect(bonus.map((entry) => [entry.itemId, entry.chance])).toEqual([
      ['the_even_temper', 0.12],
      ['cinderarc_odrenns_rod', 0.12],
      ['twicetempered_girdle', 0.1],
      ['ashwalk_sandals', 0.08],
      ['quenchsilk_cord', 0.07],
      ['slakeleather_belt', 0.06],
    ]);
    expect(bonus.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(0.55);
  });

  it('marks every living raider with exactly one geography mark', () => {
    const sim = makeSim();
    const { boss, pids } = pullOdrenn(sim, 2);
    const hot = place(sim, pids[0], boss, +6, -8);
    const cold = place(sim, pids[1], boss, -6, -8);
    ticks(sim, 3);
    expect(hasAura(hot, SCORCHED)).toBe(true);
    expect(hasAura(hot, CHILLED)).toBe(false);
    expect(hasAura(cold, CHILLED)).toBe(true);
    expect(hasAura(cold, SCORCHED)).toBe(false);
  });

  it('holds the prior mark inside the hysteresis band and flips outside it', () => {
    const sim = makeSim();
    const { boss, pids } = pullOdrenn(sim, 1);
    const p = place(sim, pids[0], boss, +6, -8);
    ticks(sim, 3);
    expect(hasAura(p, SCORCHED)).toBe(true);
    // Step inside the band on the OTHER side of the centerline: mark held.
    place(sim, pids[0], boss, -(ODRENN_HYSTERESIS_YD - 0.5), -8);
    ticks(sim, 3);
    expect(hasAura(p, SCORCHED)).toBe(true);
    expect(hasAura(p, CHILLED)).toBe(false);
    // Step clearly past the band: mark flips.
    place(sim, pids[0], boss, -(ODRENN_HYSTERESIS_YD + 2), -8);
    ticks(sim, 3);
    expect(hasAura(p, CHILLED)).toBe(true);
    expect(hasAura(p, SCORCHED)).toBe(false);
  });

  it('burns mixed-mark pairs in range and never same-mark pairs', () => {
    const sim = makeSim();
    const { boss, pids } = pullOdrenn(sim, 3);
    // a (Scorched) and b (Chilled) stand a mixed pair well inside burn range;
    // c (Scorched) stands next to a: same-mark, never burns.
    const a = place(sim, pids[0], boss, +3, -8);
    const b = place(sim, pids[1], boss, -3, -8);
    const c = place(sim, pids[2], boss, +4, -8);
    ticks(sim, 3);
    const hpA = a.hp;
    const hpC = c.hp;
    ticks(sim, 20); // one second of burn
    expect(a.hp).toBeLessThan(hpA);
    expect(b.hp).toBeLessThan(b.maxHp);
    // c is same-mark with a and out of range of b (across the room from b by
    // less than burn range? place guarantees: c to b distance is 7 > 0, so
    // assert via a control: move b far away and confirm c stops losing hp.
    place(sim, pids[1], boss, -(ODRENN_MARK_BURN_RADIUS + 10), -8);
    ticks(sim, 2);
    const hpC2 = c.hp;
    ticks(sim, 20);
    expect(c.hp).toBe(hpC2);
  });

  it('chain-walks the Cinder Arc to everyone inside arc radius, damage growing', () => {
    const sim = makeSim();
    const { boss, pids } = pullOdrenn(sim, 2);
    // Two raiders one legal jump apart: whichever one the rng seeds, the
    // chain must jump to the other, so BOTH are hit and the second hit is
    // larger by the growth factor.
    const a = place(sim, pids[0], boss, +2, -6);
    const b = place(sim, pids[1], boss, +2 + (ODRENN_ARC_RADIUS - 1), -6);
    ticks(sim, 2);
    const before = [a.hp, b.hp];
    (boss as any).odrenn.arcTimer = 0.01; // force the next arc
    ticks(sim, 1);
    const deltas = [before[0] - a.hp, before[1] - b.hp];
    expect(Math.min(...deltas)).toBeGreaterThan(0); // both were struck
    // One of the two took the grown second jump: the deltas must differ.
    expect(Math.max(...deltas)).toBeGreaterThan(Math.min(...deltas));
  });

  it('refuses Cinder Arc jumps beyond the arc radius', () => {
    const sim = makeSim();
    const { boss, pids } = pullOdrenn(sim, 2);
    // Two raiders far beyond one jump but both in the room: the seed target
    // is struck, the other must NOT be (no long jumps, seed-independent).
    const a = place(sim, pids[0], boss, +2, -6);
    const b = place(sim, pids[1], boss, +2 + 4 * ODRENN_ARC_RADIUS, -6);
    ticks(sim, 2);
    const before = [a.hp, b.hp];
    (boss as any).odrenn.arcTimer = 0.01;
    ticks(sim, 1);
    const struck = [a, b].filter((p, i) => p.hp < before[i]);
    expect(struck.length).toBe(1);
  });

  it('stacks the Tempering aging clock on cadence and resets clean', () => {
    const sim = makeSim();
    const { boss, pids } = pullOdrenn(sim, 1);
    place(sim, pids[0], boss, +5, -8);
    ticks(sim, 2);
    (boss as any).odrenn.enrageTimer = 0.01;
    ticks(sim, 3);
    expect((boss as any).odrenn.enrageStacks).toBe(1);
    expect(hasAura(boss, 'odrenn_temper')).toBe(true);
    // Full reset: marks stripped, module state cleared.
    resetOdrennEncounter(sim.ctx, boss);
    const p = sim.entities.get(pids[0]) as AnyEntity;
    expect(hasAura(p, SCORCHED) || hasAura(p, CHILLED)).toBe(false);
    expect((boss as any).odrenn).toBeUndefined();
  });

  it('heroic entry tunes Odrenn and his kill pays heroic loot and lockout', () => {
    const sim = makeSim(19);
    const pid = sim.addPlayer('warrior', 'Solo');
    const meta = metaOf(sim, pid);
    meta.undermountCleared.add('undermount_wing1');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, WING2, pid);
    const inst = claimFor(sim, WING2, pid);
    const boss = bossIn(sim, inst, ODRENN);
    const player = sim.entities.get(pid) as AnyEntity;
    expect(boss.maxHp).toBeGreaterThan(48000);
    sim.dealDamage(player, boss, boss.hp + 1, false, 'physical', null, 'hit', true);
    const ids = (boss.loot?.items ?? []).map((slot: any) => slot.itemId);
    expect(ids.every((id: string) => id.startsWith('heroic_'))).toBe(true);
    expect(
      ids.filter((id: string) =>
        [
          'heroic_crownforged_warleggings',
          'heroic_nighttalon_prowlers',
          'heroic_soulflame_kilt',
          'heroic_stormcallers_legwraps',
        ].includes(id),
      ),
    ).toHaveLength(1);
    expect(meta.raidLockouts.has(heroicLockoutId(WING2))).toBe(true);
    expect(meta.deedStats.dungeonClears[`${WING2}:heroic`]).toBe(1);
  });

  it('normal Odrenn pays base loot, deed credit, and the normal daily lockout', () => {
    const sim = makeSim(29);
    const pid = sim.addPlayer('warrior', 'Solo');
    const meta = metaOf(sim, pid);
    meta.undermountCleared.add('undermount_wing1');
    enterDungeon(sim.ctx, WING2, pid);
    const inst = claimFor(sim, WING2, pid);
    const boss = bossIn(sim, inst, ODRENN);
    const player = sim.entities.get(pid) as AnyEntity;
    sim.dealDamage(player, boss, boss.hp + 1, false, 'physical', null, 'hit', true);
    const ids = (boss.loot?.items ?? []).map((slot: any) => slot.itemId);
    expect(ids.some((id: string) => id.startsWith('heroic_'))).toBe(false);
    expect(
      ids.filter((id: string) =>
        [
          'crownforged_warleggings',
          'nighttalon_prowlers',
          'soulflame_kilt',
          'stormcallers_legwraps',
        ].includes(id),
      ),
    ).toHaveLength(1);
    expect(meta.deedStats.dungeonClears[WING2]).toBe(1);
    expect(meta.raidLockouts.has(WING2)).toBe(true);
  });
});
