// Fight Comparison core for combat segments.
// Compares two boss attempts or pulls across raid metrics (DPS, HPS, Deaths, Avoidable Dmg)
// and per-player contributions.

import type { Encounter, MemberTally } from './meters';
import { fmtDuration, fmtNum, fmtPerSecond } from './meters_format';

export interface ComparisonMetricDiff {
  name: string;
  valA: number;
  valB: number;
  diff: number;
  diffPct: number;
  strA: string;
  strB: string;
  diffStr: string;
  better: 'A' | 'B' | 'neutral';
}

export interface PlayerComparisonRow {
  name: string;
  cls: string | null;
  dpsA: number;
  dpsB: number;
  dpsDiff: number;
  dpsDiffPct: number;
  dmgA: number;
  dmgB: number;
  hpsA: number;
  hpsB: number;
  deathsA: number;
  deathsB: number;
  avoidableA: number;
  avoidableB: number;
}

export interface FightComparisonModel {
  labelA: string;
  labelB: string;
  durationA: number;
  durationB: number;
  metrics: ComparisonMetricDiff[];
  players: PlayerComparisonRow[];
}

function calcDiff(
  name: string,
  valA: number,
  valB: number,
  formatVal: (n: number) => string,
  lowerIsBetter: boolean = false,
): ComparisonMetricDiff {
  const diff = valB - valA;
  const diffPct = valA > 0 ? (diff / valA) * 100 : 0;
  const sign = diff > 0 ? '+' : '';
  const diffStr = `${sign}${formatVal(diff)} (${sign}${diffPct.toFixed(1)}%)`;

  let better: 'A' | 'B' | 'neutral' = 'neutral';
  if (diff !== 0) {
    if (lowerIsBetter) {
      better = diff < 0 ? 'B' : 'A';
    } else {
      better = diff > 0 ? 'B' : 'A';
    }
  }

  return {
    name,
    valA,
    valB,
    diff,
    diffPct,
    strA: formatVal(valA),
    strB: formatVal(valB),
    diffStr: diff === 0 ? '0' : diffStr,
    better,
  };
}

export function compareEncounters(encA: Encounter, encB: Encounter): FightComparisonModel {
  const durA = Math.max(1, encA.duration);
  const durB = Math.max(1, encB.duration);

  let raidDmgA = 0;
  let raidHealA = 0;
  let raidTakenA = 0;
  let raidAvoidableA = 0;
  let raidDeathsA = 0;

  for (const t of encA.tallies.values()) {
    raidDmgA += t.dmg;
    raidHealA += t.heal;
    raidTakenA += t.dmgTaken;
    raidAvoidableA += t.avoidableDmg ?? 0;
    raidDeathsA += t.deaths;
  }

  let raidDmgB = 0;
  let raidHealB = 0;
  let raidTakenB = 0;
  let raidAvoidableB = 0;
  let raidDeathsB = 0;

  for (const t of encB.tallies.values()) {
    raidDmgB += t.dmg;
    raidHealB += t.heal;
    raidTakenB += t.dmgTaken;
    raidAvoidableB += t.avoidableDmg ?? 0;
    raidDeathsB += t.deaths;
  }

  const dpsA = raidDmgA / durA;
  const dpsB = raidDmgB / durB;
  const hpsA = raidHealA / durA;
  const hpsB = raidHealB / durB;

  const metrics: ComparisonMetricDiff[] = [
    calcDiff('Duration', durA, durB, (s) => fmtDuration(Math.abs(s)), true),
    calcDiff('Raid Damage', raidDmgA, raidDmgB, fmtNum),
    calcDiff('Raid DPS', dpsA, dpsB, fmtPerSecond),
    calcDiff('Raid Healing', raidHealA, raidHealB, fmtNum),
    calcDiff('Raid HPS', hpsA, hpsB, fmtPerSecond),
    calcDiff('Damage Taken', raidTakenA, raidTakenB, fmtNum, true),
    calcDiff('Avoidable Dmg', raidAvoidableA, raidAvoidableB, fmtNum, true),
    calcDiff('Deaths', raidDeathsA, raidDeathsB, (n) => String(Math.abs(n)), true),
  ];

  // Merge all players by name
  const playerMap = new Map<
    string,
    { tallyA?: MemberTally; tallyB?: MemberTally; cls: string | null }
  >();
  for (const t of encA.tallies.values()) {
    playerMap.set(t.name, { tallyA: t, cls: t.cls });
  }
  for (const t of encB.tallies.values()) {
    const existing = playerMap.get(t.name);
    if (existing) {
      existing.tallyB = t;
      if (!existing.cls) existing.cls = t.cls;
    } else {
      playerMap.set(t.name, { tallyB: t, cls: t.cls });
    }
  }

  const players: PlayerComparisonRow[] = [];
  for (const [name, data] of playerMap) {
    const pDpsA = (data.tallyA?.dmg ?? 0) / durA;
    const pDpsB = (data.tallyB?.dmg ?? 0) / durB;
    const diff = pDpsB - pDpsA;
    const diffPct = pDpsA > 0 ? (diff / pDpsA) * 100 : 0;

    players.push({
      name,
      cls: data.cls,
      dpsA: pDpsA,
      dpsB: pDpsB,
      dpsDiff: diff,
      dpsDiffPct: diffPct,
      dmgA: data.tallyA?.dmg ?? 0,
      dmgB: data.tallyB?.dmg ?? 0,
      hpsA: (data.tallyA?.heal ?? 0) / durA,
      hpsB: (data.tallyB?.heal ?? 0) / durB,
      deathsA: data.tallyA?.deaths ?? 0,
      deathsB: data.tallyB?.deaths ?? 0,
      avoidableA: data.tallyA?.avoidableDmg ?? 0,
      avoidableB: data.tallyB?.avoidableDmg ?? 0,
    });
  }

  // Sort descending by highest DPS in B
  players.sort((a, b) => b.dpsB - a.dpsB);

  return {
    labelA: encA.label,
    labelB: encB.label,
    durationA: durA,
    durationB: durB,
    metrics,
    players,
  };
}
