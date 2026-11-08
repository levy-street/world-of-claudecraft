// The Smith's Heart's own boss score (docs/design/raid/smith_heart.md section
// 7): one fight cue per encounter, and the final boss's cue following its
// stage. Generated with scripts/generate_smith_heart_music.mjs and mastered
// into seamless loops with scripts/master_music_loop.mjs (CREDITS.md):
//   the Hammer Council   "Stone That Answers": war drums, low brass, a deep
//                        choir, the quarry's grinding ostinato;
//   the Breath           "Over the Cornice": rushing strings and flutes, horns
//                        soaring over thunder;
//   the Quench           "Tempered in Rime": glass bells and cracking-ice
//                        strings over pounding drums, steel hissing into water;
//   the Heat             "The First Flame": giant drums, ringing hammer
//                        strikes, roaring trombones;
//   the Masterless Strength
//                        "The Masterless Strength" through the quarter fight
//                        and its intermissions, "The Last Fifteen" from its
//                        15 percent stride on, and "The Unmade Anvil", the
//                        dread of Mythic's hidden phase, from the kneel on.
// Pure: the instance music decision (instance_music.ts) asks it per engaged
// entity; the stage is the boss's phase aura, mirrored entity state, so
// offline and online pick the same cue. A stage change crossfades the two
// loops (boss_music_loop.ts BossLoopTrack).

import { FINAL_BOSS } from '../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  type FinalStage,
  finalStageOf,
} from '../sim/encounters/smith_heart/final_phase_ids';

export const SMITH_HEART_BOSS_TRACKS = {
  council: '/audio/music/boss_heart_hammer_council.mp3?v=905c8cf2605c',
  breath: '/audio/music/boss_heart_breath.mp3?v=d12e1281cd15',
  quench: '/audio/music/boss_heart_quench.mp3?v=03968298d1b1',
  heat: '/audio/music/boss_heart_heat.mp3?v=f955ad643011',
  final: '/audio/music/boss_heart_masterless_strength.mp3?v=a0abdc9f55e3',
  finalLast: '/audio/music/boss_heart_masterless_last.mp3?v=8fc9a59e3f09',
  finalHidden: '/audio/music/boss_heart_masterless_hidden.mp3?v=f96e47ff0f45',
} as const;

/** The raid's bosses (template ids) to their fight cue; the final boss's
 *  row is its opening cue (smithHeartStageTrack picks the later ones). */
export const SMITH_HEART_BOSS_TRACK_URLS: Readonly<Record<string, string>> = {
  heart_hammer_guardian: SMITH_HEART_BOSS_TRACKS.council,
  heart_seam_singer: SMITH_HEART_BOSS_TRACKS.council,
  heart_breath_guardian: SMITH_HEART_BOSS_TRACKS.breath,
  heart_quench_guardian: SMITH_HEART_BOSS_TRACKS.quench,
  heart_heat_guardian: SMITH_HEART_BOSS_TRACKS.heat,
  [FINAL_BOSS]: SMITH_HEART_BOSS_TRACKS.final,
};

const STAGE_TRACK: Readonly<Record<FinalStage, string>> = {
  fight: SMITH_HEART_BOSS_TRACKS.final,
  leap: SMITH_HEART_BOSS_TRACKS.final,
  call: SMITH_HEART_BOSS_TRACKS.final,
  finalLeap: SMITH_HEART_BOSS_TRACKS.finalLast,
  final: SMITH_HEART_BOSS_TRACKS.finalLast,
  kneel: SMITH_HEART_BOSS_TRACKS.finalHidden,
  rebirth: SMITH_HEART_BOSS_TRACKS.finalHidden,
  collapse: SMITH_HEART_BOSS_TRACKS.finalHidden,
};

export interface StagedBossEntity {
  templateId: string;
  auras?: readonly { id: string; value: number }[];
}

/** The final boss's cue for its current stage, or null for any other entity. */
export function smithHeartStageTrack(entity: StagedBossEntity): string | null {
  if (entity.templateId !== FINAL_BOSS) return null;
  const phase = entity.auras?.find((a) => a.id === FINAL_PHASE_AURAS.phase);
  return STAGE_TRACK[finalStageOf(phase?.value)];
}

/** Whether a template is one of the raid's bosses: only their kill stops the
 *  fight cue at once (instance_music.ts); every other boss holds its cue
 *  through the aggro-gap grace. */
export function isSmithHeartBoss(templateId: string): boolean {
  return Object.hasOwn(SMITH_HEART_BOSS_TRACK_URLS, templateId);
}

/** Whether a cue is one of the final boss's stage cues. */
export function isFinalStageTrack(url: string): boolean {
  return (
    url === SMITH_HEART_BOSS_TRACKS.final ||
    url === SMITH_HEART_BOSS_TRACKS.finalLast ||
    url === SMITH_HEART_BOSS_TRACKS.finalHidden
  );
}
