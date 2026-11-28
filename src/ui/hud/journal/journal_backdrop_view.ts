// The Adventure Journal's banner backdrops: a darkened picture of the room a
// fight happens in, set behind a boss page's banner. Each picture is a real
// in-game frame of that arena, cropped and committed as a small WebP under
// public/ui/journal/ (raw logical path, outside the media manifest). Optional
// per instance (every page of it) or per boss (that page only, winning over
// the instance's); a page with neither keeps the plain banner. Cosmetic only:
// the banner's words read the same with or without a picture.
//
// Pure: a static table and a lookup, no DOM and no world read. Pinned both
// ways against the committed files by tests/adventure_journal_backdrops.test.ts.

import { SMITH_HEART_DUNGEON } from '../../../sim/content/smith_heart';

/** Where the committed backdrops live (served at this raw path). */
export const JOURNAL_BACKDROP_DIR = '/ui/journal/';

interface JournalBackdropSet {
  /** Every page of the instance, unless a boss has its own. */
  instance?: string;
  /** One picture per journal boss key (the page's lead mob id). */
  bosses?: Readonly<Record<string, string>>;
}

// File names only; the directory is prepended on lookup.
const BACKDROPS: Readonly<Record<string, JournalBackdropSet>> = {
  [SMITH_HEART_DUNGEON]: {
    bosses: {
      heart_hammer_guardian: 'smith_heart_council.webp',
      heart_breath_guardian: 'smith_heart_breath.webp',
      heart_quench_guardian: 'smith_heart_quench.webp',
      heart_heat_guardian: 'smith_heart_heat.webp',
      heart_masterless_strength: 'smith_heart_final.webp',
    },
  },
};

/** The banner backdrop for one page, or null for the plain banner. */
export function journalBackdropUrl(instanceId: string, bossKey: string): string | null {
  const set = Object.hasOwn(BACKDROPS, instanceId) ? BACKDROPS[instanceId] : undefined;
  if (!set) return null;
  const own = set.bosses && Object.hasOwn(set.bosses, bossKey) ? set.bosses[bossKey] : undefined;
  const file = own ?? set.instance;
  return file ? `${JOURNAL_BACKDROP_DIR}${file}` : null;
}

/** Every committed backdrop file name the table names (the pin test's list). */
export function journalBackdropFiles(): string[] {
  const out = new Set<string>();
  for (const set of Object.values(BACKDROPS)) {
    if (set.instance) out.add(set.instance);
    for (const file of Object.values(set.bosses ?? {})) out.add(file);
  }
  return [...out].sort();
}
