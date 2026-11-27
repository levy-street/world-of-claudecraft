// Which Adventure Journal icon a boss's hit wears (the death recap's lookup).
// A boss mechanic reaches the client as a `damage` event whose `ability` is the
// sim's display label and whose `abilityId` is absent, so its ability icon would
// fall back to the generic swing. Every journal page names the labels each of
// its mechanics deals (`hits`, read from the encounter's own name tables), and
// the bodies that deal them (the page's bodies plus `hitSources`): this module
// walks the journal's own catalog (every page it shows, both tiers) into one
// index of (dealer's mob template, label) to the mechanic's `iconId`. A hit
// matches only on the page whose body dealt it, so a trash mob, a pet or a
// player ability that shares a name never borrows a boss's icon.
// Pure: no DOM, no world read; the index is built once, on first use.

import type { JournalSource } from '../../boss_journal/journal_view';
import { JOURNAL_INSTANCES } from './journal_catalog';

/** dealer mob template -> damage label -> journal icon id. */
export type JournalHitIndex = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** One label a dealer maps to two different icons (a data error the tests pin). */
export interface JournalHitConflict {
  source: string;
  label: string;
  icons: readonly string[];
}

const TIERS = ['normal', 'heroic'] as const;

/** Build the index over journal sources (both tiers, so a Heroic-only
 *  mechanic counts), reporting every conflicting label. */
export function buildJournalHitIndex(sources: readonly JournalSource[]): {
  index: JournalHitIndex;
  conflicts: JournalHitConflict[];
} {
  const index = new Map<string, Map<string, string>>();
  const clash = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const bossKey of source.bossKeys) {
      for (const tier of TIERS) {
        const view = source.view(bossKey, tier);
        const dealers = [...(view.members ?? [view.mobId]), ...(view.hitSources ?? [])];
        for (const phase of view.phases) {
          for (const mechanic of phase.mechanics) {
            for (const label of mechanic.hits ?? []) {
              for (const dealer of dealers) {
                let byLabel = index.get(dealer);
                if (!byLabel) {
                  byLabel = new Map();
                  index.set(dealer, byLabel);
                }
                const had = byLabel.get(label);
                if (had === undefined) byLabel.set(label, mechanic.iconId);
                else if (had !== mechanic.iconId) {
                  const key = `${dealer}\u0000${label}`;
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
  }
  const conflicts = [...clash].map(([key, icons]) => {
    const [source, label] = key.split('\u0000');
    return { source, label, icons: [...icons] };
  });
  return { index, conflicts };
}

/** The icon for `label` dealt by `dealer` in `index`, else null. */
export function journalHitIconIn(
  index: JournalHitIndex,
  label: string | null | undefined,
  dealer: string | null | undefined,
): string | null {
  if (!label || !dealer) return null;
  return index.get(dealer)?.get(label) ?? null;
}

let cached: JournalHitIndex | null = null;

/** The whole journal's index (every catalog instance, released or not). */
export function journalHitIndex(): JournalHitIndex {
  if (!cached) cached = buildJournalHitIndex(JOURNAL_INSTANCES.map((i) => i.source)).index;
  return cached;
}

/** The journal icon of a boss hit: its damage label and the dealer's mob
 *  template id, or null when no journal page names that hit. */
export function journalHitIconId(
  label: string | null | undefined,
  dealer: string | null | undefined,
): string | null {
  return journalHitIconIn(journalHitIndex(), label, dealer);
}
