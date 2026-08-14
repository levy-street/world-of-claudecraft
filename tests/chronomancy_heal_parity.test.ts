// Chronomancy level-20 direct-heal parity (split 2026-08-13 from the single
// chronomancy_balance suite; the rotation fixtures live in
// tests/helpers/chronomancy_harness.ts). Infinite-mana, zero-overheal
// throughput isolates each healer's repeatable level-20 direct heal beside
// Temporal Mend.
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { free } from './helpers/chronomancy_harness';

interface DirectHealMeasure {
  label: string;
  hps: number;
  healPerCast: number;
  healPerMana: number;
  casts: number;
}

const DIRECT_HEAL_CASES: readonly {
  label: string;
  cls: PlayerClass;
  abilityId: string;
}[] = [
  { label: 'Chronomancy Mend', cls: 'mage', abilityId: 'temporal_mend' },
  { label: 'Priest Heal', cls: 'priest', abilityId: 'heal' },
  { label: 'Shaman Healing Wave', cls: 'shaman', abilityId: 'healing_wave' },
  { label: 'Druid Healing Touch', cls: 'druid', abilityId: 'healing_touch' },
  { label: 'Paladin Holy Light', cls: 'paladin', abilityId: 'holy_light' },
];

// Infinite-mana, zero-overheal throughput isolates each healer's repeatable
// level-20 direct heal. It still uses the real spec mastery, auto-equipped gear,
// cast/GCD timing, crit rolls, spell-power coefficient, and event path.
function measureDirectHeal(
  entry: (typeof DIRECT_HEAL_CASES)[number],
  sim: Sim,
): { entry: (typeof DIRECT_HEAL_CASES)[number]; p: Entity } {
  const pid = sim.addPlayer(entry.cls, entry.label, { autoEquip: true });
  sim.setPlayerLevel(20, pid);
  const healerSpec = TALENTS[entry.cls].specs.find((spec) => spec.role === 'healer');
  if (!healerSpec || !sim.setSpec(healerSpec.id, pid))
    throw new Error(`missing healer spec for ${entry.cls}`);
  const p = sim.entities.get(pid);
  const resolved = sim.resolvedAbility(entry.abilityId, pid);
  if (!p || !resolved) throw new Error(`${entry.abilityId} did not resolve for ${healerSpec.id}`);
  p.maxHp = 1_000_000;
  return { entry, p };
}

function measureDirectHeals(seconds = 120): DirectHealMeasure[] {
  const sim = new Sim({ seed: 73, playerClass: 'mage', noPlayer: true });
  const actors = DIRECT_HEAL_CASES.map((entry) => measureDirectHeal(entry, sim));
  sim.tick();
  const totals = new Map<number, { heal: number; manaSpent: number; casts: number }>();
  for (const { p } of actors) totals.set(p.id, { heal: 0, manaSpent: 0, casts: 0 });

  for (let tick = 0; tick < seconds * 20; tick++) {
    for (const { entry, p } of actors) {
      p.hp = 1;
      p.resource = p.maxResource;
      if (!free(p)) continue;
      sim.targetEntity(p.id, p.id);
      sim.castAbility(entry.abilityId, p.id);
      if (p.castingAbility === entry.abilityId) totals.get(p.id)!.casts++;
    }
    const resourcesBeforeTick = new Map(actors.map(({ p }) => [p.id, p.resource]));
    const events = sim.tick();
    for (const { p } of actors) {
      const spent = (resourcesBeforeTick.get(p.id) ?? p.resource) - p.resource;
      if (spent > 0) totals.get(p.id)!.manaSpent += spent;
    }
    for (const event of events) {
      if (event.type !== 'heal2' || event.sourceId !== event.targetId) continue;
      const total = totals.get(event.sourceId);
      if (total) total.heal += event.amount;
    }
  }

  return actors.map(({ entry, p }) => {
    const total = totals.get(p.id)!;
    return {
      label: entry.label,
      hps: total.heal / seconds,
      healPerCast: total.heal / total.casts,
      healPerMana: total.heal / total.manaSpent,
      casts: total.casts,
    };
  });
}

describe('Chronomancy level-20 direct-heal parity', () => {
  const results = measureDirectHeals();

  it('reports real direct-heal throughput beside the other healer classes', () => {
    for (const result of results) {
      expect(result.casts, result.label).toBeGreaterThan(0);
      expect(result.hps, result.label).toBeGreaterThan(0);
      expect(result.healPerCast, result.label).toBeGreaterThan(0);
      expect(result.healPerMana, result.label).toBeGreaterThan(0);
      expect(Number.isFinite(result.healPerMana), result.label).toBe(true);
    }
    const lines = results
      .map(
        (result) =>
          `${result.label.padEnd(22)} HPS=${result.hps.toFixed(1)} heal/cast=${result.healPerCast.toFixed(1)} heal/mana=${result.healPerMana.toFixed(2)} casts=${result.casts}`,
      )
      .join('\n');
    expect(lines.length).toBeGreaterThan(0);
    console.log(`\n[level-20 direct-heal comparison]\n${lines}\n`);
  });

  it('keeps Temporal Mend competitive with the other main direct heals', () => {
    const chrono = results[0];
    const peers = results.slice(1);
    const peerHpsMean = peers.reduce((sum, result) => sum + result.hps, 0) / peers.length;
    for (const peer of peers) {
      expect(chrono.hps, peer.label).toBeGreaterThanOrEqual(peer.hps * 0.9);
      expect(chrono.hps, peer.label).toBeLessThanOrEqual(peer.hps * 1.45);
    }
    expect(chrono.hps).toBeGreaterThanOrEqual(peerHpsMean * 0.9);
    expect(chrono.hps).toBeLessThanOrEqual(peerHpsMean * 1.15);
    // Mend pays some efficiency for its faster two-second cast, but should not
    // fall catastrophically behind even the least efficient cap-ranked peer.
    const leastEfficientPeer = Math.min(...peers.map((peer) => peer.healPerMana));
    expect(chrono.healPerMana).toBeGreaterThanOrEqual(leastEfficientPeer * 0.75);
    for (const peer of peers) {
      expect(chrono.healPerMana, peer.label).toBeLessThan(peer.healPerMana);
    }
  });
});
