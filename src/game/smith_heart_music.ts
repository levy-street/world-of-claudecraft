// The Smith's Heart's score per area (docs/design/raid/smith_heart.md): the
// raid's own halls theme, "The Sleeping Veins" (a slow heartbeat under warm
// strings, a solemn horn, glass bells), plays in every vein and in the Heart
// between the fights; each boss fight then takes over with its own cue
// (smith_heart_boss_music.ts). The table stays per area so a vein can get a
// variation of its own later without touching the decision.
// Pure: the instance music decision (instance_music.ts) asks it by world
// position; the area split is the layout's (smithHeartAreaAt).

import { type SmithHeartArea, smithHeartAreaAt } from '../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../sim/data';
import type { MusicZone } from './music_zones';

export const SMITH_HEART_AREA_MUSIC: Readonly<Record<SmithHeartArea, MusicZone>> = {
  hammer: 'dungeon_smith_heart',
  ring: 'dungeon_smith_heart',
  breath: 'dungeon_smith_heart',
  quench: 'dungeon_smith_heart',
  heat: 'dungeon_smith_heart',
  heart: 'dungeon_smith_heart',
};

/** The Smith's Heart's cue for a player at world (x, z) inside the raid. */
export function smithHeartMusicZoneAt(x: number, z: number): MusicZone {
  const def = DUNGEONS.smith_heart;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  return SMITH_HEART_AREA_MUSIC[smithHeartAreaAt(x - o.x, z - o.z)];
}
