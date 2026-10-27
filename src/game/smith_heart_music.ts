// The Smith's Heart's score per area (docs/design/raid/smith_heart.md): one
// cue per vein and one for the Heart, each borrowed from an existing track
// whose own brief fits the room, until the raid gets its own score:
//   the Hammer and the Ring: the Gravewyrm Sanctum's (the same mountain);
//   the Breath: "Spirefall" (a bastion up inside its own thunderhead);
//   the Quench: "Hoarfrost Vault" (a tomb with all its echoes frozen);
//   the Heat: "The Anvil Below" (a forge that never went out, anvil strikes,
//     bellows drums, a smith's chant);
//   the Heart: "The Unlit Door" (almost no pulse, just a heart somewhere
//     behind the walls).
// Pure: the instance music decision (instance_music.ts) asks it by world
// position; the area split is the layout's (smithHeartAreaAt).

import { type SmithHeartArea, smithHeartAreaAt } from '../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../sim/data';
import type { MusicZone } from './music_zones';

export const SMITH_HEART_AREA_MUSIC: Readonly<Record<SmithHeartArea, MusicZone>> = {
  hammer: 'dungeon_gravewyrm_sanctum',
  ring: 'dungeon_gravewyrm_sanctum',
  breath: 'rift_storm',
  quench: 'rift_frost',
  heat: 'rift_ember',
  heart: 'rift_void',
};

/** The Smith's Heart's cue for a player at world (x, z) inside the raid. */
export function smithHeartMusicZoneAt(x: number, z: number): MusicZone {
  const def = DUNGEONS.smith_heart;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return SMITH_HEART_AREA_MUSIC[smithHeartAreaAt(x - o.x, z - o.z)];
}
