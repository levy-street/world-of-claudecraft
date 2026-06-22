// Presentational data for the Guide, mirrored from src/sim/content/. Class brand colors
// match CLASSES[id].color and zone bands match the ZoneDefs; a scripts/wiki generator
// derives the full per-class and per-zone dataset from the sim in a later phase, so
// only the small bits the landing needs live here. Names reuse existing i18n keys.

import type { TranslationKey } from '../ui/i18n';

export const LEVEL_CAP = 20;

export interface ClassChip {
  id: string;
  nameKey: TranslationKey;
  color: string;
}

// Order groups the three pure archetypes first, then the hybrids, for a calm grid.
export const CLASS_CHIPS: ClassChip[] = [
  { id: 'warrior', nameKey: 'classes.warrior', color: '#c79c6e' },
  { id: 'paladin', nameKey: 'classes.paladin', color: '#f58cba' },
  { id: 'hunter', nameKey: 'classes.hunter', color: '#abd473' },
  { id: 'rogue', nameKey: 'classes.rogue', color: '#fff569' },
  { id: 'priest', nameKey: 'classes.priest', color: '#fffff0' },
  { id: 'shaman', nameKey: 'classes.shaman', color: '#0070de' },
  { id: 'mage', nameKey: 'classes.mage', color: '#69ccf0' },
  { id: 'warlock', nameKey: 'classes.warlock', color: '#9482c9' },
  { id: 'druid', nameKey: 'classes.druid', color: '#ff7d0a' },
];

export interface ZoneTeaser {
  id: string;
  nameKey: TranslationKey;
  blurbKey: TranslationKey;
  min: number;
  max: number;
}

export const ZONE_TEASERS: ZoneTeaser[] = [
  { id: 'vale', nameKey: 'guide.home.world.valeName', blurbKey: 'guide.home.world.valeBlurb', min: 1, max: 7 },
  { id: 'marsh', nameKey: 'guide.home.world.marshName', blurbKey: 'guide.home.world.marshBlurb', min: 6, max: 13 },
  { id: 'peaks', nameKey: 'guide.home.world.peaksName', blurbKey: 'guide.home.world.peaksBlurb', min: 13, max: 20 },
];
