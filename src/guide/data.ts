// Presentational data for the Guide. Class brand colors match CLASSES[id].color and are
// mirrored from src/sim/content/; the zone teasers are derived from the generated zone
// list (content.generated.ts) so their names, level bands, and count come from the game
// itself and only the curated blurbs are hand-written. Names reuse existing i18n keys.

import type { TranslationKey } from '../ui/i18n';
import { GUIDE_ZONES, type GuideZoneInfo } from './content.generated';

export const LEVEL_CAP = 20;

/**
 * The level a character must reach before a rift portal will let it through
 * (RIFT_MIN_LEVEL in src/sim/rift/portals.ts). It equals the cap today, and the rifts
 * page says so in prose; tests/guide_level_cap_drift.test.ts pins BOTH the mirror and
 * that equality, so a future cap raise that leaves rifts behind reds CI instead of
 * quietly turning the page into a lie.
 */
export const RIFT_MIN_LEVEL = 20;

/**
 * The level the stablemaster will teach Riding at (MOUNT_TRAIN_MIN_LEVEL in
 * src/sim/mounts_training.ts). Mirrored rather than imported, like the two above:
 * importing that module would pull the sim's whole content graph into the guide bundle
 * for one integer. Two pages state this gate (mounts and progression), so it lives here
 * once and is pinned in tests/guide_level_cap_drift.test.ts.
 */
export const RIDING_MIN_LEVEL = 20;

export interface ClassChip {
  id: string;
  nameKey: TranslationKey;
  color: string;
}

// Order groups the three pure archetypes first, then the hybrids, for a calm grid.
export const CLASS_CHIPS: ClassChip[] = [
  { id: 'warrior', nameKey: 'classes.warrior', color: '#d67a54' },
  { id: 'paladin', nameKey: 'classes.paladin', color: '#f58ca0' },
  { id: 'hunter', nameKey: 'classes.hunter', color: '#a6d84f' },
  { id: 'rogue', nameKey: 'classes.rogue', color: '#fcee58' },
  { id: 'priest', nameKey: 'classes.priest', color: '#c6d4f0' },
  { id: 'shaman', nameKey: 'classes.shaman', color: '#4e8aea' },
  { id: 'mage', nameKey: 'classes.mage', color: '#33c1f1' },
  { id: 'warlock', nameKey: 'classes.warlock', color: '#a785e6' },
  { id: 'druid', nameKey: 'classes.druid', color: '#ff8c1a' },
];

export interface ZoneTeaser {
  id: string;
  nameKey: TranslationKey;
  blurbKey: TranslationKey;
  min: number;
  max: number;
}

// THE one zone key stem, shared by every guide surface that keys curated per-zone copy
// (the home teaser grid, the world page's blurbs, greetings, place notes and card
// anchors). The stem is the zone's biome, which is how the first thirteen zones were
// authored and how their catalog keys and locale fills are named.
//
// A biome is NOT unique, though: a zone that shares another zone's biome (it borrows its
// sky, palette, and song) still needs its own prose and its own anchor, so it takes an
// explicit override here. Today only The Farshore needs one: an island with its own town
// and its own trouble that renders in the vale biome, it would otherwise inherit
// Eastbrook Vale's copy and collide with its DOM id, which is exactly the bug that
// shipped on the world page.
//
// One rule when adding a zone: every stem must be unique across GUIDE_ZONES. Give any
// zone whose biome is already spoken for a stem of its own here, and nowhere else.
const ZONE_KEY_STEM: Record<string, string> = { farshore_isle: 'farshore' };

/** The stem that names a zone's curated catalog keys and its world-page anchor. */
export function zoneKeyStem(zone: GuideZoneInfo): string {
  return ZONE_KEY_STEM[zone.id] ?? zone.biome;
}

// Every teaser row is derived from the generated zone list, so the landing page can
// never fall behind the world again: a new zone shows up on its own and only needs its
// guide.home.world.<stem>Name and <stem>Blurb pair written. Sorted by level band (the
// sort is stable, so zones sharing a band keep their generated order), so the grid reads
// outward from the starting valley.
export const ZONE_TEASERS: ZoneTeaser[] = [...GUIDE_ZONES]
  .sort((a, b) => a.min - b.min || a.max - b.max)
  .map((zone) => {
    const stem = zoneKeyStem(zone);
    return {
      id: stem,
      nameKey: `guide.home.world.${stem}Name` as TranslationKey,
      blurbKey: `guide.home.world.${stem}Blurb` as TranslationKey,
      min: zone.min,
      max: zone.max,
    };
  });

/** How many zones the world holds, for copy that states the count. */
export const ZONE_COUNT = ZONE_TEASERS.length;
