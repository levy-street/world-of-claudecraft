// The Gravewyrm Sanctum's creature looks (docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 5, the Ice Tomb of the Wyrm). The Sledge Tusker
// wears its own art-guide body (SANCTUM_SLEDGE_TUSKER_LOOK; its sledge is a
// separate prop the fx module drives, gravewyrm_sanctum_fx/tusker_fx.ts). The
// trash wear their own Blender bodies (sanctum_trash_looks.ts), each under
// the visual key its re-tinted placeholder had, so the mob ids never moved.
// manifest.ts merges these over its VISUALS and maps the templates through
// MOB_KEYS (SANCTUM_MOB_KEYS).
//
// Sizes ride the templates' sim scales (sim/content/gravewyrm_sanctum.ts and
// the shipped rows in dungeons.ts): each body is drawn at its height
// in yards, at its template's scale, and every one stands clearly past a
// player (2.6 yd) without touching the sim's reach (the owner's rule:
// imposing, never toy-like). The three bosses keep their looks (phase B).

import {
  BONEGUARD_ID,
  BONEWALKER_ID,
  GLACIER_SPLINTER_ID,
  GOADSMITH_ID,
  PYRE_TENDER_ID,
  RIME_WHELP_ID,
  SCALEGUARD_ID,
  SLEDGE_HAULER_ID,
  SLEDGE_TUSKER_ID,
  SOUL_BRAZIER_ID,
  THAWCALLER_ID,
  TUSKER_ENRAGE,
  TUSKER_TRAMPLE,
  TUSKER_TUSK_SWEEP,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import { sanctumDrawnHeight } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import {
  chargeClipRate,
  sweepClipRate,
  TUSKER_CLIP,
  TUSKER_MODEL,
  TUSKER_SIM_SCALE,
  trampleClipRate,
  tuskerLookHeight,
  tuskerModelScale,
} from '../gravewyrm_sanctum_fx/tusker_model_core';
import type { ClipMap, VisualDef } from './manifest';
import { SANCTUM_TRASH_LOOKS } from './sanctum_trash_looks';

/** The gestures the Sanctum's fx send the Tusker (tusker_fx.ts): the pull's
 *  Unhitch (its clip drops the traces and the hitch bar), the Charge down the
 *  Trample lane, and the trace chains' latch (gone once unhitched, back on a
 *  re-hitch after a reset pull), re-sent so a view rebuilt mid-fight shows the
 *  truth. */
export const TUSKER_UNHITCH_GESTURE = 'sanctum_tusker_unhitch';
export const TUSKER_CHARGE_GESTURE = 'sanctum_tusker_charge';
export const TUSKER_TRACES_GONE_GESTURE = 'sanctum_tusker_traces_gone';
export const TUSKER_TRACES_ON_GESTURE = 'sanctum_tusker_traces_on';

/** A Glacier Splinter's Shatter (defined beside the other fx gestures in
 *  sanctum_fx_core.ts, re-exported for the looks' callers). */
export { SPLINTER_SHATTERED_GESTURE } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
/** A Soul Brazier kicked over (Topple Brazier): its standing body hides at
 *  once and the fx draw it fallen in its place (gravewyrm_sanctum_fx/
 *  sanctum_kit_fx.ts). */
export const BRAZIER_TOPPLED_GESTURE = 'sanctum_brazier_toppled';

/** The trace chains and the hitch bar: their own mesh in the GLB. */
export const TUSKER_TRACES_NODE = 'SledgeTuskerTraces';

/** The Sledge Tusker (an art-guide body: concept, Tripo, a rig built for the
 *  mesh, every clip animated at 30 fps): a war mammoth under a frosted coat,
 *  riveted iron on its brow, banded tusks curling out, the soul lantern on a
 *  post over its back. Drawn at its authored size: 7.44 yd to the hump at its
 *  2.8 (three players), the lantern to 9.99, 12 yd from the tail to the tusk
 *  tips. The gore lands on frame 18 of its 1.5 s clip and both strikes are
 *  cast bars whose clips land on the bar's end at 1x (the tusks cross the
 *  cone, the head is levelled down the lane). The pull's Unhitch, the Charge
 *  and the enrage's Roar are gestures off the fx; the trace chains hide once
 *  the Unhitch has dropped them. */
export const SANCTUM_SLEDGE_TUSKER_LOOK: VisualDef = {
  url: TUSKER_MODEL.url,
  height: tuskerLookHeight(),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack'],
    contacts: { Attack: [TUSKER_CLIP.attackHit] },
    attackByAbility: {
      [TUSKER_UNHITCH_GESTURE]: 'Unhitch',
      [TUSKER_CHARGE_GESTURE]: 'Charge',
      [TUSKER_ENRAGE]: 'Roar',
    },
    attackTimeScaleByAbility: {
      [TUSKER_UNHITCH_GESTURE]: 1,
      [TUSKER_CHARGE_GESTURE]: chargeClipRate(),
      [TUSKER_ENRAGE]: 1,
    },
    hit: ['Hit'],
    death: 'Death',
    castByAbility: { [TUSKER_TUSK_SWEEP]: 'TuskSweep', [TUSKER_TRAMPLE]: 'TrampleWindup' },
    castTimeScaleByAbility: {
      [TUSKER_TUSK_SWEEP]: sweepClipRate(),
      [TUSKER_TRAMPLE]: trampleClipRate(),
    },
    castPlayOut: ['TuskSweep'],
    flourish: 'Roar',
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  oneShotsHoldAttacks: ['Unhitch', 'Charge', 'Roar'],
  meshToggles: [
    {
      nodes: [TUSKER_TRACES_NODE],
      hideAfter: { gesture: TUSKER_UNHITCH_GESTURE, seconds: TUSKER_CLIP.unhitch, clip: 'Unhitch' },
      hideNow: TUSKER_TRACES_GONE_GESTURE,
      showNow: TUSKER_TRACES_ON_GESTURE,
    },
  ],
  // The gaits at the drawn size: its 2.7 patrol hauls at about 0.96x the
  // authored walk, its 6 chase ambles at 1x.
  walkRef: TUSKER_MODEL.walkRef * tuskerModelScale(TUSKER_SIM_SCALE),
  runRef: TUSKER_MODEL.runRef * tuskerModelScale(TUSKER_SIM_SCALE),
  // The gore lands at 0.567 s (contacts); the death is timed off the clip at 1x.
  attackTimeScale: 1,
  deathTimeScale: 1,
  authoredAtlas: true,
  // The widest override the click-capsule guard allows (2x CLICK_RADIUS_CAP,
  // tests/nythraxis_bone_spike_model.test.ts): wider swallows the raid's clicks.
  clickRadius: 4.4,
};

/** A carved prop that never moves: every clip lookup misses harmlessly. */
const STATIC_PROP_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Idle',
  run: 'Idle',
  attack: ['Idle'],
  death: 'Idle',
};

/** The Sanctum's defs: every trash body (sanctum_trash_looks.ts), the Soul
 *  Brazier prop, and the Sledge Tusker's own body. `_visuals` is the manifest
 *  the placeholders used to be re-tinted from; every creature has its own
 *  body now, so nothing is derived from it. */
export function sanctumCreatureLooks(
  _visuals: Readonly<Record<string, VisualDef>>,
): Record<string, VisualDef> {
  const out: Record<string, VisualDef> = { ...SANCTUM_TRASH_LOOKS };
  out.sanctum_sledge_tusker = SANCTUM_SLEDGE_TUSKER_LOOK;
  // The Soul Brazier: a bowl of soulfire on an iron stand, never a mob
  // silhouette (the shipped infernal brazier, violet-green and burning from
  // within; the fx set its flames). 2.4 yd at its 1.6.
  out.sanctum_soul_brazier = {
    url: 'models/props/infernal_brazier.glb',
    height: sanctumDrawnHeight(SOUL_BRAZIER_ID, 1),
    clips: STATIC_PROP_CLIPS,
    authoredAtlas: true,
    tint: 0x6f5a9e,
    tintStrength: 0.45,
    selfIllumination: 0.3,
    clickRadius: 1.4,
    meshToggles: [{ nodes: ['*'], hideNow: BRAZIER_TOPPLED_GESTURE }],
  };
  return out;
}

/** Each Sanctum template's visual key (merged into manifest MOB_KEYS). */
export const SANCTUM_MOB_KEYS: Readonly<Record<string, string>> = {
  [BONEGUARD_ID]: 'sanctum_boneguard',
  [BONEWALKER_ID]: 'sanctum_raised_bonewalker',
  [SCALEGUARD_ID]: 'sanctum_scaleguard',
  [THAWCALLER_ID]: 'sanctum_thawcaller',
  [GOADSMITH_ID]: 'sanctum_goadsmith',
  [PYRE_TENDER_ID]: 'sanctum_pyre_tender',
  [SOUL_BRAZIER_ID]: 'sanctum_soul_brazier',
  [RIME_WHELP_ID]: 'sanctum_rime_whelp',
  [SLEDGE_HAULER_ID]: 'sanctum_sledge_hauler',
  [GLACIER_SPLINTER_ID]: 'sanctum_glacier_splinter',
  [SLEDGE_TUSKER_ID]: 'sanctum_sledge_tusker',
};
