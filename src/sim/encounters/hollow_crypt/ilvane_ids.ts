// Cantor Ilvane's ids, tuning and pure geometry (the Choir Loft with the Bone
// Organ, the third Hollow Crypt boss: docs/design/dungeon-rework/hollow_crypt.md
// 5.3), as a dependency-light leaf: the encounter module, the dev helpers, the
// renderer, the HUD alert and the tests key on these. No SimContext, no rng.
//
//   Dirge of the Hollow  an interruptible bar; if it completes, shadow and a
//                        silence on every player who can SEE her. Kick it, or
//                        hide behind the choir pillars.
//   Harmony              each living Chorister cuts the damage she takes by 30
//                        percent: kill the Choristers first.
//   Bone Organ           she plays the organ: shadow notes burst from the pipes
//                        as lanes down the loft floor, two waves, step between.
//   Crescendo            below 30 percent she sings faster.
//   Heroic               Encore (a Chorister killed well before its partner
//                        rises again) and Unbroken Verse (every third Dirge
//                        cannot be interrupted).

import { HOLLOW_CRYPT_ANCHORS } from '../../content/hollow_crypt_layout';
import { inLane } from '../../mob/trash_kit/lane';

export const ILVANE_ID = 'cantor_ilvane';
export const CHORISTER_ID = 'hollow_chorister';

// ---- cast ids -------------------------------------------------------------------
/** The kickable Dirge (registered in mob/healer_channel.ts's interrupt table). */
export const ILVANE_DIRGE = 'crypt_ilvane_dirge';
/** Heroic Unbroken Verse: the Dirge no interrupt can cut (registered nowhere). */
export const ILVANE_UNBROKEN_DIRGE = 'crypt_ilvane_unbroken_dirge';
/** She plays the Bone Organ (a channel while the notes fall). */
export const ILVANE_BONE_ORGAN = 'crypt_ilvane_bone_organ';

/** The interruptible boss bars, by the school a kick locks out. */
export const ILVANE_CAST_SCHOOLS: Readonly<Record<string, { school: 'shadow' }>> = {
  [ILVANE_DIRGE]: { school: 'shadow' },
};

// ---- spellfx ability ids (presentation cues, never casts) ---------------------------
/** A wave of notes bursts down its lanes. */
export const ILVANE_NOTES_BURST = 'crypt_ilvane_notes_burst';
/** A Chorister rises again (heroic Encore). */
export const ILVANE_ENCORE = 'crypt_ilvane_encore';
/** The Dirge was cut short (from her to her). */
export const ILVANE_DIRGE_CUT = 'crypt_ilvane_dirge_cut';

// ---- auras -------------------------------------------------------------------------
/** On Ilvane: the damage her living Choristers take off her (value = the share). */
export const ILVANE_HARMONY = 'crypt_ilvane_harmony';
/** On Ilvane below 30 percent: she sings faster. */
export const ILVANE_CRESCENDO = 'crypt_ilvane_crescendo';
/** The Dirge's silence. */
export const ILVANE_DIRGE_SILENCE = 'crypt_ilvane_dirge_silence';

// ---- encounter object templates ---------------------------------------------------
/** A note lane while its wave gathers (the telegraph; facing = the lane's yaw,
 *  scale = its length); the same object swaps to the burst template when the
 *  wave falls, then it is gone. */
export const ILVANE_NOTE_MARK_TEMPLATE = 'crypt_ilvane_note_mark';
export const ILVANE_NOTE_BURST_TEMPLATE = 'crypt_ilvane_note_burst';

export const ILVANE_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  ILVANE_NOTE_MARK_TEMPLATE,
  ILVANE_NOTE_BURST_TEMPLATE,
]);

// ---- the arena ---------------------------------------------------------------------
/** The Choir Loft (instance-local): its floor rectangle. */
export const CHOIR_LOFT = { x0: -30, x1: 30, z0: 150, z1: 175.5 } as const;
/** Where she sits to play, at the Bone Organ's keys (it stands at z 170). */
export const ORGAN_BENCH = { x: HOLLOW_CRYPT_ANCHORS.loft.x, z: 167.2 } as const;
/** The lanes run from the pipes down the loft toward the rail (yaw of -z). */
export const NOTE_LANE_YAW = Math.PI;
/** Where every lane starts (just off the pipes) and how long it runs. */
export const NOTE_LANE_START_Z = 168.4;
export const NOTE_LANE_LENGTH = 18;
export const NOTE_LANE_HALF = 1.75;
/** The two waves' lane centres (x): the second fills the first one's gaps. */
export const NOTE_WAVES: readonly (readonly number[])[] = [
  [-24, -16, -8, 0, 8, 16, 24],
  [-20, -12, -4, 4, 12, 20],
];

// ---- tuning (normal-mode bases) ---------------------------------------------------
// Numbers basis (docs/design/dungeon-rework/README.md 7): cloth about 320 health at
// level 9. A completed Dirge is the fumbled core (about 35 percent and a silence on
// everyone who could see her); a note lane a must-avoid hit (about 33 percent).
export const ILVANE_TUNING = {
  dirgeFirst: 9,
  dirgeEvery: 16,
  dirgeCast: 2.5,
  dirgeRadius: 45,
  dirgeMin: 105,
  dirgeMax: 125,
  dirgeSilence: 4,
  /** After a kick she sings no Dirge for this long (beyond the school lockout). */
  kickQuiet: 3,
  /** Harmony: the share of her damage each living Chorister takes off. */
  harmonyPer: 0.3,
  organFirst: 18,
  organEvery: 26,
  /** Her walk to the bench (yd a second) and the longest it may take. */
  organStrideSpeed: 9,
  organStrideMax: 4,
  /** A wave: when it is drawn (from the start of the playing), its gather. */
  organWaveAt: [0.4, 2.2] as readonly number[],
  organGather: 1.6,
  /** The playing (a channel) lasts past the last wave's burst. */
  organPlay: 4.2,
  noteMin: 100,
  noteMax: 115,
  /** Crescendo: at this health share; her Dirge's bar and cadence then. */
  crescendoAt: 0.3,
  dirgeCastCrescendo: 1.8,
  dirgeEveryCrescendo: 11,
  /** Crescendo: a third wave and a quicker gather. */
  organWaveAtCrescendo: [0.4, 1.6, 2.8] as readonly number[],
  organGatherCrescendo: 1.2,
  organPlayCrescendo: 4.4,
  /** Heroic Encore: a Chorister dead this long while its partner lives rises. */
  encoreSeconds: 10,
  /** Heroic Unbroken Verse: every Nth Dirge cannot be interrupted. */
  unbrokenEvery: 3,
} as const;

/** The cast id the Dirge numbered `dirges` (0-based) runs under. Pure. */
export function dirgeCastIdFor(dirges: number, heroic: boolean): string {
  if (heroic && (dirges + 1) % ILVANE_TUNING.unbrokenEvery === 0) return ILVANE_UNBROKEN_DIRGE;
  return ILVANE_DIRGE;
}

/** The damage share Harmony takes off her with `living` Choristers. Pure. */
export function harmonyShare(living: number): number {
  return Math.min(0.9, Math.max(0, living) * ILVANE_TUNING.harmonyPer);
}

/** Is (px, pz) in the note lane centred on `x` (instance-local)? Pure. */
export function inNoteLane(x: number, px: number, pz: number): boolean {
  return inLane(x, NOTE_LANE_START_Z, NOTE_LANE_YAW, NOTE_LANE_LENGTH, NOTE_LANE_HALF, px, pz);
}
