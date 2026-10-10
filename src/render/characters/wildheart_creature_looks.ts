// The Wildheart Basin's creature looks (docs/design/dungeon-rework/
// wildheart_basin.md section 4). The rest are PLACEHOLDERS: shipped rigs
// re-tinted for the jungle so every new creature of the reworked basin is
// visible and animated from day one, until the art phase gives each its own
// body. The Great Saurian, the Great Jaguar, the Gorgebloom, the Lasher, the
// Sprout and the Basin Raptor have their own Blender bodies
// (WILDHEART_GREAT_SAURIAN_LOOK and its siblings). Every
// key keeps the mob id and the visual key, so a swap is a def change.
// manifest.ts merges these over its VISUALS and maps the templates through
// MOB_KEYS (WILDHEART_MOB_KEYS).
//
// Sizes ride the templates' sim scales (sim/content/wildheart.ts): `grow`
// stands every creature well past a player (2.6 yd) without touching the sim's
// reach (the owner's rule: imposing, never toy-like). Heights below are the
// drawn height at the template's scale.

import { MOBS } from '../../sim/data';
import {
  BASIN_RAPTOR_ID,
  BEAST_CALL_OF_THE_HUNT,
  BEAST_HEEL,
  BEAST_PIT_QUAKE,
  BEAST_THICKHIDE_WARD,
  BEAST_TUNING,
  BLOOM_GORGE,
  BLOOM_POLLINATE,
  BLOOM_SEED_RAIN,
  BLOOM_SPIT,
  BLOOM_VINE_LASH,
  SAURIAN_ENRAGE,
  SAURIAN_HOWDAH_BREAK,
  SAURIAN_STOMP,
  SAURIAN_TAIL_SWIPE,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_TUNING,
} from '../../sim/encounters/wildheart_basin/ids';
import {
  WILDHEART_ENTANGLING_LASH,
  WILDHEART_PLANT_TOTEM,
  WILDHEART_POUNCE,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOAD_HEX,
  WILDHEART_TOTEM_PULSE,
  WILDHEART_WAR_ROAR,
} from '../../sim/mob/trash_kit/wildheart_cast_ids';
import {
  RAPTOR_FRENZY_GESTURE,
  TOTEM_RISE_GESTURE,
  TRASH_CAST_CLIPS,
  trashCastClipRate,
  trashCastSeconds,
} from '../wildheart_basin/basin_trash_fx_core';
import {
  BEASTMASTER_CLIP,
  BEASTMASTER_MODEL,
  BEASTMASTER_SIM_SCALE,
  BINDER_MODEL,
  BINDER_SIM_SCALE,
  beastmasterQuakeRate,
  binderPlantRate,
  DREAD_TOTEM_MODEL,
  dreadRattleRate,
  RAPTOR_MODEL,
  RAPTOR_SIM_SCALE,
  raptorPounceRate,
  SUN_TOTEM_MODEL,
  TOAD_CLIP,
  TOAD_MODEL,
  TOAD_SIM_SCALE,
  TOTEM_SIM_SCALE,
  trashLookHeight,
  trashLookHover,
  ZULGAR_CLIP,
  ZULGAR_MODEL,
  ZULGAR_SIM_SCALE,
} from '../wildheart_basin/basin_trash_model_core';
import {
  GORGE_RATE,
  GORGEBLOOM_GLOW,
  GORGEBLOOM_ROAR_GESTURE,
  SEED_RAIN_RATE,
  SPIT_RATE,
  THORN_SPROUT_EMERGE_GESTURE,
  VINE_LASH_RATE,
} from '../wildheart_basin/gorgebloom_fx_core';
import {
  GORGEBLOOM_CLIP,
  GORGEBLOOM_MODEL,
  gorgebloomLookHeight,
  gorgebloomLookHover,
} from '../wildheart_basin/gorgebloom_model_core';
import {
  heelPounceTimeScale,
  JAGUAR_CLIP,
  JAGUAR_MODEL,
  JAGUAR_SIM_SCALE,
  jaguarLookHeight,
  jaguarModelScale,
} from '../wildheart_basin/jaguar_model_core';
import { lasherLashRate } from '../wildheart_basin/lasher_fx_core';
import {
  authoredLookHeight,
  authoredLookHover,
  LASHER_MODEL,
  LASHER_SIM_SCALE,
  SPROUT_MODEL,
  SPROUT_SIM_SCALE,
} from '../wildheart_basin/lasher_model_core';
import {
  SAURIAN_CLIP,
  SAURIAN_MODEL,
  SAURIAN_SIM_SCALE,
  saurianLookHeight,
  saurianModelScale,
} from '../wildheart_basin/saurian_model_core';
import type { ClipMap, VisualDef } from './manifest';

/** The gestures the basin's fx send the Saurian's howdah (saurian_fx.ts):
 *  hide it at once (a view built after the break) and mend it (a reset pull). */
export const SAURIAN_HOWDAH_GONE_GESTURE = 'wildheart_saurian_howdah_gone';
export const SAURIAN_HOWDAH_WHOLE_GESTURE = 'wildheart_saurian_howdah_whole';

/** The Great Saurian (an art-guide body: concept, Tripo, a rig built for the
 *  mesh, every clip animated at 30 fps): a long-necked ford beast under the
 *  Sunbone's spiked howdah, its Hexcaller rider in it, eleven clips. 13.4 yd
 *  to the top of its head at its 3.2 (saurian_model_core.ts, drawn at its
 *  authored size). The swing lands on frame 18 of its 1.5 s clip, and both
 *  strikes are cast bars whose clips land on the bar's end (the tail crosses
 *  the cone at 1.00 s of its 1 s bar, the forefeet slam at 2.00 s of the 2 s
 *  bar), so everything plays at 1x and the strikes finish as play-outs; the
 *  howdah breaking and the enrage are gestures off their spellfx. The howdah
 *  and the rider are their own meshes: hidden once the break has played. */
export const WILDHEART_GREAT_SAURIAN_LOOK: VisualDef = {
  url: SAURIAN_MODEL.url,
  height: saurianLookHeight(),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack'],
    contacts: { Attack: [SAURIAN_CLIP.attackHit] },
    attackByAbility: { [SAURIAN_HOWDAH_BREAK]: 'HowdahBreak', [SAURIAN_ENRAGE]: 'Enrage' },
    attackTimeScaleByAbility: { [SAURIAN_HOWDAH_BREAK]: 1, [SAURIAN_ENRAGE]: 1 },
    hit: ['Hit'],
    death: 'Death',
    cast: 'Roar',
    castByAbility: { [SAURIAN_TAIL_SWIPE]: 'TailSwipe', [SAURIAN_STOMP]: 'Stomp' },
    castTimeScaleByAbility: { [SAURIAN_TAIL_SWIPE]: 1, [SAURIAN_STOMP]: 1 },
    castPlayOut: ['TailSwipe', 'Stomp'],
    flourish: 'Roar',
  },
  castPlayOutHoldsAttacks: true,
  oneShotsHoldAttacks: ['HowdahBreak', 'Enrage'],
  meshToggles: [
    {
      nodes: ['GreatSaurianHowdah', 'GreatSaurianRider'],
      hideAfter: {
        gesture: SAURIAN_HOWDAH_BREAK,
        seconds: SAURIAN_CLIP.howdahGone,
        clip: 'HowdahBreak',
      },
      hideNow: SAURIAN_HOWDAH_GONE_GESTURE,
      showNow: SAURIAN_HOWDAH_WHOLE_GESTURE,
    },
  ],
  // The gaits' reference speeds at the drawn size (the planted feet slide at
  // 1.77 and 7.63 yards a second): its 2.1 patrol wades at about 1.2x, its 6
  // chase ambles at about 0.8x.
  walkRef: SAURIAN_MODEL.walkRef * saurianModelScale(SAURIAN_SIM_SCALE),
  runRef: SAURIAN_MODEL.runRef * saurianModelScale(SAURIAN_SIM_SCALE),
  // The swing lands its blow at 0.567 s (contacts); the death's splashes are
  // timed off the clip at 1x (saurian_fx.ts).
  attackTimeScale: 1,
  deathTimeScale: 1,
  authoredAtlas: true,
  // The widest override the click-capsule guard allows (2x CLICK_RADIUS_CAP,
  // tests/nythraxis_bone_spike_model.test.ts): wider swallows the raid's clicks.
  clickRadius: 4.4,
};

/** How fast the rooted bloom swings round to a new target (rad/s): a quarter
 *  turn in about 0.9 s, its Turn loop playing while it comes round. */
export const GORGEBLOOM_TURN_RATE = 2;

/** The Gorgebloom on an art-guide body (gorgebloom_model_core.ts): a rafflesia
 *  the size of a house, a fanged ring maw on a squat bulb in a cradle of five
 *  spotted petals, four pollen sacs on stalks, eight thorned vines across the
 *  pool and its prey's bones among them. Drawn at its authored size, 6.1 yd to
 *  the tip of its raised back petal at its 2.8, its waterline on the pivot.
 *  The melee bite lands on frame 18 of its 1.5 s clip at 1x (contacts). All
 *  three bars land their blow (the spit, the slam, the bite) on the bar's end
 *  at 1x and finish as play-outs; Pollinate, Bloom Spit and the pull's roar
 *  are gestures sent by gorgebloom_fx.ts. It never walks: it slews round to
 *  face its target, its vines shuffling in the Turn loop, and its gullet and
 *  sacs glow from its own emissive map (GORGEBLOOM_GLOW). */
export const WILDHEART_GORGEBLOOM_LOOK: VisualDef = {
  url: GORGEBLOOM_MODEL.url,
  height: gorgebloomLookHeight(),
  hover: gorgebloomLookHover(),
  clips: {
    idle: 'Idle',
    // It never walks; turning in place is all the locomotion it has.
    walk: 'Turn',
    run: 'Turn',
    turn: 'Turn',
    attack: ['Attack'],
    contacts: { Attack: [GORGEBLOOM_CLIP.attackBite] },
    hit: ['Hit'],
    death: 'Death',
    cast: 'Roar',
    castByAbility: {
      [BLOOM_SEED_RAIN]: 'SeedRain',
      [BLOOM_VINE_LASH]: 'VineLash',
      [BLOOM_GORGE]: 'Gorge',
    },
    castTimeScaleByAbility: {
      [BLOOM_SEED_RAIN]: SEED_RAIN_RATE,
      [BLOOM_VINE_LASH]: VINE_LASH_RATE,
      [BLOOM_GORGE]: GORGE_RATE,
    },
    castPlayOut: ['SeedRain', 'VineLash', 'Gorge'],
    attackByAbility: {
      [BLOOM_POLLINATE]: 'Pollinate',
      [BLOOM_SPIT]: 'BloomSpit',
      [GORGEBLOOM_ROAR_GESTURE]: 'Roar',
    },
    attackTimeScaleByAbility: {
      [BLOOM_POLLINATE]: 1,
      [BLOOM_SPIT]: SPIT_RATE,
      [GORGEBLOOM_ROAR_GESTURE]: 1,
    },
    flourish: 'Roar',
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  oneShotsHoldAttacks: ['Pollinate', 'BloomSpit', 'Roar'],
  turnRate: GORGEBLOOM_TURN_RATE,
  glowPulses: GORGEBLOOM_GLOW,
  // The melee bite: coiled back, struck out, shut on frame 18 at 1x.
  attackTimeScale: 1,
  // The death's splash and sink are timed off the clip at 1x (gorgebloom_fx.ts).
  deathTimeScale: 1,
  authoredAtlas: true,
  // The widest override the click-capsule guard allows (2x CLICK_RADIUS_CAP,
  // tests/nythraxis_bone_spike_model.test.ts): wider swallows the raid's clicks.
  clickRadius: 4.4,
};

/** The Snarlvine Lasher (scripts/assets/wildheart_vine_lasher, built in
 *  Blender): a lurching tangle of bark and vine on root feet, a branch crown,
 *  sap-lit eyes and a fanged maw, its right arm the lash. Drawn at its authored
 *  size, 6.5 yd to the crown spikes at its 2.2. The Entangling Lash plays
 *  LashCast from the bar's start at the rate that lands the whip's tip on the
 *  lane at the bar's end (lasher_fx.ts carries the lane on from there); the
 *  swipe and the stab are its swings. */
export const WILDHEART_VINE_LASHER_LOOK: VisualDef = {
  url: LASHER_MODEL.url,
  height: authoredLookHeight(LASHER_MODEL, LASHER_SIM_SCALE),
  hover: authoredLookHover(LASHER_MODEL, LASHER_SIM_SCALE),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack', 'Attack2'],
    hit: ['Hit'],
    death: 'Death',
    cast: 'LashCast',
    castByAbility: { [WILDHEART_ENTANGLING_LASH]: 'LashCast' },
    castTimeScaleByAbility: {
      [WILDHEART_ENTANGLING_LASH]: lasherLashRate(),
    },
    castPlayOut: ['LashCast'],
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  // Its gaits at the drawn size (one model yard per game yard).
  walkRef: LASHER_MODEL.walkRef,
  runRef: LASHER_MODEL.runRef,
  attackTimeScale: 1.15,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.8,
};

/** The Thorn Sprout (the Lasher's rig at half size, its own sculpt: a seed-bud
 *  head split by a toothed maw). 3 yd at its 1.5, over a player's head. It
 *  bursts out of its pod with Emerge (the entrance, offered by
 *  gorgebloom_fx.ts as it rises), bites (it has no other swing), and its
 *  half-scale gaits are sped up to its sprint. */
export const WILDHEART_THORN_SPROUT_LOOK: VisualDef = {
  url: SPROUT_MODEL.url,
  height: authoredLookHeight(SPROUT_MODEL, SPROUT_SIM_SCALE),
  hover: authoredLookHover(SPROUT_MODEL, SPROUT_SIM_SCALE),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Bite'],
    hit: ['Hit'],
    death: 'Death',
    entrance: 'Emerge',
  },
  entranceGesture: THORN_SPROUT_EMERGE_GESTURE,
  oneShotsHoldAttacks: ['Emerge'],
  walkRef: SPROUT_MODEL.walkRef,
  runRef: SPROUT_MODEL.runRef,
  runTimeScaleMax: 2.6,
  attackTimeScale: 1.1,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.2,
};

/** The Basin Raptor (scripts/assets/wildheart_basin_raptor, built in Blender):
 *  one sculpted hide in moss and ochre under dark tiger stripes, a big
 *  scowling saurian head, the red quill crest of the Sunbone's pack beasts,
 *  their bone-plated collar and fang charm, a great sickle on each inner toe.
 *  Drawn at its authored size, 4.4 yd to the skull (4.9 to the crest's tips)
 *  at its 1.7. Its leap (the trash kit's Pounce, flown by the sim from the
 *  windup's tick) plays Pounce at once, landing its feet on the flight's last
 *  frame; a packmate's death drives it screaming into its Pack Frenzy
 *  (Screech, a gesture off basin_trash_fx.ts). It swings a bite and a
 *  sickle slash. */
export const WILDHEART_BASIN_RAPTOR_LOOK: VisualDef = {
  url: RAPTOR_MODEL.url,
  height: trashLookHeight(RAPTOR_MODEL, RAPTOR_SIM_SCALE),
  hover: trashLookHover(RAPTOR_MODEL, RAPTOR_SIM_SCALE),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Bite', 'Slash'],
    attackByAbility: { [WILDHEART_POUNCE]: 'Pounce', [RAPTOR_FRENZY_GESTURE]: 'Screech' },
    attackTimeScaleByAbility: {
      [WILDHEART_POUNCE]: raptorPounceRate(MOBS[BASIN_RAPTOR_ID]?.trashKit?.leap?.seconds ?? 0),
      [RAPTOR_FRENZY_GESTURE]: 1,
    },
    hit: ['Hit'],
    death: 'Death',
    flourish: 'Screech',
  },
  oneShotsHoldAttacks: ['Pounce'],
  walkRef: RAPTOR_MODEL.walkRef,
  runRef: RAPTOR_MODEL.runRef,
  attackTimeScale: 1.1,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.6,
};

/** The Spore Toad's death rate: its puffballs burst 0.6 s after it falls. */
const TOAD_DEATH_RATE = TOAD_CLIP.burst / 0.6;

/** The Spore Toad's clips (its body and the Toad Hex's toad share them). */
const SPORE_TOAD_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Bite', 'Slam'],
  hit: ['Hit'],
  death: 'Death',
};

/** The Spore Toad (scripts/assets/wildheart_spore_toad, built in Blender): a
 *  squat warty swamp toad bigger than a boar, its back crusted with glowing
 *  puffballs, mushrooms and spore pods (its own emissive map), great gold eyes
 *  on top, a mouth from ear to ear. Drawn at its authored size, 3.5 yd to the
 *  eyes at its 2.4. The Snaring Tongue plays Tongue from the bar's start (the
 *  rate its jaws fly open on the bar's end, TRASH_CAST_CLIPS), the throat
 *  swelling through the bar, and finishes the reel as a play-out; the death
 *  bloats it and bursts its puffballs into the Spore Burst's cloud. */
export const WILDHEART_SPORE_TOAD_LOOK: VisualDef = {
  url: TOAD_MODEL.url,
  height: trashLookHeight(TOAD_MODEL, TOAD_SIM_SCALE),
  hover: trashLookHover(TOAD_MODEL, TOAD_SIM_SCALE),
  clips: {
    ...SPORE_TOAD_CLIPS,
    cast: 'Tongue',
    castByAbility: { [WILDHEART_SNARING_TONGUE]: 'Tongue' },
    castTimeScaleByAbility: {
      [WILDHEART_SNARING_TONGUE]: trashCastClipRate(WILDHEART_SNARING_TONGUE),
    },
    castPlayOut: ['Tongue'],
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  walkRef: TOAD_MODEL.walkRef,
  runRef: TOAD_MODEL.runRef,
  attackTimeScale: 1.1,
  // The puffballs burst about 0.6 s after it falls, as its spore cloud rises.
  deathTimeScale: TOAD_DEATH_RATE,
  authoredAtlas: true,
  clickRadius: 2.2,
};

/** The Sunbone Totem-Binder (scripts/assets/wildheart_totem_binder, built in
 *  Blender): a hunched, long-armed jungle troll in teal hide and Sunbone paint
 *  under a jaguar-skull mask and red plumes, a bundle of carved stakes on his
 *  back, the Binder's Staff (a jaguar crown under a bone sun) in his fist.
 *  Drawn at its authored size, 5.9 yd to the plumes at its 1.95. The Plant
 *  Totem bar plays PlantTotem from its start at 1x: the staff raised high and
 *  driven butt first into the earth on the bar's end, where the totem rises. */
export const WILDHEART_TOTEM_BINDER_LOOK: VisualDef = {
  url: BINDER_MODEL.url,
  height: trashLookHeight(BINDER_MODEL, BINDER_SIM_SCALE),
  hover: trashLookHover(BINDER_MODEL, BINDER_SIM_SCALE),
  clips: {
    idle: 'Idle',
    combatIdle: 'CombatIdle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack', 'Attack2'],
    hit: ['Hit'],
    death: 'Death',
    cast: 'Cast',
    castByAbility: { [WILDHEART_PLANT_TOTEM]: 'PlantTotem' },
    castTimeScaleByAbility: {
      [WILDHEART_PLANT_TOTEM]: binderPlantRate(trashCastSeconds(WILDHEART_PLANT_TOTEM)),
    },
    castPlayOut: ['PlantTotem'],
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  walkRef: BINDER_MODEL.walkRef,
  runRef: BINDER_MODEL.runRef,
  attackTimeScale: 1.1,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.4,
};

/** The Fanglord Beastmaster on an art-guide body (basin_trash_model_core.ts
 *  BEASTMASTER_MODEL): a scarred jungle troll under a jaguar-head hood, the
 *  pelt hanging down his back as a cloak, bone pauldrons, the Beastspear held
 *  point-up. 6.7 yd to the spear's point at his 2.35, a head over his jaguar.
 *  His blows land on frame 18 of their 1.5 s clips at 1x (contacts). The Beast
 *  Pit Quake plays Quake over its bar (the spear and his stamp strike the pit
 *  floor on its end); Call of the Hunt and Thickhide Ward play WarCry and Ward
 *  (gestures off their spellfx, basin_fx.ts). */
export const WILDHEART_BEASTMASTER_LOOK: VisualDef = {
  url: BEASTMASTER_MODEL.url,
  height: trashLookHeight(BEASTMASTER_MODEL, BEASTMASTER_SIM_SCALE),
  hover: trashLookHover(BEASTMASTER_MODEL, BEASTMASTER_SIM_SCALE),
  clips: {
    idle: 'Idle',
    combatIdle: 'CombatIdle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack', 'Attack2'],
    contacts: {
      Attack: [BEASTMASTER_CLIP.attackHit],
      Attack2: [BEASTMASTER_CLIP.attackHit],
    },
    attackByAbility: { [BEAST_CALL_OF_THE_HUNT]: 'WarCry', [BEAST_THICKHIDE_WARD]: 'Ward' },
    attackTimeScaleByAbility: { [BEAST_CALL_OF_THE_HUNT]: 1, [BEAST_THICKHIDE_WARD]: 1 },
    hit: ['Hit'],
    death: 'Death',
    cast: 'Cast',
    castByAbility: { [BEAST_PIT_QUAKE]: 'Quake' },
    castTimeScaleByAbility: { [BEAST_PIT_QUAKE]: beastmasterQuakeRate(BEAST_TUNING.quakeCast) },
    castPlayOut: ['Quake'],
    flourish: 'WarCry',
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  oneShotsHoldAttacks: ['WarCry', 'Ward'],
  walkRef: BEASTMASTER_MODEL.walkRef,
  runRef: BEASTMASTER_MODEL.runRef,
  attackTimeScale: 1,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.8,
};

/** A totem never walks: its gaits stand creaking in place. */
const TOTEM_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Idle',
  run: 'Idle',
  attack: ['Hit'],
  hit: ['Hit'],
  death: 'Death',
  entrance: 'Rise',
};

/** The Sunbone Totem (scripts/assets/wildheart_sunbone_totem, built in
 *  Blender): a carved ironwood post of stacked jaguar faces on a root-bound
 *  basalt plinth, crowned by a bone sun with a jaguar skull whose eyes burn
 *  green-gold (its own emissive map), bone charms swinging from its crossbar.
 *  6.6 yd at its 1.6. It rises out of the ground when the Binder plants it
 *  (Rise, a gesture off basin_trash_fx.ts), flares on every mending pulse
 *  (Pulse, off basin_fx.ts) and topples into the earth with its Binder. */
export const WILDHEART_SUNBONE_TOTEM_LOOK: VisualDef = {
  url: SUN_TOTEM_MODEL.url,
  height: trashLookHeight(SUN_TOTEM_MODEL, TOTEM_SIM_SCALE),
  hover: trashLookHover(SUN_TOTEM_MODEL, TOTEM_SIM_SCALE),
  clips: {
    ...TOTEM_CLIPS,
    attackByAbility: { [WILDHEART_TOTEM_PULSE]: 'Pulse' },
    attackTimeScaleByAbility: { [WILDHEART_TOTEM_PULSE]: 1 },
  },
  entranceGesture: TOTEM_RISE_GESTURE,
  oneShotsHoldAttacks: ['Rise'],
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.4,
};

/** The Sunbone Dread Totem: the same post under a great tusked troll skull
 *  washed in old blood, red light in its sockets, bone rattles on its bar.
 *  6.4 yd at its 1.6. Its Rattling Dread plays Rattle over the 2 s bar (the
 *  jaw chattering harder and harder, the scream landing on the bar's end). */
export const WILDHEART_SUNBONE_DREAD_TOTEM_LOOK: VisualDef = {
  url: DREAD_TOTEM_MODEL.url,
  height: trashLookHeight(DREAD_TOTEM_MODEL, TOTEM_SIM_SCALE),
  hover: trashLookHover(DREAD_TOTEM_MODEL, TOTEM_SIM_SCALE),
  clips: {
    ...TOTEM_CLIPS,
    cast: 'Rattle',
    castByAbility: { [WILDHEART_RATTLING_DREAD]: 'Rattle' },
    castTimeScaleByAbility: {
      [WILDHEART_RATTLING_DREAD]: dreadRattleRate(trashCastSeconds(WILDHEART_RATTLING_DREAD)),
    },
    castPlayOut: ['Rattle'],
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  entranceGesture: TOTEM_RISE_GESTURE,
  oneShotsHoldAttacks: ['Rise'],
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.4,
};

/** [base visual key, tint, tint strength, height factor over the base, extra]. */
type PlaceholderRow = [string, number, number, number, Partial<VisualDef>?];

const ROWS: Record<string, PlaceholderRow> = {
  // The Howdah Hexcaller: the Hexcaller in the howdah's war red.
  wildheart_howdah_hexcaller: ['mob_wildheart_hexcaller', 0xa3322a, 0.22, 1],
};

/** A rig taught the hunt's casts (the trash mechanics pass): each cast id plays
 *  its existing clip (basin_trash_fx_core.ts TRASH_CAST_CLIPS), a fitted clip
 *  at the rate that plays it once over the sim's bar. */
function withHuntCasts(def: VisualDef | undefined, castIds: readonly string[]): VisualDef | null {
  if (!def) return null;
  const castByAbility = { ...def.clips.castByAbility };
  const castTimeScaleByAbility = { ...def.clips.castTimeScaleByAbility };
  for (const id of castIds) {
    const c = TRASH_CAST_CLIPS[id];
    if (!c) continue;
    castByAbility[id] = c.clip;
    castTimeScaleByAbility[id] = trashCastClipRate(id);
  }
  return { ...def, clips: { ...def.clips, castByAbility, castTimeScaleByAbility } };
}

/** Each hunting rig and the casts it learns. */
const HUNT_CAST_RIGS: Readonly<Record<string, readonly string[]>> = {
  mob_wildheart_stalker: [WILDHEART_QUARRY_MARK],
  mob_wildheart_ravager: [WILDHEART_WAR_ROAR],
  mob_wildheart_hexcaller: [WILDHEART_TOAD_HEX],
};

/** The Toad Hex's toad (the polymorph slot's other animal,
 *  characters/form_visual_selection_core.ts): the Spore Toad's own body,
 *  shrunk to a squat thing at a player's knee. */
const TOAD_FORM_HEIGHT = 1.3;

/** Zulgar vanishes (heroic Ambush): his whole model hides, then returns. */
export const ZULGAR_HIDE_GESTURE = 'wildheart_zulgar_hide';
export const ZULGAR_SHOW_GESTURE = 'wildheart_zulgar_show';

/** Zulgar, Voice of the Basin on an art-guide body (basin_trash_model_core.ts
 *  ZULGAR_MODEL): the masked jaguar priest, the sun staff upright at his side
 *  out of the fight. His blows land on frame 18 of their 1.5 s clips at 1x
 *  (contacts). The Wildheart Pulse and the Spirit of the Hunt land on their
 *  1.5 s bars' ends at 1x (the staff driven into the loam; the spirit taking
 *  him) and finish as play-outs. His whole model hides for the heroic Ambush. */
export const WILDHEART_ZULGAR_LOOK: VisualDef = {
  url: ZULGAR_MODEL.url,
  height: trashLookHeight(ZULGAR_MODEL, ZULGAR_SIM_SCALE),
  hover: trashLookHover(ZULGAR_MODEL, ZULGAR_SIM_SCALE),
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    jump: 'Jump',
    attack: ['Attack', 'Attack2'],
    contacts: { Attack: [ZULGAR_CLIP.attackHit], Attack2: [ZULGAR_CLIP.attackHit] },
    hit: ['Hit'],
    death: 'Death',
    cast: 'Pulse',
    castByAbility: { [ZULGAR_PULSE]: 'Pulse', [ZULGAR_SPIRIT_HUNT]: 'SpiritHunt' },
    castTimeScaleByAbility: {
      [ZULGAR_PULSE]: ZULGAR_CLIP.pulseStrike / ZULGAR_TUNING.pulseCast,
      [ZULGAR_SPIRIT_HUNT]: ZULGAR_CLIP.huntTaken / ZULGAR_TUNING.huntCast,
    },
    castPlayOut: ['Pulse', 'SpiritHunt'],
  },
  castPlayOutHoldsAttacks: true,
  castClipSync: true,
  meshToggles: [{ nodes: ['*'], hideNow: ZULGAR_HIDE_GESTURE, showNow: ZULGAR_SHOW_GESTURE }],
  walkRef: ZULGAR_MODEL.walkRef,
  runRef: ZULGAR_MODEL.runRef,
  attackTimeScale: 1,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.8,
};

/** The Great Jaguar's clips (both bodies: the Fanglord's and its jade spirit). */
const GREAT_JAGUAR_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Bite', 'Claw'],
  // Both land on frame 18 of their 1.5 s clips at 1x: drawn back, then the
  // whole cat thrown after the jaws or the rake.
  contacts: { Bite: [JAGUAR_CLIP.biteClose], Claw: [JAGUAR_CLIP.clawRake] },
  hit: ['Hit'],
  death: 'Death',
  // Stunned in a control window: the dazed loop, head hanging, legs splayed.
  stunned: 'Stunned',
  cast: 'Roar',
  // Heel!: the crouch, the wiggle and the leap, slowed so the forepaws land on
  // the bar's last frame, where the sim sets it down at its master's side.
  castByAbility: { [BEAST_HEEL]: 'Pounce' },
  castTimeScaleByAbility: { [BEAST_HEEL]: heelPounceTimeScale(BEAST_TUNING.heelCast) },
  castPlayOut: ['Pounce'],
  // Call of the Hunt: the master's roar answered (a gesture off its spellfx).
  attackByAbility: { roar: 'Roar' },
  attackTimeScaleByAbility: { roar: 1 },
  flourish: 'Roar',
};

/** The Fanglord's Great Jaguar on an art-guide body (jaguar_model_core.ts): a
 *  great cat in gold with black rosettes, Sunbone war paint, a jade collar the
 *  Pack Bond ties to and a feathered headdress. Drawn at its authored size, 4.7
 *  yd to its ears at its 2.4. */
export const WILDHEART_GREAT_JAGUAR_LOOK: VisualDef = {
  url: JAGUAR_MODEL.url,
  height: jaguarLookHeight(),
  clips: GREAT_JAGUAR_CLIPS,
  castPlayOutHoldsAttacks: true,
  walkRef: JAGUAR_MODEL.walkRef * jaguarModelScale(JAGUAR_SIM_SCALE),
  runRef: JAGUAR_MODEL.runRef * jaguarModelScale(JAGUAR_SIM_SCALE),
  attackTimeScale: 1,
  deathTimeScale: 1,
  authoredAtlas: true,
  clickRadius: 1.8,
};

/** The basin's defs: the placeholders derived from the base rigs already in
 *  `visuals`, and the creatures with bodies of their own. */
export function wildheartPlaceholderLooks(
  visuals: Readonly<Record<string, VisualDef>>,
): Record<string, VisualDef> {
  const out: Record<string, VisualDef> = {};
  for (const [key, [base, tint, tintStrength, grow, extra]] of Object.entries(ROWS)) {
    const def = visuals[base];
    if (!def) continue;
    out[key] = { ...def, height: def.height * grow, tint, tintStrength, ...extra };
  }
  out.wildheart_great_saurian = WILDHEART_GREAT_SAURIAN_LOOK;
  out.wildheart_gorgebloom = WILDHEART_GORGEBLOOM_LOOK;
  out.wildheart_vine_lasher = WILDHEART_VINE_LASHER_LOOK;
  out.wildheart_thorn_sprout = WILDHEART_THORN_SPROUT_LOOK;
  out.wildheart_fanglord_jaguar = WILDHEART_GREAT_JAGUAR_LOOK;
  out.wildheart_basin_raptor = WILDHEART_BASIN_RAPTOR_LOOK;
  out.wildheart_spore_toad = WILDHEART_SPORE_TOAD_LOOK;
  // The hunt's casts on the shipped troll rigs.
  for (const [key, casts] of Object.entries(HUNT_CAST_RIGS)) {
    const taught = withHuntCasts(out[key] ?? visuals[key], casts);
    if (taught) out[key] = taught;
  }
  // The Toad Hex's toad: the Spore Toad's own body shrunk to a player's knee.
  out.form_toad = {
    url: TOAD_MODEL.url,
    height: TOAD_FORM_HEIGHT,
    clips: SPORE_TOAD_CLIPS,
    walkRef: TOAD_MODEL.walkRef * (TOAD_FORM_HEIGHT / (TOAD_MODEL.idleTop - TOAD_MODEL.idleMin)),
    runRef: TOAD_MODEL.runRef * (TOAD_FORM_HEIGHT / (TOAD_MODEL.idleTop - TOAD_MODEL.idleMin)),
    authoredAtlas: true,
  };
  // Zulgar trades his shipped body for his art-guide one.
  out.mob_wildheart_high_priest = WILDHEART_ZULGAR_LOOK;
  // The Fanglord's Whistle's spirit jaguar (combat/wildheart_trinkets.ts): the
  // great cat's jade spirit body (translucent, its rosettes burning), at the
  // size the trinket's placeholder drew so a pet never walls off a fight.
  const spiritHeight = (visuals.form_cat?.height ?? 1.9) * 0.9;
  const spiritScale = spiritHeight / JAGUAR_MODEL.idleBoundsHeight;
  out.wildheart_spirit_jaguar = {
    url: JAGUAR_MODEL.spiritUrl,
    height: spiritHeight,
    clips: GREAT_JAGUAR_CLIPS,
    castPlayOutHoldsAttacks: true,
    walkRef: JAGUAR_MODEL.walkRef * spiritScale,
    runRef: JAGUAR_MODEL.runRef * spiritScale,
    attackTimeScale: 1,
    // Its jade wash is the cat's own texture recoloured (the GLB's own map).
    authoredAtlas: true,
    clickRadius: 1.4,
  };
  out.wildheart_totem_binder = WILDHEART_TOTEM_BINDER_LOOK;
  // The Fanglord Beastmaster trades his shipped body for his Blender one.
  out.mob_wildheart_beastmaster = WILDHEART_BEASTMASTER_LOOK;
  out.wildheart_sunbone_totem = WILDHEART_SUNBONE_TOTEM_LOOK;
  out.wildheart_sunbone_dread_totem = WILDHEART_SUNBONE_DREAD_TOTEM_LOOK;
  return out;
}

/** Each new Wildheart template's visual key (merged into manifest MOB_KEYS). */
export const WILDHEART_MOB_KEYS: Readonly<Record<string, string>> = {
  basin_raptor: 'wildheart_basin_raptor',
  spore_toad: 'wildheart_spore_toad',
  vine_lasher: 'wildheart_vine_lasher',
  thorn_sprout: 'wildheart_thorn_sprout',
  sunbone_totem_binder: 'wildheart_totem_binder',
  sunbone_totem: 'wildheart_sunbone_totem',
  sunbone_dread_totem: 'wildheart_sunbone_dread_totem',
  howdah_hexcaller: 'wildheart_howdah_hexcaller',
  fanglord_jaguar: 'wildheart_fanglord_jaguar',
  the_gorgebloom: 'wildheart_gorgebloom',
  great_saurian: 'wildheart_great_saurian',
};
