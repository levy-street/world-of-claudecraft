// The Gravewyrm Sanctum trash's own Blender bodies (delivered to
// E:/woc/entregas/santuario/trash; the builders are kept under
// scripts/assets/gravewyrm_sanctum_trash/). Each one replaces its re-tinted
// placeholder in sanctum_creature_looks.ts under the same visual key, so the
// mob ids, the templates and the fx stay as they are.
//
// Every body is drawn at its SANCTUM_DRAWN_HEIGHTS row (the fx place their
// fires, tethers and glows on it): `height` is that row over the template's
// sim scale, and the gaits' reference speeds are the authored ones times the
// drawn size over the authored size. Every bar the sim casts that has a body
// clip plays it with its contact frame on the bar's end (castClipSync, rate =
// contact / bar).

import { MOBS } from '../../sim/data';
import { GOADSMITH_RERIVET, KORGATH_TUNING } from '../../sim/encounters/gravewyrm_sanctum/boss_ids';
import {
  BONEGUARD_ID,
  BONEWALKER_ID,
  GLACIER_SPLINTER_ID,
  GOADSMITH_ID,
  PYRE_TENDER_ID,
  RIME_WHELP_ID,
  SCALEGUARD_ID,
  SLEDGE_HAULER_ID,
  THAWCALLER_ID,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import {
  SANCTUM_BRANDING_IRON,
  SANCTUM_CINDER_BREATH,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_GOAD,
  SANCTUM_ICE_BLOCK_TOSS,
  SANCTUM_PLANT_BRAZIER,
  SANCTUM_RIME_BREATH,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_WARMING_RITE,
} from '../../sim/mob/trash_kit/sanctum_cast_ids';
import {
  BLOCK_RELEASE,
  BONEWALKER_RISE_GESTURE,
  HAULER_ENRAGE_GESTURE,
  SANCTUM_DRAWN_HEIGHTS,
  SPLINTER_COPY_GESTURE,
  SPLINTER_FRACTURE_GESTURE,
  SPLINTER_SHATTERED_GESTURE,
  sanctumDrawnHeight,
} from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import type { VisualDef } from './manifest';

const CREATURES = 'models/creatures';

/** A clip's play rate that lands its contact frame on a bar's last frame. */
export function barRate(contact: number, bar: number | undefined): number {
  return bar && bar > 0 ? contact / bar : 1;
}

/** One authored body: its Idle bounds height and gaits as built (yards, yd/s). */
export interface SanctumTrashBody {
  readonly url: string;
  /** The Idle bounds height as authored (what the renderer normalizes). */
  readonly idleHeight: number;
  readonly walkRef: number;
  readonly runRef: number;
}

/** In-game yards per authored yard: the template's drawn row over the body. */
export function trashModelScale(body: SanctumTrashBody, templateId: string): number {
  return (SANCTUM_DRAWN_HEIGHTS[templateId] ?? body.idleHeight) / body.idleHeight;
}

/** The url, the look's height and the gaits scaled to the drawn size. */
function sized(body: SanctumTrashBody, templateId: string) {
  const k = trashModelScale(body, templateId);
  return {
    url: body.url,
    height: sanctumDrawnHeight(templateId, 1),
    walkRef: body.walkRef * k,
    runRef: body.runRef * k,
  };
}

// ---- Sanctum Boneguard and the Raised Bonewalker ------------------------------------

/** The Sanctum Boneguard: one of the held dead thawed out, a tall soldier of
 *  the Smith's age in his old frosted plate, the Smith's rune glowing up his
 *  notched blade (52 bones, ten clips). */
export const BONEGUARD_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_boneguard.glb`,
  idleHeight: 4.56,
  walkRef: 1.51,
  runRef: 5.81,
};

/** The Raised Bonewalker: the same dead worse kept (no helm, the skull split,
 *  no backplate, the sword snapped in half), on the same rig and clips. */
export const BONEWALKER_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_raised_bonewalker.glb`,
  idleHeight: 4.4,
  walkRef: 1.51,
  runRef: 5.81,
};

/** Thaw: the soldier tears free of the ice, crouched, and straightens into
 *  his guard (the ice bursts at 0.45 s and 1.05 s). The Boneguard's respawn
 *  and every Bonewalker's arrival. */
const DEAD_CLIPS = {
  idle: 'Idle',
  combatIdle: 'CombatIdle',
  walk: 'Walk',
  // Onrush rides the run (the sim moves it at three times; the run clamps).
  run: 'Run',
  attack: ['Attack', 'Attack2', 'Attack3'],
  hit: ['Hit'],
  death: 'Death',
  flourish: 'Thaw',
} as const;

// ---- Sanctum Scaleguard ---------------------------------------------------------------

/** The Sanctum Scaleguard: one of Korzul's drowned brood, upright on digitigrade
 *  legs, gill fans and a spined crest, embers still glowing in its throat, the
 *  Smith's iron collar and pauldron, a ringed halberd (52 bones). */
export const SCALEGUARD_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_scaleguard.glb`,
  idleHeight: 4.7,
  walkRef: 1.6,
  runRef: 6.33,
};

/** Its clips' contact frames (seconds at 1x): the cinders leave the jaws,
 *  the tail crosses the rear. */
export const SCALEGUARD_CLIP = { cinderBreath: 2.0, counterweightLash: 1.0 } as const;

const scaleguard = MOBS[SCALEGUARD_ID];

// ---- the Broodsworn cultists ----------------------------------------------------------

/** The Broodsworn Thawcaller: a Gravecaller in a quilted fur-collared robe and
 *  a deep hood, swinging a caged soul lantern on a shepherd's crook (26 bones,
 *  ten skinned material parts, a 30 fps timeline). */
export const THAWCALLER_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_thawcaller.glb`,
  idleHeight: 4.4957,
  walkRef: 1.125,
  runRef: 4.5,
};

/** Its rites' contact frames (seconds at 1x): the Warming Rite's soulfire
 *  leaves the lantern; Thaw the Held's soul is ripped up out of the corpse. */
export const THAWCALLER_CLIP = { warmingRite: 2.5, thawTheHeld: 3.0 } as const;

const thawcaller = MOBS[THAWCALLER_ID];

/** The Broodsworn Goadsmith: a burly cultist under a bear's head and pelt, a
 *  scorched leather apron, a long red-hot goad iron in his right fist. */
export const GOADSMITH_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_goadsmith.glb`,
  idleHeight: 4.7442,
  walkRef: 1.125,
  runRef: 4.5,
};

/** Its bars' contact frames (seconds at 1x): the Goad's prod, the Branding
 *  Iron's thrust, the Re-rivet's last hammer blow on Korgath's chain. */
export const GOADSMITH_CLIP = { goad: 2.0, brandingIron: 2.0, reRivet: 6.0 } as const;

const goadsmith = MOBS[GOADSMITH_ID];

/** The Broodsworn Pyre-Tender: a cultist in soot-black robes under a yoke of
 *  two burning soul braziers, her hands clamped on its handles. */
export const PYRE_TENDER_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_pyre_tender.glb`,
  idleHeight: 4.4952,
  walkRef: 1.125,
  runRef: 4.5,
};

/** Its plant's contact frame (seconds at 1x): the brazier set down on the ice. */
export const PYRE_TENDER_CLIP = { plantBrazier: 1.5 } as const;

const pyreTender = MOBS[PYRE_TENDER_ID];

// ---- the Rime Whelp -------------------------------------------------------------------

/** The Korzul-kit clips key their first frame one 24 fps frame in. */
const KEY_LEAD = 1 / 24;

/** The Rime Whelp: a thawed whelp of Korzul's drowned brood, his own body made
 *  young (a big head and eyes, stubby horns, short intact wings), its hide
 *  frosted pale blue, hoarfrost on its spines (80 bones). */
export const RIME_WHELP_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_rime_whelp.glb`,
  idleHeight: 3.2,
  // The Korzul kit's gaits (4.8 and 24 yd/s at his size) at the whelp's 0.169.
  walkRef: 4.8 * 0.16945,
  runRef: 24 * 0.16945,
};

/** Its clips' beats in the file: the frost leaves the jaws, the bite closes. */
export const RIME_WHELP_CLIP = { rimeBreath: 0.6 + KEY_LEAD, bite: 0.62 + KEY_LEAD } as const;

const rimeWhelp = MOBS[RIME_WHELP_ID];

// ---- the Ogre Sledge-Hauler -----------------------------------------------------------

/** The Ogre Sledge-Hauler: a huge hunched mountain ogre in a fur mantle and kilt
 *  and the cult's hauling harness (two crossed straps on iron rings, sledge hooks
 *  at his hips), a haul chain and hook wrapped round his right fist. His own ice
 *  block rides the Weapon bone between his palms in IceBlockToss only. */
export const SLEDGE_HAULER_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_sledge_hauler.glb`,
  idleHeight: 5.255,
  walkRef: 1.429,
  runRef: 5.986,
};

/** The toss's release in the clip (seconds at 1x): the block leaves his hands. */
export const SLEDGE_HAULER_CLIP = { tossRelease: 1.25 } as const;

const hauler = MOBS[SLEDGE_HAULER_ID];
/** The fx fly their block from BLOCK_RELEASE of the bar to the ring on its end
 *  (sanctum_trash_fx.ts paintBlocks): his clip lets go on that same frame. */
const tossBar = hauler?.trashKit?.toss?.castTime ?? 0;
const splinterBurstDelay = MOBS[GLACIER_SPLINTER_ID]?.trashKit?.deathBurst?.delay ?? 0;

// ---- the Glacier Splinter -------------------------------------------------------------

/** The Glacier Splinter: a walking shard of the Quench, faceted blue ice
 *  chunks each rigid on its own bone over a core of the Smith's rune-iron, the
 *  heart crystal glowing in the chest's window. */
export const GLACIER_SPLINTER_BODY: SanctumTrashBody = {
  url: `${CREATURES}/sanctum_glacier_splinter.glb`,
  idleHeight: 5.401,
  walkRef: 1.29,
  runRef: 5.0,
};

/** Its clips' beats (seconds at 1x): Death ends on the core's flare as the
 *  Shatter goes off; Fracture's crack. */
export const GLACIER_SPLINTER_CLIP = { deathFlare: 2.0, fractureCrack: 0.3 } as const;

/** The Shatter hides the whole body (the fx throw its shards). */
export const SPLINTER_SHATTER_TOGGLES = [{ nodes: ['*'], hideNow: SPLINTER_SHATTERED_GESTURE }];

export const SANCTUM_TRASH_LOOKS: Record<string, VisualDef> = {
  // 4.6 yd to the helm's peak at its 1.15.
  sanctum_boneguard: {
    ...sized(BONEGUARD_BODY, BONEGUARD_ID),
    clips: { ...DEAD_CLIPS, attack: [...DEAD_CLIPS.attack], hit: [...DEAD_CLIPS.hit] },
    oneShotsHoldAttacks: ['Thaw'],
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // 3.7 yd at its 1.0: a size smaller than the Boneguard it was. A Thaw the
  // Held corpse or one of Velkhar's adds climbs out of the ice on arrival
  // (sanctum_kit_fx.ts offers BONEWALKER_RISE_GESTURE when it is first seen).
  sanctum_raised_bonewalker: {
    ...sized(BONEWALKER_BODY, BONEWALKER_ID),
    clips: {
      ...DEAD_CLIPS,
      attack: [...DEAD_CLIPS.attack],
      hit: [...DEAD_CLIPS.hit],
      entrance: 'Thaw',
    },
    entranceGesture: BONEWALKER_RISE_GESTURE,
    oneShotsHoldAttacks: ['Thaw'],
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // 4.7 yd to its halberd's spike at its 1.45 (the crest about 4.4). Both bars
  // land on their clips' contact: the Cinder Breath's head-drive on the 2 s
  // bar's end, the Counterweight Lash's tail crossing the cone behind it on
  // the 1 s bar's end; each plays its follow-through out.
  sanctum_scaleguard: {
    ...sized(SCALEGUARD_BODY, SCALEGUARD_ID),
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      castByAbility: {
        [SANCTUM_CINDER_BREATH]: 'CinderBreath',
        [SANCTUM_COUNTERWEIGHT_LASH]: 'CounterweightLash',
      },
      castTimeScaleByAbility: {
        [SANCTUM_CINDER_BREATH]: barRate(
          SCALEGUARD_CLIP.cinderBreath,
          scaleguard?.breathCone?.castTime,
        ),
        [SANCTUM_COUNTERWEIGHT_LASH]: barRate(
          SCALEGUARD_CLIP.counterweightLash,
          scaleguard?.trashKit?.tailLash?.castTime,
        ),
      },
      castPlayOut: ['CinderBreath', 'CounterweightLash'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // 4.4 yd at its 1.6. The Warming Rite raises the lantern over a hurt ally;
  // Thaw the Held bows it low over the Boneguard's corpse, the lantern
  // circling, the free hand clawing at the ice, and rips the soul up on the 3 s
  // bar's end. Both land on their bars and play their follow-through out.
  sanctum_thawcaller: {
    ...sized(THAWCALLER_BODY, THAWCALLER_ID),
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [SANCTUM_WARMING_RITE]: 'WarmingRite',
        [SANCTUM_THAW_THE_HELD]: 'ThawTheHeld',
      },
      castTimeScaleByAbility: {
        [SANCTUM_WARMING_RITE]: barRate(
          THAWCALLER_CLIP.warmingRite,
          thawcaller?.trashKit?.mend?.castTime,
        ),
        [SANCTUM_THAW_THE_HELD]: barRate(
          THAWCALLER_CLIP.thawTheHeld,
          thawcaller?.trashKit?.reanimate?.castTime,
        ),
      },
      castPlayOut: ['WarmingRite', 'ThawTheHeld'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // 4.6 yd at its 1.75. The Goad prods the iron at an ally; the Branding Iron
  // holds it up glowing beside his face through the bar and lunges it out at
  // the victim on the bar's end; Korgath's heroic Re-rivet hammers the chain
  // back down through its 6 s channel. Every bar lands on its clip's contact.
  sanctum_goadsmith: {
    ...sized(GOADSMITH_BODY, GOADSMITH_ID),
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [SANCTUM_GOAD]: 'Goad',
        [SANCTUM_BRANDING_IRON]: 'BrandingIron',
        [GOADSMITH_RERIVET]: 'ReRivet',
      },
      castTimeScaleByAbility: {
        [SANCTUM_GOAD]: barRate(GOADSMITH_CLIP.goad, goadsmith?.trashKit?.goad?.castTime),
        [SANCTUM_BRANDING_IRON]: barRate(
          GOADSMITH_CLIP.brandingIron,
          goadsmith?.trashKit?.brand?.castTime,
        ),
        [GOADSMITH_RERIVET]: barRate(GOADSMITH_CLIP.reRivet, KORGATH_TUNING.rerivetChannel),
      },
      castPlayOut: ['Goad', 'BrandingIron', 'ReRivet'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // 4.4 yd at its 1.65. Plant Soul Brazier stoops under the yoke and sets a
  // brazier down on the ice on the 1.5 s bar's end (the brazier appears then).
  sanctum_pyre_tender: {
    ...sized(PYRE_TENDER_BODY, PYRE_TENDER_ID),
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: { [SANCTUM_PLANT_BRAZIER]: 'PlantBrazier' },
      castTimeScaleByAbility: {
        [SANCTUM_PLANT_BRAZIER]: barRate(
          PYRE_TENDER_CLIP.plantBrazier,
          pyreTender?.trashKit?.call?.castTime,
        ),
      },
      castPlayOut: ['PlantBrazier'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // 3.6 yd to its horns at its 1.6. It bites and rakes; the Rime Breath coils
  // the neck back, flares the wings and snaps the head forward with the jaws
  // wide on the 0.6 s bar's end, the frost puff playing out. Dying, it folds
  // onto its side (the Hoarfrost Pop is the fx's).
  sanctum_rime_whelp: {
    ...sized(RIME_WHELP_BODY, RIME_WHELP_ID),
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      castByAbility: { [SANCTUM_RIME_BREATH]: 'RimeBreath' },
      castTimeScaleByAbility: {
        [SANCTUM_RIME_BREATH]: barRate(
          RIME_WHELP_CLIP.rimeBreath,
          rimeWhelp?.trashKit?.cone?.castTime,
        ),
      },
      castPlayOut: ['RimeBreath'],
      flourish: 'Roar',
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    // Its 8 yd chase: the bounding run a little past its authored cadence.
    runTimeScaleMax: 2,
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.08,
  },
  // 5.8 yd to his crown at his 2.1 (2.2 players), hunched under the mantle. The Ice Block
  // Toss squats, rips a block out of the glacier, heaves it overhead and hurls
  // it: his own block vanishes on the frame the fx block takes off (60 percent
  // of the 2 s bar), landing on the ring as the bar ends and standing there as
  // the Ice Slab. His enrage beats his chest and roars (HAULER_ENRAGE_GESTURE).
  sanctum_sledge_hauler: {
    ...sized(SLEDGE_HAULER_BODY, SLEDGE_HAULER_ID),
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      attackByAbility: { [HAULER_ENRAGE_GESTURE]: 'Enrage' },
      attackTimeScaleByAbility: { [HAULER_ENRAGE_GESTURE]: 1 },
      hit: ['Hit'],
      death: 'Death',
      castByAbility: { [SANCTUM_ICE_BLOCK_TOSS]: 'IceBlockToss' },
      castTimeScaleByAbility: {
        [SANCTUM_ICE_BLOCK_TOSS]: barRate(SLEDGE_HAULER_CLIP.tossRelease, BLOCK_RELEASE * tossBar),
      },
      castPlayOut: ['IceBlockToss'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    oneShotsHoldAttacks: ['Enrage'],
    attackTimeScale: 1,
    deathTimeScale: 1,
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // 5.4 yd at its 1.9; each Fracture half at 72 percent of that (the sim's own
  // scale on the copy and the shrunk original, applied live at the view). At
  // half health the crack staggers it and every piece jolts out from the core
  // and grinds back: the original plays Fracture on the split, the copy as its
  // entrance. Dying, it kneels while the core swells; the Death clip ends on
  // the flare as the Shatter goes off 2 s later, and the body hides.
  sanctum_glacier_splinter: {
    ...sized(GLACIER_SPLINTER_BODY, GLACIER_SPLINTER_ID),
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      attackByAbility: { [SPLINTER_FRACTURE_GESTURE]: 'Fracture' },
      attackTimeScaleByAbility: { [SPLINTER_FRACTURE_GESTURE]: 1 },
      hit: ['Hit'],
      death: 'Death',
      entrance: 'Fracture',
    },
    entranceGesture: SPLINTER_COPY_GESTURE,
    oneShotsHoldAttacks: ['Fracture'],
    meshToggles: SPLINTER_SHATTER_TOGGLES,
    attackTimeScale: 1,
    // The kneel and the swelling core run exactly to the Shatter's fuse.
    deathTimeScale:
      GLACIER_SPLINTER_CLIP.deathFlare / (splinterBurstDelay || GLACIER_SPLINTER_CLIP.deathFlare),
    authoredAtlas: true,
    // Its pale baked ice deepened to glacier blue on the snowfield.
    tint: 0x6aaee6,
    tintStrength: 0.45,
    selfIllumination: 0.06,
  },
};
