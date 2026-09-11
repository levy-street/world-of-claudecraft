import type { BiomeId } from '../sim/types';
import { dungeonMusicZoneForDungeon } from './dungeon_music_zones';

export type MusicZone =
  | 'town_eastbrook'
  | 'town_fenbridge'
  | 'town_highwatch'
  | 'vale'
  | 'vale_legacy'
  | 'marsh'
  | 'peaks'
  | 'dusk'
  | 'ember'
  | 'frost'
  | 'amber'
  | 'fen'
  | 'night'
  | 'haunt'
  | 'jungle'
  | 'garden'
  | 'gale'
  | 'farshore'
  | 'proving_shore'
  | 'dungeon_hollow_crypt'
  | 'dungeon_sunken_bastion'
  | 'dungeon_gravewyrm_sanctum'
  | 'ignivar_forge_approach'
  | 'ignivar_raid_arena'
  | 'ignivar_inner_crucible'
  | 'rift_frost'
  | 'rift_ember'
  | 'rift_venom'
  | 'rift_bone'
  | 'rift_brute'
  | 'rift_void'
  | 'rift_storm'
  | 'rift_tide';

const TOWN_MUSIC: Record<string, MusicZone> = {
  eastbrook_vale: 'town_eastbrook',
  mirefen_marsh: 'town_fenbridge',
  thornpeak_heights: 'town_highwatch',
};

// Per-zone overworld overrides. Farshore Isle shares the vale biome palette
// but is the rift-scarred landfall where the breach story starts, so it gets
// its own vigil theme instead of the vale's playful loop.
const ZONE_MUSIC: Partial<Record<string, MusicZone>> = {
  farshore_isle: 'farshore',
  // The tutorial island paints as vale, but it is the first thing a new
  // player ever hears and it deserves its own cue rather than the mainland's.
  // One entry covers the whole island: Dawnrest Camp is a hub with no town
  // theme, and that path falls through to ZONE_MUSIC (same as Gullhaven on
  // the Farshore).
  proving_shore: 'proving_shore',
};

// Every overworld biome resolves to a bespoke theme; the paint-only biomes
// that never anchor a shipped zone (beach/desert/volcano/cave) borrow the
// nearest-mood cue so a realm or custom-map zone always scores. tsc keeps
// this table exhaustive over BiomeId.
const BIOME_MUSIC: Record<BiomeId, MusicZone> = {
  vale: 'vale',
  marsh: 'marsh',
  peaks: 'peaks',
  dusk: 'dusk',
  ember: 'ember',
  frost: 'frost',
  amber: 'amber',
  fen: 'fen',
  night: 'night',
  haunt: 'haunt',
  jungle: 'jungle',
  garden: 'garden',
  gale: 'gale',
  beach: 'jungle',
  desert: 'ember',
  volcano: 'ember',
  cave: 'dusk',
};

// Procedural Rift floors carry a RiftTheme (src/sim/content/rift/themes.ts);
// the floor view ships the theme's display name, so the crawl cue is keyed by
// that name. tests/music.test.ts pins this table against RIFT_THEMES so a new
// or renamed archetype cannot silently fall back.
const RIFT_MUSIC: Record<string, MusicZone> = {
  Frostbound: 'rift_frost',
  Emberforge: 'rift_ember',
  Venomweald: 'rift_venom',
  Boneyard: 'rift_bone',
  Warcamp: 'rift_brute',
  Voidscar: 'rift_void',
  Stormspire: 'rift_storm',
  Sunken: 'rift_tide',
  // The authored set piece: hellfire halls read as the forge archetype.
  'Infernal Citadel': 'rift_ember',
};

/** Crawl cue for a procedural Rift floor, from RiftFloorView.themeName. */
/** Every pickable track (the map editor's music tool lists these). Realm and
 *  rift zones are chosen by the world, never by a maker, so they stay off it. */
export const MUSIC_ZONES: readonly MusicZone[] = [
  'town_eastbrook',
  'town_fenbridge',
  'town_highwatch',
  'vale',
  'vale_legacy',
  'marsh',
  'peaks',
  'farshore',
  'dungeon_hollow_crypt',
  'dungeon_sunken_bastion',
  'dungeon_gravewyrm_sanctum',
];

// Every id the director can score, the maker-pickable list above plus the
// biome layers and the world-chosen realm/rift cues. A Record keyed on the
// union so tsc fails the moment a new MusicZone is added without a row here.
// Used to validate map-authored track ids at play time (an authored world may
// legitimately name a biome cue the editor does not offer: the Deepglass asks
// for 'amber').
const ALL_MUSIC_ZONE_FLAGS: Record<MusicZone, true> = {
  town_eastbrook: true,
  town_fenbridge: true,
  town_highwatch: true,
  vale: true,
  vale_legacy: true,
  marsh: true,
  peaks: true,
  dusk: true,
  ember: true,
  frost: true,
  amber: true,
  fen: true,
  night: true,
  haunt: true,
  jungle: true,
  garden: true,
  gale: true,
  farshore: true,
  proving_shore: true,
  dungeon_hollow_crypt: true,
  dungeon_sunken_bastion: true,
  dungeon_gravewyrm_sanctum: true,
  rift_frost: true,
  rift_ember: true,
  rift_venom: true,
  rift_bone: true,
  rift_brute: true,
  rift_void: true,
  rift_storm: true,
  rift_tide: true,
  ignivar_forge_approach: true,
  ignivar_raid_arena: true,
  ignivar_inner_crucible: true,
};
export const ALL_MUSIC_ZONES: readonly MusicZone[] = Object.keys(
  ALL_MUSIC_ZONE_FLAGS,
) as MusicZone[];

export function riftMusicZoneForTheme(themeName: string): MusicZone {
  return RIFT_MUSIC[themeName] ?? 'rift_void';
}

// DUNGEON_MUSIC moved to dungeon_music_zones.ts; re-exported for the existing
// music.ts consumers (tests and instance music).
export { dungeonMusicZoneForDungeon } from './dungeon_music_zones';

export function shouldResetMusicForDungeonEntry(
  previousDungeonId: string | null,
  nextDungeonId: string | null,
): boolean {
  return nextDungeonId !== null && previousDungeonId !== nextDungeonId;
}

/** Pick the soundtrack layer from world position context. */
export function musicZoneForLocation(
  zoneId: string,
  biome: BiomeId,
  inHub: boolean,
  inDungeon: boolean,
  dungeonId: string | null = null,
): MusicZone {
  const biomeLayer: MusicZone = BIOME_MUSIC[biome];
  if (inDungeon) return dungeonId ? dungeonMusicZoneForDungeon(dungeonId) : 'dungeon_hollow_crypt';
  // A hub without a dedicated town theme keeps its zone's own cue: Gullhaven
  // is the heart of the Farshore vigil, not a reason to fall back to the vale.
  if (inHub) return TOWN_MUSIC[zoneId] ?? ZONE_MUSIC[zoneId] ?? biomeLayer;
  return ZONE_MUSIC[zoneId] ?? biomeLayer;
}
