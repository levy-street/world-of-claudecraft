// The hand-keyed movement, emote and autoattack library for the WOC bodies
// (scripts/assets/woc_keyed_anims, keyed per fit on this exact bind pose).
// Combat idles, casting, strafes, ledge climbing, sitting and equipment
// transitions keep the rig's own clips (anims_<fit>.glb).
import type { ClipMap } from './manifest';
import type { WocFit } from './woc_armor_core';

export function wocKeyedAnimsUrl(fit: WocFit): string {
  return `models/chars/players/woc/woc_${fit}.glb`;
}

export function withWocKeyedAnimations(clips: ClipMap): ClipMap {
  return {
    ...clips,
    idle: 'Woc_Idle',
    walk: 'Woc_Walk',
    run: 'Woc_Run',
    walkBack: 'Woc_Walk_Back',
    swim: 'Woc_Swim',
    swimSurface: 'Woc_Swim',
    swimIdle: 'Woc_Swim_Idle',
    jump: 'Woc_Jump',
    // The keyed sit is perched on a seat, while WOC sits on the floor and reuses
    // that pose for riders: the rig's own Sit_Down/Sit_Idle pair stays.
    death: 'Woc_Death',
    emote: {
      ...clips.emote,
      wave: { clips: ['Woc_Emote_Wave'] },
      laugh: { clips: ['Woc_Emote_Laugh'] },
      flex: { clips: ['Woc_Emote_Flex'] },
      bow: { clips: ['Woc_Emote_Bow'] },
    },
  };
}
