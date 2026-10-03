// The Gravewyrm Sanctum's creature looks (docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 5, the Ice Tomb of the Wyrm). The Sledge Tusker
// wears its own Blender body (SANCTUM_SLEDGE_TUSKER_LOOK; its sledge is a
// separate prop the fx module drives, gravewyrm_sanctum_fx/tusker_fx.ts). The
// rest of the new trash are PLACEHOLDERS: shipped rigs re-tinted for the ice
// and the cult's fires, so every creature of the rebuilt route is visible and
// animated from day one, until the art phase gives each its own body. Every
// key keeps the mob id and the visual key, so a swap is a def change.
// manifest.ts merges these over its VISUALS and maps the templates through
// MOB_KEYS (SANCTUM_MOB_KEYS).
//
// Sizes ride the templates' sim scales (sim/content/gravewyrm_sanctum.ts and
// the shipped rows in dungeons.ts): each row names the height it is DRAWN at,
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

/** The gestures the Sanctum's fx send the Tusker (tusker_fx.ts): the pull's
 *  Unhitch (its clip drops the traces and the hitch bar), the Charge down the
 *  Trample lane, and the trace chains' latch (gone once unhitched, back on a
 *  re-hitch after a reset pull), re-sent so a view rebuilt mid-fight shows the
 *  truth. */
export const TUSKER_UNHITCH_GESTURE = 'sanctum_tusker_unhitch';
export const TUSKER_CHARGE_GESTURE = 'sanctum_tusker_charge';
export const TUSKER_TRACES_GONE_GESTURE = 'sanctum_tusker_traces_gone';
export const TUSKER_TRACES_ON_GESTURE = 'sanctum_tusker_traces_on';

/** A Glacier Splinter's Shatter: its whole body bursts (the fx throw the
 *  shards), so its corpse hides (re-sent while the corpse stands). */
export const SPLINTER_SHATTERED_GESTURE = 'sanctum_splinter_shattered';

/** The trace chains and the hitch bar: their own mesh in the GLB. */
export const TUSKER_TRACES_NODE = 'SledgeTuskerTraces';

/** The Sledge Tusker (built in Blender, E:/woc/entregas/santuario/tusker): a
 *  shaggy mountain tusker as big as a house, rime in its coat, iron-capped
 *  tusks as long as a wagon, the cult's collar, chamfron and soul lantern; 40
 *  bones, eleven hand-keyed clips. Drawn at its authored size: 7.76 yd to the
 *  dome at its 2.8 (three players), 17.5 yd from the tail to the tusk tips.
 *  Both strikes are cast bars whose clips land on the bar's end (the tusks
 *  cross the cone, the head is levelled down the lane): bar-locked. The pull's
 *  Unhitch, the Charge and the enrage's Roar are gestures off the fx; the
 *  trace chains hide once the Unhitch has dropped them. */
export const SANCTUM_SLEDGE_TUSKER_LOOK: VisualDef = {
  url: TUSKER_MODEL.url,
  height: tuskerLookHeight(),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack'],
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
  // The gaits at the drawn size: its 2.7 patrol hauls at about 1.4x the
  // authored walk, its 6 chase trots at about 1.07x.
  walkRef: TUSKER_MODEL.walkRef * tuskerModelScale(TUSKER_SIM_SCALE),
  runRef: TUSKER_MODEL.runRef * tuskerModelScale(TUSKER_SIM_SCALE),
  // The gore lands at 0.62 s; the death is timed off the clip at 1x.
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

/** [base visual key, tint, tint strength, extra]; the height it is drawn at
 *  is the template's row of SANCTUM_DRAWN_HEIGHTS (the fx share it). */
type PlaceholderRow = [string, number, number, Partial<VisualDef>?];

const ROWS: Record<string, [string, PlaceholderRow]> = {
  // Sanctum Boneguard: one of the held dead thawed out, a pale soldier in old
  // plate (the plated revenant rig, washed rime-grey; no bare skeleton).
  sanctum_boneguard: [
    BONEGUARD_ID,
    ['mob_hoard_frost_revenant', 0xc4d3dc, 0.42, { selfIllumination: 0.14 }],
  ],
  // Raised Bonewalker (Velkhar's adds): the same thawed dead, a size smaller.
  sanctum_raised_bonewalker: [
    BONEWALKER_ID,
    ['mob_hoard_frost_revenant', 0xaebdb4, 0.4, { selfIllumination: 0.1 }],
  ],
  // Sanctum Scaleguard: Korzul's wyrm rig, the drowned brood, meltwater-dark
  // (the fx drip meltwater off it).
  sanctum_scaleguard: [
    SCALEGUARD_ID,
    ['mob_dragonkin', 0x9cc8c4, 0.34, { selfIllumination: 0.14 }],
  ],
  // Broodsworn Thawcaller: a hooded cultist in furs, its soul lantern swung on
  // a crook like a censer on a chain (the mist chanter's rig, warmed to fur
  // brown; its lantern glows and the fx trail soul-smoke off it).
  sanctum_thawcaller: [THAWCALLER_ID, ['bastion_mistweaver', 0xc49a74, 0.24]],
  // Broodsworn Goadsmith: a burly cultist in a bear-fur hood and a leather
  // apron, a long goad iron in his fist (the fx heat its tip).
  sanctum_goadsmith: [
    GOADSMITH_ID,
    [
      'mob_bruiser',
      0x6e4a32,
      0.38,
      { attach: [{ url: 'models/weapons/spear_a.glb', bone: 'handslot.r' }] },
    ],
  ],
  // Broodsworn Pyre-Tender: a hooded cultist in soot-black robes; the fx set
  // the brazier fires burning over her yoke.
  sanctum_pyre_tender: [
    PYRE_TENDER_ID,
    ['mob_hoard_void_acolyte', 0xc0743c, 0.3, { selfIllumination: 0.2 }],
  ],
  // Rime Whelp: a thawed whelp, pale and frosted, frost on its wings. The
  // grey-blue storm drake rig washed rime-white (dragonkin_baby's green atlas
  // cannot be paled by a tint, which only multiplies; the fx dust it with
  // frost).
  sanctum_rime_whelp: [
    RIME_WHELP_ID,
    ['mob_hoard_stormscale_drake', 0xe4f4ff, 0.7, { selfIllumination: 0.5 }],
  ],
  // Ogre Sledge-Hauler: the ogre in furs and a hauling harness.
  sanctum_sledge_hauler: [
    SLEDGE_HAULER_ID,
    ['mob_ogre', 0x7a6248, 0.36, { selfIllumination: 0.06 }],
  ],
  // Glacier Splinter: a walking shard of the Quench, blue ice over the Smith's
  // rune-iron core (the rime elemental, glacier blue and glowing).
  sanctum_glacier_splinter: [
    GLACIER_SPLINTER_ID,
    [
      'mob_hoard_rime_elemental',
      0x86c8ec,
      0.5,
      {
        selfIllumination: 0.42,
        meshToggles: [{ nodes: ['*'], hideNow: SPLINTER_SHATTERED_GESTURE }],
      },
    ],
  ],
};

/** The Sanctum's defs: the placeholders derived from the base rigs already in
 *  `visuals`, the Soul Brazier prop, and the Sledge Tusker's own body. */
export function sanctumCreatureLooks(
  visuals: Readonly<Record<string, VisualDef>>,
): Record<string, VisualDef> {
  const out: Record<string, VisualDef> = {};
  for (const [key, [mobId, [base, tint, tintStrength, extra]]] of Object.entries(ROWS)) {
    const def = visuals[base];
    if (!def) continue;
    const height = sanctumDrawnHeight(mobId, 1);
    // A hovering rig keeps its gap in proportion to its new height.
    const hover = def.hover !== undefined ? (def.hover * height) / def.height : undefined;
    out[key] = { ...def, height, hover, tint, tintStrength, ...extra };
  }
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
