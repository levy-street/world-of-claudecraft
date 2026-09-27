// Encounter Data Export (Text & JSON).
// Supports Warcraft Logs / Details style text summaries for Discord/chat sharing,
// and structured JSON with schemaVersion for offline developer balancing.

import type { Encounter } from './meters';
import { fmtDuration, fmtNum, fmtPerSecond } from './meters_format';

export const EXPORT_SCHEMA_VERSION = 1;

export function exportEncounterAsText(enc: Encounter): string {
  const dur = Math.max(1, enc.duration);
  const lines: string[] = [];

  lines.push(`${enc.label || 'Combat Encounter'}`);
  lines.push(`Duration: ${fmtDuration(dur)}`);
  lines.push('');

  // Damage Done
  const dmgPlayers = [...enc.tallies.values()]
    .filter((t) => t.dmg > 0)
    .sort((a, b) => b.dmg - a.dmg);
  const totalDmg = dmgPlayers.reduce((sum, t) => sum + t.dmg, 0);

  if (dmgPlayers.length > 0) {
    lines.push('Damage Done:');
    dmgPlayers.forEach((t, i) => {
      const dps = t.dmg / dur;
      const share = totalDmg > 0 ? (t.dmg / totalDmg) * 100 : 0;
      lines.push(
        `${i + 1}. ${t.name} - ${fmtNum(t.dmg)} - ${fmtPerSecond(dps)} - ${share.toFixed(1)}%`,
      );
    });
    lines.push('');
  }

  // Healing Done
  const healPlayers = [...enc.tallies.values()]
    .filter((t) => t.heal > 0)
    .sort((a, b) => b.heal - a.heal);
  const totalHeal = healPlayers.reduce((sum, t) => sum + t.heal, 0);

  if (healPlayers.length > 0) {
    lines.push('Healing Done:');
    healPlayers.forEach((t, i) => {
      const hps = t.heal / dur;
      const share = totalHeal > 0 ? (t.heal / totalHeal) * 100 : 0;
      lines.push(
        `${i + 1}. ${t.name} - ${fmtNum(t.heal)} - ${fmtPerSecond(hps)} - ${share.toFixed(1)}%`,
      );
    });
    lines.push('');
  }

  // Deaths
  const deaths = [...enc.tallies.values()]
    .filter((t) => t.deaths > 0)
    .sort((a, b) => b.deaths - a.deaths);
  if (deaths.length > 0) {
    lines.push('Deaths:');
    deaths.forEach((t) => {
      lines.push(`- ${t.name}: ${t.deaths}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function exportEncounterAsJson(enc: Encounter): string {
  const dur = Math.max(1, enc.duration);

  const players = [...enc.tallies.values()].map((t) => {
    const abilitiesDmg = [...t.dmgByAbility.values()].map((a) => ({
      ability: a.ability || 'Attack',
      petName: a.petName ?? null,
      amount: a.amount,
      hits: a.hits ?? 1,
      crits: a.crits ?? 0,
      minHit: a.minHit ?? a.amount,
      maxHit: a.maxHit ?? a.amount,
      targets: a.targets ? Object.fromEntries(a.targets.entries()) : {},
    }));

    const abilitiesHeal = [...t.healByAbility.values()].map((a) => ({
      ability: a.ability || 'Heal',
      petName: a.petName ?? null,
      amount: a.amount,
      overheal: a.overheal ?? 0,
      absorbed: a.absorbed ?? 0,
      hits: a.hits ?? 1,
      crits: a.crits ?? 0,
    }));

    const abilitiesDmgTaken = [...t.dmgTakenByAbility.values()].map((a) => ({
      ability: a.ability || 'Attack',
      amount: a.amount,
      hits: a.hits ?? 1,
      sources: a.sources ? Object.fromEntries(a.sources.entries()) : {},
    }));

    return {
      pid: t.pid,
      name: t.name,
      class: t.cls,
      damage: t.dmg,
      dmg: t.dmg,
      dps: Math.round(t.dmg / dur),
      healing: t.heal,
      heal: t.heal,
      hps: Math.round(t.heal / dur),
      damageTaken: t.dmgTaken,
      absorbed: t.absorbed,
      interrupts: t.interrupts,
      deaths: t.deaths,
      hits: t.hits,
      crits: t.crits,
      abilitiesDamage: abilitiesDmg,
      abilitiesHealing: abilitiesHeal,
      abilitiesDamageTaken: abilitiesDmgTaken,
    };
  });

  const payload = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    encounter: {
      label: enc.label,
      startedAt: enc.startedAt,
      duration: Math.round(dur),
      mainMobName: enc.mainMobName,
      phases: enc.phases.allPhases,
    },
    players,
  };

  return JSON.stringify(payload, null, 2);
}
