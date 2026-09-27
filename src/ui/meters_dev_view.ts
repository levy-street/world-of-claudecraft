// Developer and Combat Balance Analysis View.
// Aggregates ability metrics across all raid members or mobs to detect
// overtuned or undertuned abilities during raid/dungeon testing.

import type { Encounter } from './meters';

export interface AbilityBalanceStat {
  ability: string;
  totalDamage: number;
  totalHealing: number;
  casts: number;
  hits: number;
  crits: number;
  critRate: number;
  avgHit: number;
  avgCrit: number;
  minHit: number;
  maxHit: number;
  avgTargetsPerCast: number;
  dpsContribution: number;
}

export function buildAbilityBalanceStats(enc: Encounter): AbilityBalanceStat[] {
  let totalRaidDamage = 0;
  for (const t of enc.tallies.values()) {
    totalRaidDamage += t.dmg;
  }

  const map = new Map<
    string,
    {
      totalDamage: number;
      totalHealing: number;
      casts: number;
      hits: number;
      crits: number;
      hitTotal: number;
      critTotal: number;
      minHit: number;
      maxHit: number;
    }
  >();

  for (const t of enc.tallies.values()) {
    for (const entry of t.dmgByAbility.values()) {
      const name = entry.ability || 'Attack';
      let stat = map.get(name);
      if (!stat) {
        stat = {
          totalDamage: 0,
          totalHealing: 0,
          casts: 0,
          hits: 0,
          crits: 0,
          hitTotal: 0,
          critTotal: 0,
          minHit: Infinity,
          maxHit: 0,
        };
        map.set(name, stat);
      }
      stat.totalDamage += entry.amount;
      stat.casts += entry.casts ?? Math.max(1, entry.hits ?? 1);
      const hits = entry.hits ?? 1;
      const crits = entry.crits ?? 0;
      stat.hits += hits;
      stat.crits += crits;
      stat.critTotal += (entry as any).critTotal ?? (crits > 0 ? (entry.amount / hits) * crits : 0);
      stat.hitTotal += (entry as any).hitTotal ?? entry.amount - stat.critTotal;
      if (entry.minHit !== undefined && entry.minHit < stat.minHit) stat.minHit = entry.minHit;
      if (entry.maxHit !== undefined && entry.maxHit > stat.maxHit) stat.maxHit = entry.maxHit;
    }
  }

  const results: AbilityBalanceStat[] = [];
  for (const [ability, s] of map) {
    const nonCritHits = Math.max(1, s.hits - s.crits);
    const avgHit = Math.round((s.totalDamage - s.critTotal) / nonCritHits);
    const avgCrit = s.crits > 0 ? Math.round(s.critTotal / s.crits) : 0;
    const critRate = s.hits > 0 ? (s.crits / s.hits) * 100 : 0;
    const avgTargetsPerCast = s.casts > 0 ? Math.round((s.hits / s.casts) * 100) / 100 : 1;
    const dpsContribution = totalRaidDamage > 0 ? (s.totalDamage / totalRaidDamage) * 100 : 0;

    results.push({
      ability,
      totalDamage: s.totalDamage,
      totalHealing: s.totalHealing,
      casts: s.casts,
      hits: s.hits,
      crits: s.crits,
      critRate: Math.round(critRate * 10) / 10,
      avgHit: Math.max(0, avgHit),
      avgCrit,
      minHit: s.minHit === Infinity ? 0 : s.minHit,
      maxHit: s.maxHit,
      avgTargetsPerCast,
      dpsContribution: Math.round(dpsContribution * 10) / 10,
    });
  }

  // Sort descending by total damage
  results.sort((a, b) => b.totalDamage - a.totalDamage);
  return results;
}
