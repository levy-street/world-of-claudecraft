// The capture list for scripts/wiki/render_attack_snapshots.mjs: every named boss attack
// the player wiki prints, with the in-game signal that says the attack is under way.
// Bundled by the driver into a data URL (never imported raw), the same trick
// render_model_stills.mjs uses for the Guide content.
//
// Names are taken from the SAME sources the wiki generators print, so the manifest keys
// match the page text exactly:
// - creature Mechanics lines (scripts/mediawiki/mob_mechanics.ts): the line prefix before
//   the first ". ", which is the mechanic record's own `name`;
// - encounter journals (scripts/mediawiki/encounter_articles.ts): t(nameKey, values) for
//   every phase mechanic, Normal and Heroic.
//
// A cast-bar attack matches on the boss's cast label: either the record's castId, or the
// label's localized display name (targetCastDisplayName, resolved in the page) equal to the
// printed name, case and punctuation folded. An instant attack (aoePulse, stomp) has no
// bar; it matches when its cadence timer resets (the frame it fires).

import { MOBS } from '../../src/sim/data';
import { dungeonJournalSource, RAID_JOURNAL_SOURCE } from '../../src/ui/boss_journal/journal_view';
import { DUNGEON_JOURNALS } from '../../src/ui/boss_journal/registry';
import { t } from '../../src/ui/i18n';
import { mobMechanicLines } from '../mediawiki/mob_mechanics';

export interface AttackTarget {
  /** The name exactly as the wiki prints it. */
  name: string;
  /** Lowercase alphanumeric fold of `name`, the key a cast label is compared on. */
  fold: string;
  /** A cast label (castId) that also means this attack. */
  castId?: string;
  /** An instant attack's cadence timer field on the entity; a reset means it fired. */
  timer?: string;
  /** The windup countdown field a rift-stamped carrier shows the ring under. */
  windup?: string;
  source: 'mechanics' | 'journal';
}

export interface BossTarget {
  mobId: string;
  mobName: string;
  /** The dungeon (or raid) id the boss lives in, when it comes from a journal. */
  dungeonId?: string;
  attacks: AttackTarget[];
}

export const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const CAST_KEYS = ['bigCast', 'deathZoneCast', 'deathZoneStrike', 'breathCone'] as const;
const INSTANT_KEYS: Record<string, { timer: string; windup: string }> = {
  aoePulse: { timer: 'pulseTimer', windup: 'pulseWindupRemaining' },
  stomp: { timer: 'stompTimer', windup: 'stompWindupRemaining' },
};

function add(
  map: Map<string, BossTarget>,
  mobId: string,
  attack: AttackTarget,
  dungeonId?: string,
) {
  const mob = MOBS[mobId];
  if (!mob) return;
  let boss = map.get(mobId);
  if (!boss) {
    boss = { mobId, mobName: mob.name, attacks: [] };
    map.set(mobId, boss);
  }
  if (dungeonId && !boss.dungeonId) boss.dungeonId = dungeonId;
  const prior = boss.attacks.find((a) => a.name === attack.name);
  if (prior) {
    prior.castId ??= attack.castId;
    prior.timer ??= attack.timer;
    prior.windup ??= attack.windup;
    return;
  }
  boss.attacks.push(attack);
}

export function attackTargets(): BossTarget[] {
  const map = new Map<string, BossTarget>();
  // Encounter journals first, so a journal boss carries its dungeon id.
  for (const def of DUNGEON_JOURNALS) {
    const source = dungeonJournalSource(def);
    for (const key of source.bossKeys) {
      for (const tier of ['normal', 'heroic'] as const) {
        const view = source.view(key, tier);
        for (const phase of view.phases)
          for (const m of phase.mechanics) {
            const name = t(m.nameKey, m.values as never);
            add(map, view.mobId, { name, fold: fold(name), source: 'journal' }, def.dungeonId);
          }
      }
    }
  }
  for (const key of RAID_JOURNAL_SOURCE.bossKeys) {
    for (const tier of ['normal', 'heroic'] as const) {
      const view = RAID_JOURNAL_SOURCE.view(key, tier);
      for (const phase of view.phases)
        for (const m of phase.mechanics) {
          const name = t(m.nameKey, m.values as never);
          add(map, view.mobId, { name, fold: fold(name), source: 'journal' }, 'raid');
        }
    }
  }
  // Creature Mechanics lines: the named attacks a player can see land, on bosses and
  // elites only (a plain mob's attack is not a boss attack).
  for (const [mobId, mob] of Object.entries(MOBS)) {
    if (!mob.boss && !mob.elite) continue;
    const printed = new Set(mobMechanicLines(mob).map((line) => line.split('. ')[0]));
    const rec = mob as unknown as Record<string, { name?: string; castId?: string } | undefined>;
    for (const key of CAST_KEYS) {
      const v = rec[key];
      if (!v?.name || !printed.has(v.name)) continue;
      add(map, mobId, { name: v.name, fold: fold(v.name), castId: v.castId, source: 'mechanics' });
    }
    for (const [key, fields] of Object.entries(INSTANT_KEYS)) {
      const v = rec[key];
      if (!v?.name || !printed.has(v.name)) continue;
      add(map, mobId, { name: v.name, fold: fold(v.name), ...fields, source: 'mechanics' });
    }
  }
  return [...map.values()].filter((b) => b.attacks.length > 0);
}
