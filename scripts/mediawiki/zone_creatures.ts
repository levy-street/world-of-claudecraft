import { getActiveWorldContent, MOBS, zoneContaining } from '../../src/sim/data';
import type { MobTemplate } from '../../src/sim/types';
import { type CreatureRole, creatureRole } from './creature_role';

/** One kind of creature that lives in a zone's camps, with the levels it spawns at there. */
export interface ZoneCreature {
  mobId: string;
  name: string;
  min: number;
  max: number;
  /** How many of it the zone's camps hold in total. */
  count: number;
  role: CreatureRole;
}

/** The rank headings the Enemies hub already uses, so a zone list reads the same way. */
export const RANK_ORDER = ['Bosses', 'Rare enemies', 'Elites', 'Normal enemies'] as const;
export type RankLabel = (typeof RANK_ORDER)[number];

export function mobRank(m: MobTemplate): RankLabel {
  return m.boss ? 'Bosses' : m.rare ? 'Rare enemies' : m.elite ? 'Elites' : 'Normal enemies';
}

/** A short rank word for a list line; normal enemies say nothing. */
export function rankWord(m: MobTemplate): string {
  if (m.boss) return 'Boss';
  if (m.rare && m.elite) return 'Rare elite';
  if (m.rare) return 'Rare';
  if (m.elite) return 'Elite';
  return '';
}

export function levelText(min: number, max: number): string {
  return min === max ? 'Level ' + min : 'Level ' + min + ' to ' + max;
}

let cache: Map<string, ZoneCreature[]> | undefined;

/**
 * Every creature camp in the built-in world, grouped by the zone its center stands in.
 * The camp's own level range wins over the creature's default, the same rule the
 * creature pages use, so a zone page and a creature page never disagree.
 */
export function creaturesByZone(): Map<string, ZoneCreature[]> {
  if (cache) return cache;
  const zones = new Map<string, Map<string, ZoneCreature>>();
  for (const c of getActiveWorldContent().camps) {
    const m = MOBS[c.mobId];
    const zone = zoneContaining(c.center.x, c.center.z);
    if (!m || !zone) continue;
    const byMob = zones.get(zone.id) ?? new Map<string, ZoneCreature>();
    const min = c.levelMin ?? m.minLevel;
    const max = c.levelMax ?? m.maxLevel;
    const seen = byMob.get(m.id);
    if (seen) {
      seen.min = Math.min(seen.min, min);
      seen.max = Math.max(seen.max, max);
      seen.count += c.count;
    } else
      byMob.set(m.id, {
        mobId: m.id,
        name: m.name,
        min,
        max,
        count: c.count,
        role: creatureRole(m.id),
      });
    zones.set(zone.id, byMob);
  }
  cache = new Map(
    [...zones].map(([id, byMob]) => [
      id,
      [...byMob.values()].sort(
        (a, b) => a.min - b.min || a.max - b.max || a.name.localeCompare(b.name, 'en'),
      ),
    ]),
  );
  return cache;
}

export function zoneCreatures(zoneId: string): ZoneCreature[] {
  return creaturesByZone().get(zoneId) ?? [];
}
