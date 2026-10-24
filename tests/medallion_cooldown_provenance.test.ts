import { describe, expect, it } from 'vitest';
import { resolveNameplateCooldowns } from '../src/render/nameplate_cooldown_resolve';
import { newNameplateCooldownsPlan } from '../src/render/nameplate_cooldowns_core';
import { updateTimers } from '../src/sim/combat/auras';
import { restorableCooldown } from '../src/sim/combat/trinket_seams';
import { applyCooldowns, serializeCooldowns } from '../src/sim/cooldown_persist';
import { Sim } from '../src/sim/sim';
import {
  readyArenaFighter,
  restoreArenaReturnPools,
  snapshotArenaReturnPools,
} from '../src/sim/social/arena';
import { endBgMatch, startBgMatch } from '../src/sim/social/battleground';
import { cooldownsReadout } from '../src/sim/social/chat_readouts';
import type { Entity } from '../src/sim/types';

const ITEM = 'medallion_of_defiance';
const GATE = `trinket:${ITEM}`;
const FACT = 'system_medallion_use';
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('missing test state');
  return value;
}
function elapse(e: Entity, seconds: number): void {
  for (let tick = 0; tick < seconds * 20; tick++) updateTimers(e);
}
function wearing(item = ITEM): Sim {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.addItem(item, 1);
  sim.equipItem(item);
  return sim;
}
function row(e: Entity) {
  const plan = newNameplateCooldownsPlan();
  resolveNameplateCooldowns(plan, e, true, 1.5);
  return plan.slots.slice(0, plan.count).filter((slot) => slot.key === GATE);
}

describe('factual successful medallion cooldown lifecycle', () => {
  it('never reads ordinary equip, refused use, or a swapped inherited 90 seconds as use', () => {
    const sim = wearing();
    expect(sim.player.cooldowns.get(GATE)).toBe(30);
    expect(row(sim.player)).toEqual([]);
    sim.useItem(ITEM); // Still locked out: no successful use fact.
    expect(sim.player.cooldowns.has(FACT)).toBe(false);
    expect(row(sim.player)).toEqual([]);

    const swapped = wearing('wayfarers_lodestone');
    elapse(swapped.player, 31);
    swapped.useItem('wayfarers_lodestone');
    elapse(swapped.player, 30);
    swapped.addItem(ITEM, 1);
    swapped.equipItem(ITEM);
    expect(swapped.player.cooldowns.get(GATE)).toBeCloseTo(90);
    expect(swapped.player.cooldowns.has(FACT)).toBe(false);
    expect(row(swapped.player)).toEqual([]);
  });

  it('retains the genuine use fact through swap out/back and expires without inventing another use', () => {
    const sim = wearing();
    elapse(sim.player, 31);
    sim.useItem(ITEM);
    expect(sim.player.cooldowns.get(FACT)).toBe(120);
    elapse(sim.player, 100);
    expect(sim.player.cooldowns.get(FACT)).toBeCloseTo(20);
    expect(row(sim.player)[0]).toMatchObject({ active: false, remaining: 0, timeText: '' });
    sim.addItem('bastion_sigil', 1);
    sim.equipItem('bastion_sigil');
    // An existing larger gate is defensive input: ordinary serial swapping
    // itself cannot mint a second successful use while the inherited gate runs.
    sim.player.cooldowns.set('trinket:bastion_sigil', 180);
    sim.equipItem(ITEM);
    expect(sim.player.cooldowns.get(GATE)).toBe(180);
    expect(sim.player.cooldowns.get(FACT)).toBeCloseTo(20);
    expect(row(sim.player)[0]).toMatchObject({ active: false, remaining: 0, timeText: '' });
    elapse(sim.player, 21);
    expect(sim.player.cooldowns.get(GATE)).toBeGreaterThan(150);
    expect(sim.player.cooldowns.has(FACT)).toBe(false);
    expect(row(sim.player)).toEqual([]); // Remaining unrelated lockout is not an observed medallion use.
  });

  it('saves/restores the fact, clears it with real competitive resets, and treats old state as unknown', () => {
    const sim = wearing();
    elapse(sim.player, 31);
    sim.useItem(ITEM);
    elapse(sim.player, 100);
    const saved = must(sim.serializeCharacter(sim.player.id));
    expect(saved.cooldowns?.abilities?.[FACT]).toBeCloseTo(20);
    const reloaded = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved });
    const restored = must(reloaded.entities.get(pid));
    expect(restored.cooldowns.get(FACT)).toBeCloseTo(20);
    expect(row(restored)[0]).toMatchObject({ active: false, remaining: 0, timeText: '' });
    const pools = snapshotArenaReturnPools(restored);
    const ctx = reloaded.ctx;
    readyArenaFighter(ctx, restored, { clearPrep: true });
    expect(restored.cooldowns.has(FACT)).toBe(false);
    expect(row(restored)).toEqual([]);
    restoreArenaReturnPools(ctx, restored, pools);
    expect(restored.cooldowns.get(FACT)).toBeCloseTo(20);
    expect(row(restored)[0]).toMatchObject({ active: false, remaining: 0, timeText: '' });
    delete must(must(saved.cooldowns).abilities)[FACT];
    const oldPid = reloaded.addPlayer('warrior', 'Unknown', { state: saved });
    expect(must(reloaded.entities.get(oldPid)).cooldowns.get(GATE)).toBeGreaterThan(0);
    expect(row(must(reloaded.entities.get(oldPid)))).toEqual([]);
  });
  it('uses the same timer rate, hides its system identity, and preserves it through battleground return', () => {
    const sim = wearing();
    elapse(sim.player, 31);
    sim.useItem(ITEM);
    sim.player.auras.push({
      id: 'temporal_hourglass',
      name: 'Temporal Hourglass',
      kind: 'stasis',
      remaining: 5,
      duration: 5,
      value: 2,
      sourceId: sim.player.id,
      school: 'arcane',
    });
    updateTimers(sim.player);
    expect(sim.player.cooldowns.get(FACT)).toBeCloseTo(119.9);
    expect(sim.player.cooldowns.get(FACT)).toBe(sim.player.cooldowns.get(GATE));
    expect(cooldownsReadout(sim.player)).not.toContain(FACT);
    const pids = [sim.player.id];
    for (let i = 0; i < 9; i++) {
      const pid = sim.addPlayer('warrior', `Fighter${i}`);
      sim.setPlayerLevel(20, pid);
      pids.push(pid);
    }
    startBgMatch(sim.ctx, pids.slice(0, 5), pids.slice(5));
    const match = must(sim.bgMatchFor(sim.player.id));
    expect(must(match.preMatchPools.get(sim.player.id)).cooldowns.get(FACT)).toBeCloseTo(119.9);
    expect(sim.player.cooldowns.has(FACT)).toBe(false);
    endBgMatch(sim.ctx, match, null, 'forfeit');
    expect(sim.player.cooldowns.get(FACT)).toBeCloseTo(119.9);
    expect(row(sim.player)[0]).toMatchObject({ active: false, remaining: 0, timeText: '' });
  });

  it('rejects malformed facts and tolerates an older writer dropping optional provenance', () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const restored = new Map<string, number>();
      applyCooldowns(
        { abilities: { [FACT]: invalid, [GATE]: 90 } },
        restored,
        0,
        undefined,
        undefined,
        restorableCooldown,
      );
      expect(restored.has(FACT)).toBe(false);
      expect(restored.get(GATE)).toBe(90);
    }
    const sim = wearing();
    elapse(sim.player, 31);
    sim.useItem(ITEM);
    const saved = must(sim.serializeCharacter(sim.player.id));
    const oldMap = new Map<string, number>();
    applyCooldowns(
      saved.cooldowns,
      oldMap,
      0,
      undefined,
      undefined,
      (id) => id !== FACT && restorableCooldown(id),
    );
    saved.cooldowns = serializeCooldowns(oldMap, -1, 0);
    expect(oldMap.get(GATE)).toBe(120);
    expect(oldMap.has(FACT)).toBe(false);
    const newer = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = newer.addPlayer('warrior', 'OldWriter', { state: saved });
    expect(must(newer.entities.get(pid)).cooldowns.get(GATE)).toBe(120);
    expect(row(must(newer.entities.get(pid)))).toEqual([]);
  });

  it('adds at most one fixed fact entry and measures whole-character textual JSON bytes', () => {
    const sim = wearing();
    elapse(sim.player, 31);
    const measure = (label: string) => {
      const snapshot = must(sim.serializeCharacter(sim.player.id));
      const withoutFact = structuredClone(snapshot);
      if (withoutFact.cooldowns?.abilities) delete withoutFact.cooldowns.abilities[FACT];
      const bytes = Buffer.byteLength(JSON.stringify(snapshot));
      const baseBytes = Buffer.byteLength(JSON.stringify(withoutFact));
      const entries = Object.keys(snapshot.cooldowns?.abilities ?? {}).filter(
        (key) => key === FACT,
      ).length;
      expect(entries).toBeLessThanOrEqual(1);
      console.log(
        JSON.stringify({
          label,
          bytes,
          withoutFactBytes: baseBytes,
          factBytes: bytes - baseBytes,
          entries,
        }),
      );
      return bytes - baseBytes;
    };
    expect(measure('unused')).toBe(0);
    sim.useItem(ITEM);
    expect(measure('active')).toBeGreaterThan(24);
    elapse(sim.player, 100);
    expect(measure('near-expiry')).toBeGreaterThan(24);
    elapse(sim.player, 21);
    expect(measure('expired')).toBe(0);
  });
});
