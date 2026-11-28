// Which Adventure Journal icon a boss's cast bar wears (the target cast bar's
// lookup). The bar shows the caster's raw `castingAbility` id; every journal page
// names the sim cast id behind each mechanic's bar (`castId`), and the bodies that
// cast them (the page's bodies, its `hitSources` and its `castSources`). This
// module walks the journal's own catalog (every page, both tiers) into one index
// of (caster's mob template, cast id) to the mechanic's `iconId`, the sibling of
// journal_hit_icons.ts. A cast matches only on the page whose body cast it, so a
// player or a trash mob whose cast shares an id never borrows a boss's icon.
// `journalCastArtUrl` answers only painted boss art (boss_ability_art.ts): a
// journal id still on its procedural recipe leaves the bar's icon slot empty, as
// it was before the raid's paintings.
// Pure: no DOM, no world read; the index is built once, on first use.

import { bossAbilityImageUrl } from '../../boss_ability_art';
import type { JournalSource } from '../../boss_journal/journal_view';
import { JOURNAL_INSTANCES } from './journal_catalog';

/** caster mob template -> cast id -> journal icon id. */
export type JournalCastIndex = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** One cast a caster maps to two different icons (a data error the tests pin). */
export interface JournalCastConflict {
  source: string;
  castId: string;
  icons: readonly string[];
}

const TIERS = ['normal', 'heroic'] as const;

/** Build the index over journal sources (both tiers, so a Heroic-only
 *  mechanic counts), reporting every conflicting cast. */
export function buildJournalCastIndex(sources: readonly JournalSource[]): {
  index: JournalCastIndex;
  conflicts: JournalCastConflict[];
} {
  const index = new Map<string, Map<string, string>>();
  const clash = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const bossKey of source.bossKeys) {
      for (const tier of TIERS) {
        const view = source.view(bossKey, tier);
        const casters = [
          ...(view.members ?? [view.mobId]),
          ...(view.hitSources ?? []),
          ...(view.castSources ?? []),
        ];
        for (const phase of view.phases) {
          for (const mechanic of phase.mechanics) {
            const castId = mechanic.castId;
            if (!castId) continue;
            for (const caster of casters) {
              let byCast = index.get(caster);
              if (!byCast) {
                byCast = new Map();
                index.set(caster, byCast);
              }
              const had = byCast.get(castId);
              if (had === undefined) byCast.set(castId, mechanic.iconId);
              else if (had !== mechanic.iconId) {
                const key = `${caster}\u0000${castId}`;
                const icons = clash.get(key) ?? new Set([had]);
                icons.add(mechanic.iconId);
                clash.set(key, icons);
              }
            }
          }
        }
      }
    }
  }
  const conflicts = [...clash].map(([key, icons]) => {
    const [source, castId] = key.split('\u0000');
    return { source, castId, icons: [...icons] };
  });
  return { index, conflicts };
}

/** The icon for `castId` cast by `caster` in `index`, else null. */
export function journalCastIconIn(
  index: JournalCastIndex,
  caster: string | null | undefined,
  castId: string | null | undefined,
): string | null {
  if (!caster || !castId) return null;
  return index.get(caster)?.get(castId) ?? null;
}

let cached: JournalCastIndex | null = null;

/** The whole journal's index (every catalog instance, released or not). */
export function journalCastIndex(): JournalCastIndex {
  if (!cached) cached = buildJournalCastIndex(JOURNAL_INSTANCES.map((i) => i.source)).index;
  return cached;
}

/** The journal icon of a boss cast: the caster's mob template id and its cast
 *  id, or null when no journal page names that cast for that caster. */
export function journalCastIconId(
  caster: string | null | undefined,
  castId: string | null | undefined,
): string | null {
  return journalCastIconIn(journalCastIndex(), caster, castId);
}

/** The painted icon URL a boss cast bar shows, or null (no journal cast, or a
 *  journal id with no painting): the cast bar's icon slot reads only this. */
export function journalCastArtUrl(
  caster: string | null | undefined,
  castId: string | null | undefined,
): string | null {
  const iconId = journalCastIconId(caster, castId);
  return iconId ? bossAbilityImageUrl(iconId) : null;
}
