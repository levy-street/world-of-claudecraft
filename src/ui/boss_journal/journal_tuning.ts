// Per-difficulty numbers for the dungeon journals, resolved through the sim's
// own difficulty stamp (instances/difficulty.ts applyDungeonMobTuning) so the
// journal never retypes a multiplier: encounter mechanics roll their authored
// NORMAL range and scale it by the mob's mechanicDamageMult at fire time
// (encounters/sunken_bastion/claim.ts mechanicDamage), and this reads that same
// factor off a scratch mob.

import { MOBS } from '../../sim/data';
import { applyDungeonMobTuning } from '../../sim/instances/difficulty';
import type { Entity } from '../../sim/types';
import type { JournalDifficulty, JournalValues } from './journal_view';

/** The mechanic damage factor one difficulty stamps on this mob. */
export function mechanicFactor(
  dungeonId: string,
  mobId: string,
  difficulty: JournalDifficulty,
): number {
  const probe = { templateId: mobId } as Entity;
  applyDungeonMobTuning(probe, dungeonId, difficulty);
  return probe.mechanicDamageMult ?? 1;
}

/** How many times harder the mob's mechanics land on Heroic than on Normal. */
export function heroicMechanicScale(dungeonId: string, mobId: string): number {
  return mechanicFactor(dungeonId, mobId, 'heroic') / mechanicFactor(dungeonId, mobId, 'normal');
}

/** A mechanic's landed range per difficulty, as `min`/`max` values (plus any
 *  extra per-tier values). Rounded like the fire site rounds each roll. */
export function tierDamage(
  dungeonId: string,
  mobId: string,
  min: number,
  max: number,
  extra?: Readonly<Record<JournalDifficulty, JournalValues>>,
): Readonly<Record<JournalDifficulty, JournalValues>> {
  const at = (difficulty: JournalDifficulty): JournalValues => {
    const f = mechanicFactor(dungeonId, mobId, difficulty);
    return {
      min: Math.max(1, Math.round(min * f)),
      max: Math.max(1, Math.round(max * f)),
      ...(extra?.[difficulty] ?? {}),
    };
  };
  return { normal: at('normal'), heroic: at('heroic') };
}

/** One value per difficulty, scaled the same way (a damage per second). */
export function tierScaled(
  dungeonId: string,
  mobId: string,
  name: string,
  amount: number,
): Readonly<Record<JournalDifficulty, JournalValues>> {
  const at = (difficulty: JournalDifficulty): JournalValues => ({
    [name]: Math.max(1, Math.round(amount * mechanicFactor(dungeonId, mobId, difficulty))),
  });
  return { normal: at('normal'), heroic: at('heroic') };
}

/** Per-tier values that do not scale (a cadence or a count that changes). */
export function tierFixed(
  normal: JournalValues,
  heroic: JournalValues,
): Readonly<Record<JournalDifficulty, JournalValues>> {
  return { normal, heroic };
}

/** A template's kept enrage (MobTemplate.enrage): its health line and its
 *  extra damage and attack speed as shares (0.5 = 50 percent more). */
export function templateEnrage(mobId: string): { health: number; damage: number; haste: number } {
  const enrage = MOBS[mobId]?.enrage;
  return {
    health: enrage?.belowHpPct ?? 0,
    damage: (enrage?.dmgMult ?? 1) - 1,
    haste: (enrage?.hasteMult ?? 1) - 1,
  };
}
