// Animation-only Workshop donors retargeted offline onto the WOC bind poses.
// Combat, casting, ledge climbing and equipment transitions keep their authored
// WOC clips: these Workshop packs contain no equivalent combat library.
import type { ClipMap } from './manifest';
import type { WocFit } from './woc_armor_core';

export function wocWowAnimsUrl(fit: WocFit): string {
  return `models/chars/players/woc/wow_anims_${fit}.glb`;
}

export function withWocWowAnimations(clips: ClipMap): ClipMap {
  return {
    ...clips,
    idle: 'WoW_a_idle',
    walk: 'WoW_a_walkN',
    run: 'WoW_a_runN',
    walkBack: 'WoW_a_walkS',
    swim: 'WoW_a_swimN',
    swimSurface: 'WoW_a_swimN',
    swimIdle: 'WoW_a_idle_swim',
    jump: 'WoW_a_jump',
    // The donor sits on a chair, while WOC sits on the floor and reuses that
    // pose for riders. Keep its matching Sit_Down/Sit_Idle transition pair.
    death: 'WoW_act_death',
    emote: {
      ...clips.emote,
      wave: { clips: ['WoW_act_wave'] },
      laugh: { clips: ['WoW_act_laugh'] },
      flex: { clips: ['WoW_act_muscle'] },
      bow: { clips: ['WoW_act_bow'] },
    },
  };
}
