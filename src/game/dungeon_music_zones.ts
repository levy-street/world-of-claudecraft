import type { MusicZone } from './music';

// Authored dungeon and raid-room music cues. A procedural Rift floor has no row
// here: its cue follows the floor theme (riftMusicZoneForTheme in music.ts).
const DUNGEON_MUSIC: Record<string, MusicZone> = {
  hollow_crypt: 'dungeon_hollow_crypt',
  sunken_bastion: 'dungeon_sunken_bastion',
  gravewyrm_sanctum: 'dungeon_gravewyrm_sanctum',
  ignivar_forge_approach: 'ignivar_forge_approach',
  ignivar_raid_arena: 'ignivar_raid_arena',
  ignivar_molten_assembly: 'ignivar_forge_approach',
  ignivar_inner_crucible: 'ignivar_inner_crucible',
};

export function dungeonMusicZoneForDungeon(dungeonId: string): MusicZone {
  return DUNGEON_MUSIC[dungeonId] ?? 'dungeon_hollow_crypt';
}
