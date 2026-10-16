// The hand-keyed movement, emote and autoattack library for the WOC bodies
// (scripts/assets/woc_keyed_anims, keyed per fit on this exact bind pose).
// Combat idles, casting, strafes, ledge climbing, sitting and equipment
// transitions keep the rig's own clips (anims_<fit>.glb).
import type { ClipMap } from './manifest';
import type { WocFit } from './woc_armor_core';
import { WOC_AUTO_ATTACK_NAMES } from './woc_autoattack_core';

export function wocKeyedAnimsUrl(fit: WocFit): string {
  // Beside, not inside, the artist's delivery directory (players/woc/).
  return `models/chars/players/woc_keyed/woc_${fit}.glb`;
}

// The keyed sit is perched on a seat, while WOC sits on the floor and reuses that
// pose for riders: the rig's own Sit_Down/Sit_Idle pair stays.
const SLOTS = {
  idle: 'Woc_Idle',
  walk: 'Woc_Walk',
  run: 'Woc_Run',
  walkBack: 'Woc_Walk_Back',
  swim: 'Woc_Swim',
  swimSurface: 'Woc_Swim',
  swimIdle: 'Woc_Swim_Idle',
  jump: 'Woc_Jump',
  death: 'Woc_Death',
} as const satisfies Partial<ClipMap>;

const EMOTES: NonNullable<ClipMap['emote']> = {
  wave: { clips: ['Woc_Emote_Wave'] },
  laugh: { clips: ['Woc_Emote_Laugh'] },
  flex: { clips: ['Woc_Emote_Flex'] },
  bow: { clips: ['Woc_Emote_Bow'] },
};

/** Every hand-keyed clip a WOC body binds: exactly what woc_<fit>.glb ships. */
export const WOC_KEYED_CLIP_NAMES: readonly string[] = [
  ...new Set([
    ...Object.values(SLOTS),
    ...Object.values(EMOTES).flatMap((spec) => spec?.clips ?? []),
    ...WOC_AUTO_ATTACK_NAMES,
  ]),
];

export function withWocKeyedAnimations(clips: ClipMap): ClipMap {
  return { ...clips, ...SLOTS, emote: { ...clips.emote, ...EMOTES } };
}
