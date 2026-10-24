// The hand-keyed movement, emote, combat and spellcasting library for the WOC bodies
// (scripts/assets/woc_keyed_anims, keyed per fit on this exact bind pose).
// Strafes, ledge climbing, sitting and equipment transitions keep the rig's own
// clips (anims_<fit>.glb).
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
  combatIdle: 'Woc_Combat_Idle_1H',
  walk: 'Woc_Walk',
  run: 'Woc_Run',
  walkBack: 'Woc_Walk_Back',
  swim: 'Woc_Swim',
  swimSurface: 'Woc_Swim',
  swimIdle: 'Woc_Swim_Idle',
  jump: 'Woc_Jump',
  death: 'Woc_Death',
  hit: ['Woc_Hit'],
  wandAttack: 'Woc_Cast_Shoot',
  cast: 'Woc_Cast_Directed',
} as const satisfies Partial<ClipMap>;

const EMOTES: NonNullable<ClipMap['emote']> = {
  wave: { clips: ['Woc_Emote_Wave'] },
  laugh: { clips: ['Woc_Emote_Laugh'] },
  flex: { clips: ['Woc_Emote_Flex'] },
  bow: { clips: ['Woc_Emote_Bow'] },
  point: { clips: ['Woc_Emote_Point'] },
  roar: { clips: ['Woc_Shout'] },
};

// Shipped and bound but routed by no slot or emote here: the per-class routes in
// manifest.ts name most of them, and the rest wait for a route (/salute keeps the rig's
// own Salute; the keyed beckon is a different gesture).
const EXTRA_SHIPPED_CLIPS = [
  'Woc_Run_Back',
  'Woc_Emote_Nod',
  'Woc_Emote_Shake_Head',
  'Woc_Emote_Beckon',
  'Woc_Attack_1H_Stab',
  'Woc_Attack_Offhand',
  'Woc_Attack_Offhand_Stab',
  'Woc_Attack_Polearm_0',
  'Woc_Attack_Polearm_1',
  'Woc_Attack_Polearm_2',
  'Woc_Attack_Thrown',
  'Woc_Combat_Idle_2H',
  'Woc_Combat_Idle_Dual',
  'Woc_Shield_Bash',
  'Woc_Special_1H',
  'Woc_Special_2H',
  'Woc_Cast_Omni',
  'Woc_Cast_Omni_Release',
  'Woc_Channel_Directed',
] as const;

/** Every hand-keyed clip a WOC body binds: exactly what woc_<fit>.glb ships. */
export const WOC_KEYED_CLIP_NAMES: readonly string[] = [
  ...new Set([
    ...Object.values(SLOTS).flatMap((v) => (Array.isArray(v) ? v : [v])),
    ...Object.values(EMOTES).flatMap((spec) => spec?.clips ?? []),
    ...EXTRA_SHIPPED_CLIPS,
    ...WOC_AUTO_ATTACK_NAMES,
  ]),
];

export function withWocKeyedAnimations(clips: ClipMap): ClipMap {
  return { ...clips, ...SLOTS, emote: { ...clips.emote, ...EMOTES } };
}
