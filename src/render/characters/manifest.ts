// Visual manifest: maps every sim identity (player class, mob template/family,
// NPC id, druid/polymorph form) onto a rigged glTF asset + clip names + kit.
// Pure data + dispatch — no three.js imports, no loading.

import { MECH_CHROMAS, type MechChroma } from '../../sim/content/skins';
import { offhandMirrorsWeaponSkin } from '../../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import { ITEMS, MOBS } from '../../sim/data';
import {
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_PRISM_FLARE,
  COLOSSUS_RESONANT_SLAM,
  SELTHE_CHORUS_MARK,
  SELTHE_DROWNING_ARIA,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_SEA_SONG,
  SELTHE_SOLO_MARK,
  YSOLEI_CALL,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_UNDERTOW,
  YSOLEI_WRATH,
} from '../../sim/encounters/drowned_temple/ids';
import {
  KNELLWYRM_ARRIVE,
  KNELLWYRM_DREAD_BELLOW,
  KNELLWYRM_KNELL_BREATH,
  KNELLWYRM_KNELL_LAND,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_KNELL_RISE,
  KNELLWYRM_PYRE_STRAFE,
  KNELLWYRM_STRAFE_RUN,
  MORTHEN_DESCEND,
  MORTHEN_PROCLAIM,
  MORTHEN_RISE,
  MORTHEN_RITE_WAKES,
} from '../../sim/encounters/hollow_crypt/ids';
import {
  ILVANE_BONE_ORGAN,
  ILVANE_DIRGE,
  ILVANE_UNBROKEN_DIRGE,
} from '../../sim/encounters/hollow_crypt/ilvane_ids';
import {
  LADY_BRIDAL_FREEZE,
  LADY_BRIDES_LAMENT,
  LADY_EMBRACE_DROPPED,
  LADY_EMBRACE_HOLD,
  LADY_EMBRACE_RELEASED,
  LADY_FROZEN_EMBRACE,
} from '../../sim/encounters/hollow_crypt/lady_ids';
import {
  MARROW_BURIAL_TOLL,
  MARROW_GRAVEDIGGERS_BLOW,
  MARROW_MEASURE,
  MARROW_SHOVELFUL,
} from '../../sim/encounters/hollow_crypt/marrow_ids';
import { MORTHEN_REAP, MORTHEN_RITE } from '../../sim/encounters/hollow_crypt/morthen_ids';
import {
  GHOST_CAPTAIN_ANCHOR,
  GHOST_CAPTAIN_BOARDING,
  GHOST_CAPTAIN_BROADSIDE,
} from '../../sim/encounters/sunken_bastion/ghost_captain_ids';
import {
  OLEN_HALLOWED_BRINE,
  OLEN_OATH_KNEEL,
  OLEN_OATH_VIGIL,
  OLEN_REBOUNDING_BULWARK,
  OLEN_TIDE_SENTENCE,
  OSSICK_ANCHOR,
  OSSICK_CUDGEL,
  OSSICK_SHACKLE,
  VAEL_DROWNING_HYMN,
  VAEL_INTRO_RISE,
  VAEL_MIST_SURGE,
  VAEL_REAPING_SCYTHE,
  VAEL_SHADOWSTEP,
  VAEL_SINK,
  VAEL_VEIL_GATHER,
  VAEL_VEIL_RISE,
} from '../../sim/encounters/sunken_bastion/ids';
import {
  VARKHUL_ANVILS_DECREE_CAST_ID,
  VARKHUL_BOSS_ID,
  VARKHUL_FORGE_HAMMER_ABILITY_ID,
  VARKHUL_FORGESTORM_CAST_ID,
  VARKHUL_FRONTAL_CAST_ID,
} from '../../sim/encounters/varkhul';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
} from '../../sim/ignivar_raid_ids';
import { DUNGEON_MINIBOSS_STOMP_ABILITY_ID } from '../../sim/mob/dungeon_miniboss_stomp';
import { VARKHUL_CRUCIBLE_QUAKE_CAST_ID } from '../../sim/mob/healer_channel';
import { SUMMON_RISE_CUE } from '../../sim/mob/summon_rise';
import {
  BASTION_BOATHOOK,
  BASTION_BRINE_MEND,
  BASTION_FOG_WARD,
  BASTION_HALBERD_SWEEP,
  BASTION_LOOSE_ON_MY_MARK,
  BASTION_PIERCING_BOLT,
  BASTION_SNAPPED_FETTERS,
} from '../../sim/mob/trash_kit/bastion_cast_ids';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_GRAVE_BOLT,
  CRYPT_GRAVE_CLEAVE,
  CRYPT_GRAVESPARK_VOLLEY,
  CRYPT_MARROW_CRUSH,
  CRYPT_MURDER_CALL,
  CRYPT_PERCH_DIVE,
  CRYPT_RAISE_BONES,
  CRYPT_SKY_LANDING,
  CRYPT_STONE_SHRIEK,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../../sim/mob/trash_kit/cast_ids';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_CALL_THE_TIDE,
  TEMPLE_GLIMMER_VENOM,
  TEMPLE_LULLABY,
  TEMPLE_PALE_MENDING,
  TEMPLE_PEARL_SLAM,
  TEMPLE_PRISM_GLARE,
  TEMPLE_SKEWERING_TRIDENT,
  TEMPLE_SNAP,
  TEMPLE_TRIDENT_SWEEP,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import { NYTHRAXIS_BONE_SPIKE_ID } from '../../sim/nythraxis_bone_spike';
import {
  HOARD_CAST_BAT_DIVE,
  HOARD_CAST_BAT_DIVE_AIM,
  HOARD_CAST_BURROW,
  HOARD_CAST_COIN_SPIT,
  HOARD_CAST_COLLAPSE,
  HOARD_CAST_EMERGE,
  HOARD_CAST_ICE_AGE,
  HOARD_CAST_MIMIC_BITE,
  HOARD_CAST_MIMIC_LEAP,
  HOARD_CAST_MOLE_RAKE,
  HOARD_CAST_PULSAR_OVERLOAD,
  HOARD_CAST_SCREECH,
  HOARD_CAST_TUNNEL,
  HOARD_GOBLIN_ESCAPE_CAST,
} from '../../sim/rift/hoard_control_cast_ids';
import {
  ALL_CLASSES,
  type Entity,
  IGNIVAR_BOSS_ID,
  isMechWearer,
  type PlayerClass,
} from '../../sim/types';
import {
  VARKHUL_CINDER_REPAIR_END_ANIMATION_ID,
  VARKHUL_CINDER_REPAIR_START_ANIMATION_ID,
} from '../../sim/varkhul_cinder_artificer';
import { ITEM_WEAPON_VARIANTS } from '../../ui/weapon_variants';
import type { OverheadEmoteId } from '../../world_api';
import {
  TEMPLE_MOONSPAWN_RISE,
  TEMPLE_PILGRIM_FRENZY_GESTURE,
  TEMPLE_SENTINEL_SHELL_CLOSED,
  TEMPLE_SENTINEL_SHELL_OPEN,
} from '../drowned_temple/temple_fx_core';
import {
  HOARD_GESTURE_CALL_HAMMER,
  HOARD_GESTURE_CALL_STORM,
  HOARD_GESTURE_EMBER_FRONTAL,
  HOARD_GESTURE_FROST_GUST,
  HOARD_GESTURE_ICE_AGE_RELEASE,
} from '../hoard_boss_gestures_core';
import {
  MORTHEN_DEATH_LIFT,
  MORTHEN_HOVER,
  MORTHEN_REAP_SWEEP,
  MORTHEN_SCYTHE_HELD,
  MORTHEN_SCYTHE_UNFOLD,
  MORTHEN_STAFF_HELD,
  MORTHEN_TOLL,
} from '../hollow_crypt/morthen_fx_core';
import { KNELL_GESTURE_POUR, KNELL_GESTURE_SKY_ROAR } from '../hollow_crypt/morthen_rite_fx_core';
import type { LocoGaitThresholds } from '../locomotion';
import { BASTION_OPEN_CELLS_GESTURE } from '../sunken_bastion/bastion_creature_fx_core';
import {
  OSSICK_ANCHOR_AWAY_GESTURE,
  OSSICK_ANCHOR_BACK_MESH,
  OSSICK_ANCHOR_HOME_GESTURE,
  VAEL_VEIL_RISE_CLIP_RATE,
} from '../sunken_bastion/bastion_gaol_reaper_core';
import {
  OLEN_SHIELD_AWAY_GESTURE,
  OLEN_SHIELD_BONE,
  OLEN_SHIELD_CATCH_GESTURE,
  OLEN_SHIELD_HOME_GESTURE,
} from '../sunken_bastion/bastion_olen_fx_core';
import {
  BASTION_FETTERS_KNEEL_GESTURE,
  BASTION_PACK_HOWL_GESTURE,
} from '../sunken_bastion/bastion_trash_fx_core';
import { VARKHUL_FORGING_STRIKE_TIMESCALE } from '../varkhul_forge_hammer';
import type { BoneDialDef } from './bone_dials';
import type { ChargeGlowSpec } from './charge_glow_core';
import type { ClipTrackDrops } from './clip_track_drops';
import type { EyeGlowSpec } from './eye_glow_core';
import type { MeshToggleDef } from './gesture_mesh_toggles';
import type { GlowPulseSet } from './glow_pulse_core';
import { NPC_PROP_SET_IDS, type NpcLook, type NpcPropSet, npcLookFor } from './npc_looks';
import { SANCTUM_BOSS_LOOKS, SANCTUM_BOSS_MOB_KEYS } from './sanctum_boss_looks';
import { SANCTUM_MOB_KEYS, sanctumCreatureLooks } from './sanctum_creature_looks';
import type { WeaponLoadout } from './weapon_loadout_core';
import { WILDHEART_MOB_KEYS, wildheartPlaceholderLooks } from './wildheart_creature_looks';
import { type WocFit, wocAnimsUrl, wocBaseUrl } from './woc_armor_core';
import {
  WOC_DRUID_FEMALE_MANIFEST,
  WOC_DRUID_MANIFEST,
  WOC_HUNTER_FEMALE_MANIFEST,
  WOC_HUNTER_MANIFEST,
  WOC_MAGE_FEMALE_MANIFEST,
  WOC_MAGE_MANIFEST,
  WOC_PALADIN_FEMALE_MANIFEST,
  WOC_PALADIN_MANIFEST,
  WOC_PRIEST_FEMALE_MANIFEST,
  WOC_PRIEST_MANIFEST,
  WOC_ROGUE_FEMALE_MANIFEST,
  WOC_ROGUE_MANIFEST,
  WOC_SHAMAN_FEMALE_MANIFEST,
  WOC_SHAMAN_MANIFEST,
  WOC_WARLOCK_FEMALE_MANIFEST,
  WOC_WARLOCK_MANIFEST,
  WOC_WARRIOR_FEMALE_MANIFEST,
  WOC_WARRIOR_MANIFEST,
  type WocCharacterManifest,
} from './woc_character_manifest';

export interface EmoteClipSpec {
  clips: readonly string[];
  timeScale?: number;
  repeats?: number;
}

export interface ClipMap {
  idle: string;
  /** Extra standing-still clips, played one at a time in place of `idle` and
   *  then handed back to it over the standard one-shot crossfade. Purely
   *  cosmetic idle-breakers ("fidgets"): author each to END on the idle pose,
   *  because leaving idle CANCELS one mid-clip and the rig cuts straight back
   *  over a 0.18s fade. Empty/absent for every rig that just breathes.
   *
   *  These fire from ONE shared, jittered timer and are picked at random, so a
   *  given clip's own cadence falls as the pool grows. A clip that has to show
   *  up on a schedule belongs in `idleBeat` instead. */
  idleVariants?: string[];
  /** How often the `idleVariants` pool fires on this rig: a floor plus a per-fire
   *  jitter, seconds of standing still. Absent = the shared 5 s beat (visual.ts
   *  IDLE_VARIANT_MIN), tuned for a mount that is meant to be always mid-fidget. */
  idleVariantCadence?: { everySec: number; jitterSec?: number };
  /** Clip substitutions while the hands hold a given loadout (weapon_loadout_core.ts):
   *  'twohand' = a two-hand weapon (held in one fist on the WOC bodies), 'single' = a one-hand
   *  weapon with an empty off hand (the free hand stays down), 'dual' = a weapon in each hand.
   *  Every clip name the rig plays resolves through the active map (base states, one-shots,
   *  per-ability and per-hand entries); '' suppresses a clip under that loadout, and a variant
   *  the GLB lacks falls back to the named clip. Absent = the named clips whatever is held. */
  loadoutSwaps?: Partial<Record<WeaponLoadout, Readonly<Record<string, string>>>>;
  /** A signature idle on a FIXED cadence, scheduled independently of the
   *  `idleVariants` pool. Same contract as a fidget (one-shot, must end on the
   *  idle pose, cancelled the moment the rig stops standing still); the
   *  difference is only that it keeps its own clock, so "every N seconds"
   *  actually means it. */
  idleBeat?: { clip: string; everySec: number; jitterSec?: number };
  /** The braced battle stance: the idle a body holds while it is actually
   *  fighting someone, played instead of `idle` whenever the rig is engaged and
   *  standing still (see anim_state.desiredBaseState). Absent = the rig relaxes
   *  into its normal idle between swings, as every rig did before this existed.
   *  Its pose should match what the rig's attack and hit one-shots open and
   *  close on, so those blend into and out of it without a snap. */
  combatIdle?: string;
  /** The `combatIdle` clip is a RAISE that ends on the held guard (the KayKit `Block`:
   *  the shield comes up in its first third and is held to the last frame), not a
   *  seamless loop. Played once and clamped on that last frame for as long as the body
   *  stays braced, so the guard goes up once and holds, instead of dropping and rising
   *  again every loop; leaving the brace crossfades it down into the idle once.
   *  Absent = combatIdle loops, as every battle stance authored as a loop wants. */
  combatIdleHold?: boolean;
  /** The dazed loop a standing body holds while a stun rides it, in place of
   *  `idle` / `combatIdle` (stun_idle_core.ts). Absent = it stands in its idle. */
  stunned?: string;
  /** Loops a standing body holds in place of `idle` / `combatIdle` while it
   *  wears one of these aura ids (aura id to clip; stun_idle_core.ts
   *  auraHeldClip): the Shackled Prisoner kneeling while its Snapped Fetters
   *  hold. Checked before `stunned`. Absent = no aura-held pose. */
  heldByAura?: Readonly<Record<string, string>>;
  /** The loop a rooted body holds while it turns in place to face a new target,
   *  in place of `idle` / `combatIdle` (turn_in_place_core.ts; pair it with
   *  VisualDef.turnRate). Absent = it turns in its idle. */
  turn?: string;
  /** A one-shot the body plays once when it first arrives, on its
   *  VisualDef.entranceGesture (the Thorn Sprout bursting out of its pod). */
  entrance?: string;
  /** Low stalking poses for a concealed quadruped. Absent = ordinary gait. */
  prowlIdle?: string;
  prowlWalk?: string;
  walk: string;
  run: string;
  /** Native braced rush, selected by a cast window plus displayed movement. */
  rush?: string;
  /** Successful Onrush stop, separate from its looping travel pose. */
  rushArrival?: string;
  /** one-shot swing clips, rotated per attack */
  attack: string[];
  /** Contact autos on a rig whose ordinary attack is a ranged shot. */
  meleeAttack?: string[];
  /** A caster's typed wand projectile launch, independent of melee equipment. */
  wandAttack?: string;
  /** Optional per-ability swing or cast-gesture override. */
  attackByAbility?: Record<string, string>;
  /** Playback rate for authored per-ability clips that must keep exact timing. */
  attackTimeScaleByAbility?: Record<string, number>;
  /**
   * Which hand lights up while an ability winds, and how (render/characters/charge_glow.ts).
   *
   * Rides the same per-ability cue as the clip override, so the pose and the light are
   * chosen by one row and cannot describe two different mechanics.
   */
  chargeGlowByAbility?: Record<string, ChargeGlowSpec>;
  /** Optional weapon-style override for plain auto attacks. */
  attackByHand?: { twohand?: string; dualwield?: string };
  /** One-shots for an ABILITY swing with no per-ability override (round-robin), so a
   *  body can answer a special with a heavier blow than its auto-attack. Absent = the
   *  `attack` list serves both, as it always has. */
  abilityAttack?: string[];
  death: string;
  /** hit-react one-shots (optional — spider/raptor rigs have none) */
  hit?: string[];
  /** looping cast channel */
  cast?: string;
  /** Hold instead of replaying: the generic `cast` clip plays ONCE up to this
   *  many seconds in (the held gesture at the top of the raise: arm up,
   *  pointing) and FREEZES on that frame while the cast channels; the
   *  remainder (the recovery back to stance) plays on cast end via
   *  castPlayOut. Only the generic clip: castByAbility overrides keep their
   *  authored behavior. */
  castHoldPointSeconds?: number;
  /** Cast clips that FINISH as a one-shot when their cast ends mid-clip (the
   *  crash recovery, the pointing arm coming back down) instead of being cut
   *  by the base-pose crossfade. Opt-in per clip so a seamless cadence loop
   *  (the Forgefather's decree Forging) keeps its instant handoff. */
  castPlayOut?: readonly string[];
  /** Per-ability override for the looping cast clip (the windup LOOK of one
   *  cast differing from the rig's generic channel; the one-shot route in
   *  attackByAbility cannot cover held cast states). */
  castByAbility?: Record<string, string>;
  /** Playback rate for per-ability cast clips whose authored length must land
   *  its key pose inside the cast window. Also re-applied every frame, since
   *  actions are cached per clip and a clip shared with attackByAbility would
   *  otherwise carry that route's one-shot timescale into the cast loop. */
  castTimeScaleByAbility?: Record<string, number>;
  /** Cast clips that rise INTO sight (the body under the floor, rising): they
   *  take the rig at full weight at once instead of crossfading out of the
   *  pose before them (which blends the standing pose into the first frames,
   *  a figure popping in upright before it drops and rises), and play ONCE,
   *  holding their last pose (a loop drops the body back under for a frame).
   *  See anim_state.ts clipSnapsIn. */
  castSnapIn?: readonly string[];
  sitDown?: string;
  sitIdle?: string;
  /** swim base. On the authored player lane this is the SUBMERGED stroke and
   *  carries the whole prone posture; on rigs without one it is a lie-down pose
   *  the renderer pitches procedurally (see visual.ts SWIM_PITCH_*). */
  swim?: string;
  /** surface swim stroke, played instead of `swim` whenever the body's head is
   *  above the waterline. Absent = the rig swims the same way at any depth. */
  swimSurface?: string;
  /** the swim IDLE: treading water, upright and sculling, played whenever a
   *  swimmer stops. Absent = the stroke keeps playing in place. */
  swimIdle?: string;
  /** walking through water too shallow to swim in. Absent = the dry walk. */
  wade?: string;
  /** airborne base pose while jumping/falling */
  jump?: string;
  /** Airborne pose for a jump taken while MOVING, in either direction.
   *
   *  A launch clip can have anticipation or an instant takeoff, never both: a
   *  visible wind-up needs frames going down before it goes up, and those
   *  frames are exactly the delay a moving jump must not have. So a rig may
   *  author two, with `jump` carrying the standing version.
   *
   *  Which one plays is latched AT TAKEOFF, and has to be: forward momentum
   *  persists into the air, so "moving" is still true mid-jump and the takeoff
   *  is no longer observable by the time the pose is chosen.
   *
   *  Absent = `jump` is used from any takeoff, as it always was. */
  jumpMoving?: string;
  /** long-fall flail (arms windmilling, legs kicking), played once the body
   *  is dropping faster than any hop can (anim_state.isFallingAtSpeed).
   *  Absent = the jump pose holds for the whole fall, as it always did. */
  fall?: string;
  /** Touchdown one-shot. Naming one opts the rig into the held-jump treatment:
   *  `jump` stops looping and CLAMPS on its last frame (its airborne pose) for
   *  however long the body stays off the ground, then this fires on the landing
   *  edge. A rig without it keeps looping `jump` exactly as before. */
  land?: string;
  walkBack?: string;
  /** The side runs, played while the body runs sideways across its facing (a
   *  Q/E strafe keeps facing and slides the body at the full run speed), in
   *  place of the forward run sliding across the ground. A rig enters the state
   *  only when BOTH load (anim_state.desiredBaseState). Absent = the run. */
  strafeLeft?: string;
  strafeRight?: string;
  /** one-shot played on respawn (skeleton awaken / boss taunt) */
  flourish?: string;
  /** Looping sleep pose for a mob that keeps hours (MobTemplate.slumber): played for
   *  as long as the entity's `asleep` bit rides, above every locomotion state. */
  sleep?: string;
  /** One-shot on the asleep-to-awake edge (the dawn rise). Absent = a plain crossfade
   *  from the sleep loop back into idle. */
  wake?: string;
  /** Idle loops held while an aura rides the body, keyed by aura id
   *  (aura_idle_core.ts): the standing pose between swings changes, every other
   *  state still outranks it. The first row the body carries wins. */
  idleByAura?: Record<string, string>;
  /** arm gesture for the Z-key sheathe toggle; the held-prop swap lands at its
   *  midpoint (see visual.ts setWeaponStowed). Absent = snap with no gesture. */
  stow?: string;
  /** Fraction of the `stow` clip at which the held prop swaps hands for the
   *  back (the hand's over-the-shoulder peak). Absent = the KayKit chop's
   *  0.28; the WOC chop peaks later since its 2026-09-16 wind-up retime. */
  stowSwapFraction?: number;
  /** The `stow` clip is an authored sheathe (reach, swap, recover): it plays
   *  whole at 1x with no procedural arm raise, the prop still swapping at
   *  stowSwapFraction. Absent = the KayKit chop-windup treatment (sped up, cut
   *  at the swap, an additive arm lift toward the shoulder). */
  stowPlaysWhole?: boolean;
  /** Seconds into the two-strike `attackByHand.dualwield` clip at which the
   *  offhand strike begins. The sim swings each hand as its own event, so with
   *  this set a mainhand swing plays the clip up to the cut and an offhand
   *  swing plays from it (CharacterVisual mints the halves at construction,
   *  clip_split.ts); absent = the whole clip per swing, as every KayKit rig. */
  dualWieldSplit?: number;
  /** Both-hands clips for two dual-wield swings landing in the same render frame (matched
   *  weapon speeds keep both hands on one sim tick), cycled in order: the second swing of the
   *  frame replaces the half the first one started (attack_swing_core.ts pickDualSwing).
   *  Absent = the whole `attackByHand.dualwield` clip. */
  dualWieldPair?: readonly string[];
  /** Seconds from a clip's first frame to each blade contact, in hand order, for every melee
   *  clip that lands a blow (split halves under their minted names). A swing starts on its
   *  damage event, so the target's flinch, the impact spark and sound, and the damage number
   *  are held until the listed contact (attack_swing_core.ts contactDelaySec; the FCT painter
   *  and contact_queue.ts). Absent or unlisted = the effects play at once. */
  contacts?: Readonly<Record<string, readonly number[]>>;
  /** Clips minted at load by cutting a GLB clip in two at `at` seconds, under
   *  the given names, for a cast that must HOLD one half and release the other
   *  (the hunter's timed shots: the aim half is the generic cast clip held at
   *  its end, the release half the per-ability one-shot the damage event
   *  plays, so the raise never replays under the shot). clip_split.ts. */
  clipSplits?: readonly { clip: string; at: number; names: readonly [string, string] }[];
  /** player-facing overhead emote one-shots; clips are sourced from the GLB. */
  emote?: Partial<Record<OverheadEmoteId, EmoteClipSpec>>;
  /** An authored ledge-climb one-shot (the WOC warrior's 0.3 s Climb): played
   *  once at 1x from the grab and clamped on its ending stance while the sim
   *  finishes the pull; the procedural climb pose yields to it entirely.
   *  Absent = the hand-posed climb (CharacterVisual.applyClimbPose). */
  climb?: string;
  /** The overhead emote a shout cast plays (CharacterVisual.playShout, reached
   *  from both the ability painter and the generic castFx arm). Absent = cheer;
   *  null = no roar gesture at all (the VFX ring and wave still play). */
  shoutEmote?: OverheadEmoteId | null;
}

export interface AttachDef {
  url: string;
  bone: string;
  position?: [number, number, number];
  rotationY?: number;
  /** Copy grip from a built-in accessory node on the character rig (e.g. Spellbook_open). */
  gripRef?: string;
  /** A pure swap-slot BASE that never renders anywhere: it exists only so an
   *  `offhandSlot` can point at it (the game skips the entry whenever the
   *  offhand is empty or unmapped), so its url and grip are dead data. The
   *  wiki generator filters these out of GuideModelSpec, which is what keeps
   *  the class figures from showcasing another class's fixed prop. Never set
   *  this on an attach that should showcase in the guide (the shield classes'
   *  offhand bases deliberately stay unflagged). */
  swapOnly?: boolean;
  /** The size the prop draws at about its hand, on top of its model's own fit: set by the
   *  swap path from the equipped ITEM (held_item_size_core.ts: a common or uncommon weapon
   *  draws a fifth smaller), or authored on a fixed attach whose rig is not the WOC bodies'
   *  scale (WOC_CRYPT_PROP_SIZE). Absent is 1. */
  size?: number;
}

export interface VisualDef {
  url: string;
  /** Optional extra GLBs that provide animation clips for static rig files. */
  animUrls?: string[];
  /** world-unit height (pivot->crown) at e.scale = 1 */
  height: number;
  clips: ClipMap;
  /** floating rigs hover: mesh bottom sits this far above the pivot. NEGATIVE
   *  sinks a grounded rig whose posed bounds dip BELOW its feet (a dragging
   *  tail): the ground anchor is the lowest skinned vertex, so without the
   *  sink the body is lifted until the tail tip touches and the feet float. */
  hover?: number;
  /** A creature that flies, or waits perched high over the floor (the Hollow
   *  Crypt's drake and gargoyles): its airborne state is read from its drawn
   *  height over the standing surface, as a player's is (a mob's `onGround`
   *  never leaves true), so `jump` plays while it is up (LOOPED, never clamped:
   *  a flight loop or a perch), `fall` while it plunges and `land` on touchdown. */
  flight?: boolean;
  /** A plain auto-attack trigger never stomps a `clips.castPlayOut` clip while
   *  it plays (as the cast loop or as its play-out): a breath's exhale or a
   *  tail sweep's follow-through lands in full, and the swing it would have
   *  shown is simply skipped. Per-ability triggers still play. */
  castPlayOutHoldsAttacks?: boolean;
  /** yaw applied so the model faces +Z (facing-0 convention) */
  yaw?: number;
  /** Optional texture-aware ambient lift for exceptionally dark authored bodies.
   *  With a `tint` set, the lift glows in the tinted colour rather than the
   *  atlas's own (the Bone Spike's ember recolour); untinted defs lift white. */
  selfIllumination?: number;
  /** Optional per-visual multiplier for scene environment reflections. */
  envMapIntensity?: number;
  /** How much of the sky environment's reflection the body's NON-METAL surfaces keep
   *  (standard tiers; env_sheen.ts). A dark authored atlas reads that albedo-free
   *  reflection as one grey film over cloth, leather and skin; metal keeps its own. */
  envSheen?: number;
  /** Force a fully diffuse surface response on the body materials: zero
   *  metalness, full roughness, and the metallic/roughness maps dropped, so
   *  the key/hemisphere/torch lights cannot lay a specular sheen over the
   *  albedo. For rigs whose authored PBR response reads as gloss under an
   *  interior light rig (the Ignivar raid roster). */
  matte?: boolean;
  /** Creased smooth shading for a faceted, flat-shaded rig: the crease angle
   *  in degrees below which neighbouring facets blend (smooth_normals.ts).
   *  Normals only: the triangles, the skin and the silhouette are unchanged,
   *  and only this def's clones take the smoothed geometry. */
  smoothNormals?: number;
  /** The body atlas is an AUTHORED baked texture (a Tripo or Blender export
   *  that carries its own shading, largely dark texels), not a KayKit palette.
   *  On the low graphics tier the Lambert rebuild adds a small uniform
   *  emissive floor for readability (assets.ts applyLowReadabilityLift);
   *  sized for bright palette swatches, that same constant lifts every dark
   *  texel of an authored atlas to one grey and reads as a flat film over the
   *  whole texture. With this flag the floor is scaled by the atlas instead
   *  (emissiveMap = map), so black stays black. Standard tiers ignore it.
   *  Opt-in per def on purpose: player bodies and every other kit rig keep
   *  the uniform floor they always had. */
  authoredAtlas?: boolean;
  /**
   * A permanently lit eye (render/characters/eye_glow.ts), for a creature whose eye IS its
   * identity. Always on, independent of what it happens to be casting.
   */
  eyeGlow?: EyeGlowSpec;
  /** The rig's `stow` gesture reaches over the RIGHT shoulder (the WOC Sheathe), so
   *  an upper-back carry sits behind that shoulder for a right-hand prop
   *  (back_grips.ts backGripFor). Absent = the table's left-shoulder carry. */
  rightShoulderSheathe?: boolean;
  /** Hide every held or sheathed weapon prop while the body swims (the props
   *  come back the moment it leaves the water). The WOC body has no tuned
   *  on-back pose yet, so its auto-sheathed kit floated over the stroke. */
  hideWeaponsWhileSwimming?: boolean;
  /** KayKit chars ship every accessory visible: non-skinned mesh nodes to KEEP.
   *  undefined = keep everything (creature GLBs have no accessories). */
  show?: string[];
  attach?: AttachDef[];
  /** Indices into `attach` whose model is replaced by the entity's equipped mainhand
   *  weapon (mapped via ITEM_WEAPON_VARIANTS). undefined/empty = the held weapon never
   *  changes with gear (hunter keeps its crossbow; mobs/NPCs are fixed). A fixed
   *  offhand left off this list stays authored (the warlock spellbook); a live
   *  equipped offhand uses `offhandSlot` below. */
  weaponSlots?: number[];
  /** Index into `attach` replaced by the entity's actual equipped offhand. Kept
   *  separate from `weaponSlots` so mainhand cosmetics cannot overwrite a live
   *  shield or second weapon. */
  offhandSlot?: number;
  /** Click-capsule radius override (world units). The default derives from
   *  the model footprint and is capped at 2.2 (assets.ts prepareVisual); a
   *  def sets this when the thing has to be reliably clickable in a crowd
   *  (the Nythraxis Bone Spike, which shares its footprint with the raider
   *  it pins). Presentation-side targeting help only: the sim never reads it. */
  clickRadius?: number;
  /** Draw no body for this entity (its click capsule, nameplate and bars
   *  stay): a part of a larger creature drawn once by its dungeon's own
   *  visuals (the Mere Hydra's heads). */
  bodyless?: boolean;
  /** Material tint: explicit color, 'entity' (use e.color), or none */
  tint?: number | 'entity';
  /** lerp amount toward the tint (default 0.4) */
  tintStrength?: number;
  /** u/s at which the walk/run cycles look right (timeScale matching) */
  walkRef?: number;
  walkBackRef?: number;
  runRef?: number;
  /** Cadence ceilings (defaults 1.8 walk / 1.6 run, anim_state.ts). Raise for a
   *  rig whose authored gait is slower than the body it carries: a mount runs
   *  at ONE fixed speed, so its time scale is a constant and the ceiling is
   *  what binds, making the reference look like a dead knob past that point. */
  walkTimeScaleMax?: number;
  runTimeScaleMax?: number;
  /** Wind the outgoing gait's cadence down across a crossfade instead of
   *  letting it hold its last speed while it dissolves. Opt-in per rig: it
   *  changes how every stop and gait change reads, so rigs adopt it one at a
   *  time on their own review rather than all at once. Most valuable on a rig
   *  whose cadence is pushed well past 1 (see runTimeScaleMax). */
  gaitWindDown?: boolean;
  /** u/s the strafe clips (ClipMap.strafeLeft/strafeRight) were authored at.
   *  Absent = runRef: a side run is timed like the forward run. */
  strafeRef?: number;
  prowlRef?: number;
  /** Opt-in gait coverage for short quadrupeds; other rigs keep global thresholds. */
  gait?: LocoGaitThresholds;
  runTimeScaleMin?: number;
  /** Pose-wrapper rise in world units for swimming and stationary paddling.
   *  Horizontal animal rigs keep their own waterline instead of the humanoid tread sink. */
  swimRise?: { stroke: number; tread: number };
  /** Swimming head top above the entity pivot, including swimRise, at scale 1. */
  swimHeadHeight?: number;
  attackTimeScale?: number;
  deathTimeScale?: number;
  /** Cut out of locomotion into idle instead of crossfading.
   *
   *  For a vehicle whose locomotion clip drives WHEELS. A crossfade keeps the
   *  outgoing clip playing while it fades, so the wheels keep turning for the
   *  length of the fade after the throttle is released, which reads as the car
   *  coasting on ice. A creature's legs blending to a stand is the opposite:
   *  there the fade is what stops it looking snapped, so this stays opt-in. */
  cutToIdle?: boolean;
  /** Final model-local sink for an authored death pose that ends above the
   *  normalized feet anchor. CharacterVisual eases it in only over the final
   *  quarter of the Death clip and restores the base offset on revive. */
  deathGroundOffset?: number;
  /** The opposite of deathGroundOffset, for a body drawn SUNK into the floor
   *  in life (a negative `hover`): its model is lifted by `yards` (model-local)
   *  eased over [from, to] of the Death clip (death_grounding_core.ts
   *  deathLiftOffset), so the authored death pose rests on the floor. */
  deathLift?: { yards: number; from: number; to: number };
  /** Hold the idle base state frozen on the FIRST frame of its clip instead of
   *  looping it: a downed/dormant look (the forge mech lies still on the ground
   *  on crawl frame 0 until it moves). Walk/run still play the clip normally, so
   *  a rig whose idle and walk share one clip animates the moment it starts
   *  moving. Pairs with the sim's MobTemplate.idleStationary. */
  idleFrozen?: boolean;
  /** Skip the boot preload sweep (manifestUrls); the asset is fetched on demand
   *  instead — e.g. the cosmetic-only Combat Mech, loaded via preloadMechAssets()
   *  when the skin-select preview opens, so it never bloats every client's boot. */
  lazyPreload?: boolean;
  /** Post-load orientation fixups for weapon/prop nodes baked INTO a creature
   *  GLB at the wrong angle (some KayKit handslot weapons ship without the grip
   *  flip the standalone weapon files carry). Node name as authored in the GLB;
   *  applied as a local-space rotation (radians) after the bind transform. */
  weaponFix?: { node: string; rotX?: number; rotY?: number; rotZ?: number }[];
  /** Glowing ring parented behind the head bone (the priest's Light halo).
   *  Value is the glow color; geometry/placement live in halo.ts. */
  halo?: number;
  /** Halo placement overrides, head-bone space (defaults in halo.ts): lift
   *  above the bone and ring radius, for models whose headgear the default
   *  ring would clip. */
  haloUpOffset?: number;
  haloRadius?: number;
  /** This GLB is a modular PART LIBRARY, not a finished character: every body
   *  part, hair style and armour slot piece rides one shared rig and the
   *  visible set is picked per entity (see modular.ts). assembleModel composes
   *  it instead of cloning the whole scene. */
  modular?: boolean;
  /** Two-state prop mob (the dragonkin egg): the GLB ships BOTH state meshes
   *  seated at the origin; alive shows `hide` only, and death swaps to `show`
   *  (the cracked-open shell IS the corpse). assembleModel seeds the alive
   *  state; CharacterVisual's enterDeath/revive flip it. Node names as
   *  authored in the GLB. */
  corpseMeshSwap?: { hide: string; show: string };
  /** The muster's training effigy (src/sim/muster_effigy.ts): the model carries the
   *  plank hide and lantern the effigy rig drives per viewer (effigy_rig.ts). */
  effigy?: boolean;
  /** This body is a WOC modular character (the artist's handoff rig): every
   *  part, face piece and armor piece rides ONE file and is shown or hidden per
   *  instance from this manifest (woc_parts_core.ts), never composed from the
   *  KayKit modular library. The class keeps its fixed `player_<class>` def on
   *  every surface (WOC_BODY_CLASSES in woc_parts_core.ts). */
  wocCharacter?: WocCharacterManifest;
  /** Boss stance vocabularies keyed by a presentation gesture id (Morthen's
   *  bell staff and the scythe it unfolds into, src/render/hollow_crypt/
   *  morthen_fx_core.ts). The gesture, sent through the renderer's
   *  triggerAttack seam, swaps the rig's whole ClipMap in place and plays the
   *  stance's `enter` one-shot when it names one; a gesture for the stance
   *  already held does nothing. `clips` should be one of these stances. */
  phaseClips?: Record<string, { clips: ClipMap; enter?: string }>;
  /** Bones turned on top of the clips by presentation gestures (the same
   *  triggerAttack seam a stance swap rides): a boss's gauge needle, armour
   *  plates that flip face. See bone_dials.ts for the contract. */
  dials?: readonly BoneDialDef[];
  /** Rotation tracks dropped from named clips when the visual is prepared, for
   *  bones a dial owns (the Warden's plates through its flip clip, the Prime
   *  Draft's hatch leaves through its hatch clips). See clip_track_drops.ts. */
  clipTrackDrops?: ClipTrackDrops;
  /** Position tracks removed from named clips when the visual is prepared: an
   *  airborne clip that carries its altitude on its root, for a body the sim
   *  already lifts (Korzul's hover clips). See clip_track_drops.ts. */
  clipPositionDrops?: ClipTrackDrops;
  /** Mesh nodes hidden or shown by presentation gestures (the same triggerAttack
   *  seam): the Great Saurian's howdah once it breaks. See gesture_mesh_toggles.ts. */
  meshToggles?: readonly MeshToggleDef[];
  /** One-shot clips a plain auto-attack never cuts while they play (a set-piece
   *  like the howdah breaking lands in full; the swing it would show is skipped). */
  oneShotsHoldAttacks?: readonly string[];
  /** A rooted body slews its drawn heading toward the sim's facing at this rate
   *  (rad/s) instead of snapping, holding `clips.turn` while it catches up
   *  (turn_in_place_core.ts). Absent = the model follows the facing at once. */
  turnRate?: number;
  /** The body's own emissive map flared by presentation gestures (the same
   *  triggerAttack seam) and faded out on death: the Gorgebloom's gullet and
   *  pollen sacs. See glow_pulse_core.ts. */
  glowPulses?: GlowPulseSet;
  /** The presentation gesture that plays `clips.entrance`, ONCE per entity: a
   *  repeat for the same entity does nothing, so an effect may keep offering
   *  it until the view exists (the view is often built a frame or two after
   *  the entity appears). */
  entranceGesture?: string;
  /** Its per-ability cast clips are timed so a contact frame lands on the
   *  bar's end (castTimeScaleByAbility): the bar takes the body at once,
   *  cutting a plain swing or flinch (never a one-shot in
   *  oneShotsHoldAttacks), and the clip's time is held to the bar's elapsed
   *  time, so a clip that entered late still strikes on the bar's end
   *  (anim_state.ts castClipSyncTime). A list of ability ids locks only those
   *  casts (castClipSyncs): the rest of the rig's cast clips keep looping. */
  castClipSync?: boolean | readonly string[];
}

/** The slice of a VisualDef that decides how held weapons attach (which bones, and
 *  which slots swap to the equipped item). Lets a cosmetic body adopt a different
 *  class's hand layout without cloning the whole def. */
export type WeaponLayoutOverride = Pick<VisualDef, 'attach' | 'weaponSlots' | 'offhandSlot'>;

// ---------------------------------------------------------------------------
// Clip sets per source rig family
// ---------------------------------------------------------------------------

const KAYKIT_EMOTES: Partial<Record<OverheadEmoteId, EmoteClipSpec>> = {
  wave: { clips: ['Spellcast_Raise', 'Cheer'], timeScale: 0.9 },
  laugh: { clips: ['Hit_A', 'Cheer'], timeScale: 1.45, repeats: 2 },
  question: { clips: ['Block', 'Spellcast_Raise'], timeScale: 1.15 },
  cheer: { clips: ['Cheer'], timeScale: 1.05, repeats: 2 },
  dance: {
    clips: ['Running_Strafe_Left', 'Running_Strafe_Right', 'Cheer'],
    timeScale: 1.05,
    repeats: 2,
  },
  point: { clips: ['Spellcast_Shoot', '2H_Ranged_Shoot'], timeScale: 0.95 },
  flex: { clips: ['Block', 'Cheer'], timeScale: 0.8 },
  salute: { clips: ['Spellcast_Raise', 'Block'], timeScale: 1.18 },
  cry: { clips: ['Hit_A', 'Sit_Floor_Down'], timeScale: 0.65 },
  bow: { clips: ['Sit_Floor_Down', 'Spellcast_Raise'], timeScale: 1.35 },
  clap: {
    clips: ['1H_Melee_Attack_Slice_Diagonal', 'Cheer'],
    timeScale: 1.55,
    repeats: 2,
  },
  roar: {
    clips: ['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop', 'Cheer'],
    timeScale: 0.9,
  },
  kneel: { clips: ['Sit_Floor_Down'], timeScale: 0.85 },
};

const kaykit = (attack: string[], idle = 'Idle'): ClipMap => ({
  idle,
  walk: 'Walking_A',
  run: 'Running_A',
  walkBack: 'Walking_Backwards',
  attack,
  hit: ['Hit_A', 'Hit_B_Stagger'],
  death: 'Death_A',
  cast: 'Spellcasting',
  sitDown: 'Sit_Floor_Down',
  sitIdle: 'Sit_Floor_Idle',
  swim: 'Lie_Idle',
  jump: 'Jump_Idle',
  // The trimmed player GLBs ship no dedicated sheathe clip; the 1H chop WINDUP
  // (the clip's first ~40%, cut at the swap point by visual.ts) reaches over the
  // shoulder toward the back, which reads as grabbing/planting the hilt.
  stow: '1H_Melee_Attack_Chop',
  emote: KAYKIT_EMOTES,
});

// ---------------------------------------------------------------------------
// The WOC modular character rig (the split files, woc_armor_core.ts: a base and
// an animation library per body fit, one armor file per set, fit and tier): its
// own 34-joint skeleton (the 2026-09-24 animation rig: the handoff's bone names
// plus neck, clavicles and the waist-plate ring) and its own 51-clip vocabulary,
// built by scripts/assets/woc_character/build_woc_split.mjs. Every one-shot is authored
// to open and close on the pose the game blends it from: the combat clips on
// Combat_Idle, the emotes and fidgets on Idle. Jump is a takeoff that ends on a
// holdable airborne pose, so the rig takes the held-jump treatment (Jump clamps
// in the air, Land fires on touchdown, Fall flails on a long drop). Walk, Run and
// Walk_Back are authored at their game speeds (2.2, 7 and 4.55 yd/s).
// NEVER layer a KayKit donor GLB onto this rig: the bone NAMES match, so a
// Rig_Medium clip binds, but its bind pose does not, and it poses the body wrong.
// ---------------------------------------------------------------------------
const WOC_EMOTES: Partial<Record<OverheadEmoteId, EmoteClipSpec>> = {
  wave: { clips: ['Wave'] },
  laugh: { clips: ['Laugh'] },
  question: { clips: ['Question'] },
  cheer: { clips: ['Cheer'] },
  // Dance is a seamless loop: two passes.
  dance: { clips: ['Dance'], repeats: 2 },
  point: { clips: ['Point'] },
  flex: { clips: ['Flex'] },
  salute: { clips: ['Salute'] },
  cry: { clips: ['Cry'] },
  bow: { clips: ['Bow'] },
  clap: { clips: ['Clap'] },
  roar: { clips: ['Roar'] },
  kneel: { clips: ['Kneel'] },
};

// One-hand weapon, empty off hand: the one-hand combat clips present the off hand forward as
// if a shield were strapped to it; these keep the free hand down.
const WOC_SINGLE: Readonly<Record<string, string>> = {
  Combat_Idle: 'Combat_Idle_Single',
  '1H_Chop': '1H_Chop_Single',
  '1H_Slash': '1H_Slash_Single',
  Hit: 'Hit_Single',
};

// Two-hand weapon: no two-hand stance (owner call, 2026-09-30: "just have the same animations as
// the Sword and shield stance without holding up the shield hand"). A two-hander stays in one
// fist like a one-hand sword everywhere: out of combat the one-hand clips (idle, every gait, the
// jump), in combat the single set above, and the heavy chop (the auto attack through
// attackByHand.twohand, Mortal Strike, Execute, Final Edict...) as the single set's chop, since
// 2H_Chop takes both fists onto the grip. A one-hand weapon or a staff keeps its 2H_Chop. The
// both-fists *_2H clips (Combat_Idle_2H, Hit_2H, Chop_2H, Slash_2H) left the animation library
// with the same call (the 2026-09-30 Blender re-export).
const WOC_TWO_HAND: Readonly<Record<string, string>> = {
  ...WOC_SINGLE,
  '2H_Chop': '1H_Chop_Single',
};

// Dual wield: a blade in each hand (weapon_loadout_core 'dual'). The two blades cross in front
// of the chest (the backpedal's carry, 2026-09-28 owner call) and every combat clip opens and
// closes on that X: the stance, its hit reaction, and the ability strikes routed through the
// one-hand names (chop family: the thrust; slash family: the X-slash). The auto attack is the
// fast Dual_Chop halves (attackByHand.dualwield) and its both-hands pairs (dualWieldPair).
const WOC_DUAL: Readonly<Record<string, string>> = {
  Combat_Idle: 'Combat_Idle_Dual',
  Hit: 'Hit_Dual',
  '1H_Chop': 'Dual_Stab',
  '1H_Slash': 'Dual_Cross',
  // The heavy chop (Execute, Slam, Mortal Strike...) with a weapon in each hand, a Titan's
  // Grip pair of two-handers included (2026-09-29): the X-slash, never both fists on one grip.
  '2H_Chop': 'Dual_Cross',
};

// Blade contact times (seconds from the first frame, hand order) of the WOC melee clips, per
// body: the frame of the striking blade's peak speed inside the clip's strike window, measured
// off the baked clips (claude-animation-20260924 scripts/contact_times.py) and re-measured from
// the shipped animation library by tests/woc_character.test.ts. ClipMap.contacts.
export const WOC_CONTACTS: Readonly<Record<string, readonly number[]>> = {
  '1H_Chop': [0.458],
  '1H_Chop_Single': [0.458],
  '1H_Slash': [0.458],
  '1H_Slash_Single': [0.458],
  '2H_Chop': [0.642],
  Dual_Chop: [0.125, 0.525],
  'Dual_Chop#main': [0.125],
  'Dual_Chop#off': [0.125],
  Dual_Cross: [0.125, 0.092],
  Dual_Stab: [0.108],
  Block: [0.358],
};

/** The female body's contacts (its own clips: the same keys, its own reach and timing). */
export const WOC_CONTACTS_FEMALE: Readonly<Record<string, readonly number[]>> = {
  '1H_Chop': [0.475],
  '1H_Chop_Single': [0.475],
  '1H_Slash': [0.442],
  '1H_Slash_Single': [0.442],
  '2H_Chop': [0.708],
  Dual_Chop: [0.125, 0.525],
  'Dual_Chop#main': [0.125],
  'Dual_Chop#off': [0.125],
  Dual_Cross: [0.125, 0.108],
  Dual_Stab: [0.108],
  Block: [0.358],
};

/** A WOC body's files (woc_armor_core.ts): its fit's shared base and animation
 *  library, out of the boot gate (lazyPreload). The launcher fetches a fit when
 *  a preview first shows it, and world entry loads both fits before the
 *  Renderer exists (woc_entry_preload.ts), so no player body in the world waits
 *  on them. Its armor streams per set, at the graphics setting's texture tier
 *  (woc_armor_dressing.ts). */
/** The share of the sky reflection a WOC body's cloth, leather and skin keep (VisualDef.envSheen):
 *  measured in game against the dark authored atlases, where the full reflection read as a
 *  grey film at noon and a quarter keeps a hint of sky without it. */
const WOC_ENV_SHEEN = 0.25;

function wocBody(fit: WocFit): Pick<VisualDef, 'url' | 'animUrls' | 'lazyPreload'> {
  return { url: wocBaseUrl(fit), animUrls: [wocAnimsUrl(fit)], lazyPreload: true };
}

const woc = (attack: string[]): ClipMap => ({
  idle: 'Idle',
  // A look around now and then while standing (never mid-fight: an engaged body holds
  // Combat_Idle instead).
  idleVariants: ['Idle_Look'],
  idleVariantCadence: { everySec: 14, jitterSec: 8 },
  combatIdle: 'Combat_Idle',
  walk: 'Walk',
  run: 'Run',
  walkBack: 'Walk_Back',
  // The side runs for a Q/E strafe, authored at the 7 yd/s run (strafeRef = runRef).
  strafeLeft: 'Strafe_Left',
  strafeRight: 'Strafe_Right',
  attack,
  wandAttack: 'Cast_Shoot',
  hit: ['Hit'],
  death: 'Death',
  cast: 'Cast_Loop',
  sitDown: 'Sit_Down',
  sitIdle: 'Sit_Idle',
  // Swim carries the whole prone posture and its own bob, so it rides the
  // AUTHORED lane (no procedural pitch: visual.ts keys that on a surface stroke
  // being present) at any depth; a swimmer who stops treads water.
  swim: 'Swim',
  swimSurface: 'Swim',
  swimIdle: 'Swim_Idle',
  jump: 'Jump',
  fall: 'Fall',
  land: 'Land',
  // The authored ledge vault owns the climb (no procedural pose).
  climb: 'Climb',
  // The over-the-right-shoulder sheathe: the prop swaps at 46% of the clip, the
  // hand at the right shoulder with the weapon point-down behind the back (the
  // def's rightShoulderSheathe puts the carry on that side, back_grips.ts).
  stow: 'Sheathe',
  stowSwapFraction: 0.46,
  stowPlaysWhole: true,
  emote: WOC_EMOTES,
  loadoutSwaps: { twohand: WOC_TWO_HAND, single: WOC_SINGLE, dual: WOC_DUAL },
  // two swings in one frame: the X-slash, then the one-two of the whole Dual_Chop
  dualWieldPair: ['Dual_Cross', 'Dual_Chop'],
  contacts: WOC_CONTACTS,
});

const skeletonClips = (attack: string[], flourish = 'Skeletons_Awaken_Standing'): ClipMap => ({
  ...kaykit(attack, 'Idle_Combat'),
  flourish,
});

// The Bonebound Rickshaw's puller ONLY (skel_rickshaw_puller). Not shared
// with any other skeleton key on purpose.
//
// skeleton_minion.glb is one of the rigs corrupted by build_assets.mjs's
// meshopt() step (it breaks this exact multi-primitive-skinned KayKit shape),
// which the mount cannot ship around: its puller renders as a scattered pile of
// bones. It is rebuilt by scripts/assets/rebuild_kaykit_skeletons_free.mjs from
// the KayKit_Skeletons_1.1_FREE pack and shipped as a SEPARATE file
// (skeleton_minion_free.glb) rather than overwriting the original, because the
// FREE pack bundles only 2 of the 7 Rig_Medium animation sources: no combat
// swing, no emotes. Overwriting the shared file would have handed that
// regression to delve_skel_wraith, a real Reliquary delve mob that currently
// has real attack clips and nothing to do with this mount. A cart puller never
// swings at anything, so the reduced set costs the mount nothing.
//
// Fixing the other rigs on that shared file, and deciding whether losing their
// attack swings is worth the geometry fix, is a separate change with its own
// argument to make.
const RICKSHAW_PULLER_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  // Empty rather than naming a clip this GLB does not contain, which
  // tests/character_clipmaps.test.ts correctly refuses to let through.
  attack: [],
  hit: ['Hit_A'],
  death: 'Death_A',
};

const skeletonLargeClips = (attack: string[]): ClipMap => ({
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  attack,
  hit: ['Hit_A'],
  death: 'Death_A',
});

// Quaternius 2021 animal rig (wolf/bull/alpaca/fox/stag)
const animal = (attack: string[]): ClipMap => ({
  idle: 'Idle',
  walk: 'Walk',
  run: 'Gallop',
  attack,
  hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'],
  death: 'Death',
});

// Every buddy rig (public/models/buddies/) ships exactly Idle + Walk, renamed
// in-place to this convention (see the buddy_* VISUALS entries below); run
// and death alias Walk/Idle since a buddy never plays either.
const BUDDY_CLIPS: ClipMap = { idle: 'Idle', walk: 'Walk', run: 'Walk', attack: [], death: 'Idle' };

// Rideable mounts. The Tripo-lane rigs (bear, toad, griffin) ship clips baked
// locally by scripts/bake_mount_gaits.mjs (the Tripo quadruped retarget was
// near-static, 4-5 animated joints), which authors Idle/Walk/Run/Death gait
// cycles directly against each rig's bind pose. The horse and the gobbler
// ship AUTHORED clips from their source models, renamed to these same four
// names at import time. The clipless prop-lane mounts resolve no actions from
// this map and rest in their generated standing pose (procedural bob in
// src/render/mount_visuals.ts). No attack one-shots: the RIDER swings, the
// mount does not.
const MOUNT_RIGGED: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: [],
  death: 'Death',
};

// The Viridian Valestrider is authored as a mount-specific four-clip rig. It
// only runs forward, has a deliberate look-behind reverse gait, and carries
// its own full-body jump. Death falls back to Idle because mounts never die
// independently of their riders.
const AVIAN_MOUNT_RIGGED: ClipMap = {
  idle: 'Idle',
  walk: 'Run',
  run: 'Run',
  walkBack: 'WalkBackward',
  jump: 'Jump',
  // Two launches on purpose. `Jump` squats 80mm over 180ms before it springs,
  // which reads right from a standstill; `Jump_Running` opens already crouched
  // and launches at once, which reads right off a run and stiff when still.
  // Anticipation and an instant takeoff cannot live in one clip.
  jumpMoving: 'Jump_Running',
  attack: [],
  death: 'Idle',
};

// The Mech Bird's own map: it ships exactly Idle / Run / Jump (authored in
// Blender against its 28-bone rig). Walk aliases the run cycle (the servo
// sprint reads as a stately strut at walk timeScales), death holds Idle (a
// ridden mount never plays a death; the summon strips on death first), and
// jump is the one mount clip in the game that actually uses the airborne
// channel: the renderer already feeds the real airborne flag to mount
// visuals, so the single authored wing-flap plays on every hop.
const MOUNT_MECH_BIRD: ClipMap = {
  idle: 'Idle',
  walk: 'Run',
  run: 'Run',
  attack: [],
  death: 'Idle',
  jump: 'Jump',
};

// The Chimeglass Tortoise ships three authored idle-breakers on top of the
// breathing Idle: he looks about him, rears up to paw the air, and stamps his
// front feet one at a time. Each ends back on the idle pose so the hand-off is
// seamless.
const MOUNT_TORTOISE: ClipMap = {
  ...MOUNT_RIGGED,
  idleVariants: ['Idle_Look', 'Idle_Rear', 'Idle_Stamp', 'Idle_Groove'],
  // The wet-dog head shake is his signature, so it keeps its own clock rather
  // than taking a one-in-five share of the pool's 20-45s draw (which would have
  // put it 100-225s apart). Small jitter only, so a paddock of them does not
  // shake in lockstep.
  idleBeat: { clip: 'Idle_Shake', everySec: 20, jitterSec: 4 },
  // Naming `land` opts this rig into the HELD-jump treatment (visual.ts
  // isOnce): `Jump` stops looping and clamps on its last frame, the airborne
  // tuck, for as long as the body is off the ground, and `Land` fires as a
  // one-shot on the touchdown edge. So `Jump` is only the spring and the tuck;
  // the arc itself is the game's, and the clip must not carry a rise or the
  // mount would still be held above the ground when it touches down.
  jump: 'Jump',
  land: 'Land',
};

// The Drakelands dragonkin brood (tmp/dragonkin_build.mjs bakes): artist
// clips on the 25-bone mixamorig core. Run reuses the walk cycle (the rigs
// ship no separate sprint; visual timeScale matching covers the chase). The
// broodlord's specials resolve per mechanic: FireBreath rides the cast slot
// (breathCone shows a real bar), Cleave/Stun ride attackByAbility off the
// 'windup' spellfx ability ids, and Shout is the flourish one-shot the
// 'shout'/'flourish' spellfx cues play.
/**
 * The entity scale both Balgath silhouettes spawn at, named here because the gait
 * references below are only correct AT this scale and would otherwise be four loose
 * numbers nobody could re-derive.
 *
 * 4.2 puts a 3.2-unit rig at roughly 13.4 world units, close to twice a player's height
 * again over the dragonkin matriarch (2.85). At this size he reads as terrain from across
 * the fen, which is the whole point of a world boss you can see coming.
 *
 * It is not a free number: `scaledDefaultMobMeleeRange` derives his reach from it, and the
 * gait references below are measured AT it. Moving it means re-running the measurement and
 * re-checking that his reach still matches where the model can actually reach.
 */
export const BALGATH_SCALE = 4.2;

// Gait references: the world speed each clip NATURALLY travels at, which
// `locomotionTimeScale` divides the body's real speed by to pick a playback rate.
// MEASURED, never guessed, at BALGATH_SCALE, on the UNQUANTIZED Blender export (a
// meshopt-quantized file stores integer positions and measures as nonsense):
//
//   node scripts/anim/measure_gait.mjs <balgath_cyclops_raw.glb> --height 3.2 --scale 4.2
//
// The PLANTED-FOOT reading is the one used (4.05 walk, 7.95 run). This body stands with
// its feet 3.7 units apart, and the tool's stride reading takes that stance width for part
// of the step, which would put the refs half again too high (6.14 / 9.42) and moon-walk
// him. The planted reading agrees with the Blender build, which keyed the cycles so the
// feet hold still at 4.2 and 8.15 yd/s at its own authoring scale (the game draws him at
// 0.963 of it).
//
// He is deliberately tuned to sit in ONE gait in combat. His move speed (5.0, zone2.ts) is
// just under the render-side GAIT_RUN_ENTER of 5.2, so he never crosses into the run clip
// and never flip-flops across that boundary mid-chase: 5.0/4.05 = 1.23x the clip's natural
// rate, inside the clamp, planted. His warpath travel (6.25) is the one thing that puts him
// in the run, at 6.25/7.95 = 0.79x.
/**
 * The Straw Foreman's height, the shipped GLB's measured bbox (npx gltf-transform inspect):
 * about half of Balgath's 3.2 x 4.2. MUST match the file (prepareVisual normalizes by it).
 */
export const MUSTER_EFFIGY_HEIGHT = 6.7;
const BALGATH_WALK_REF = 4.05;
const BALGATH_RUN_REF = 7.95;

// Balgath, the Mirefen world boss: the Blender-built cyclops (scripts/assets/
// balgath_cyclops/, shipped by its ship.mjs). Every clip below lives inside the one GLB,
// authored on its own 56-bone rig, so there are no donor files to bind by name any more:
// the clip set and the rig cannot drift apart. tests/balgath_boss_assets.test.ts pins the
// names, the key frames this map times against, and the geometry of the reads that matter.
//
// `cast` is the scry channel rather than a generic cast: the boss's only channelled
// ability IS the eye, so the bar and the pose are the same event. `flourish` is the
// enrage roar. `sleep` and `wake` are the night (mob/slumber.ts): the sleep loop plays
// for as long as the wire says he is in bed, and the wake fires exactly once on the
// asleep-to-awake edge, so `Balgath_Wake` is reachable from ONE state transition and
// nowhere else. Blinded is two clips: the stagger plays once off the blind cue the sim
// emits (eye_ward.ts EYE_WARD_BLIND_ABILITY), and the hunched, groping loop then holds in
// place of his idle for as long as the Blinded aura rides (`idleByAura`). He keeps
// fighting blind, so his swings and steps still outrank it.
//
// Not wired: `Balgath_Mend`. His Barrowmend regen only ever ticks while he is RUNNING his
// warpath (mob/warpath.ts), and a standing loop played over a run would freeze his legs
// while the sim slides him. It ships for a stationary heal if one is ever added.
const BALGATH: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  // The ordinary auto-attack is one of three SMALL swings (the backhand, a stepping hook,
  // a two-fisted club), rotated so a long fight is not one gesture on loop. The telegraphed
  // slams are reached only through attackByAbility, off the windup cue the sim emits when a
  // ground ring is drawn, so they stay rare: a boss who plays his circle-smash animation on
  // every auto teaches the raid that the animation means nothing.
  attack: ['Balgath_Swipe', 'Balgath_Punch', 'Balgath_Clobber'],
  attackByAbility: {
    mob_pulse_windup: 'Balgath_Smash',
    mob_stomp_windup: 'Balgath_Stomp',
    // His warpath (src/sim/mob/warpath.ts): the backhand he throws mid-run at whoever is
    // chasing him, and the two-fisted slam he lands on the landmark he ran to.
    mob_warpath_swipe: 'Balgath_Barrowsweep',
    mob_warpath_wreck: 'Balgath_Barrowfall',
    // The two aimed slams (src/sim/mob/boss_slams.ts): one fist raised over a player, and
    // the low arm dragged across the ground.
    mob_balgath_hammer: 'Balgath_Hammer',
    mob_balgath_cleave: 'Balgath_Cleave',
    // His ranged kit. The boulder toss: stoop, rip a boulder out of the fen, heave it
    // overhead and hurl it (the renderer draws the boulder and launches it from his fists
    // on the clip's release frame). The glare is the scry pose aimed down a line, and the
    // burden is his palms pressing the shared weight down onto the raid.
    mob_balgath_boulder: 'Balgath_Toss',
    mob_balgath_glare: 'Balgath_EyeFlare',
    mob_balgath_burden: 'Balgath_Burden',
    // The pike in his eye (mob/eye_ward.ts): he clutches the socket and staggers. The loop
    // that follows is `idleByAura` below.
    mob_eye_ward_blinded: 'Balgath_Blinded',
  },
  // Timed so each clip's IMPACT frame lands on the moment the mechanic actually resolves,
  // not before it. Left at the default 1.3x they all land early and the boss stands frozen
  // through the rest of his own telegraph, which is what makes a windup feel disconnected
  // from its hit. The key frames are the Blender build's (scripts/assets/balgath_cyclops/
  // clips.py), pinned by tests/balgath_boss_assets.test.ts.
  //
  // The two telegraphed slams divide their authored impact time by the 1.2s windup
  // (RIFT_MECHANIC_WINDUP_SEC): the smash's fists land at 1.18s of its 1.75s timeline and
  // the stomp's foot at 0.70s of 1.30s.
  //
  // Barrowfall divides by its own fuse instead (WARPATH_WRECK_FUSE_SEC, also 1.4s) and its
  // impact is authored at 1.4s, so it plays unscaled. Barrowsweep has no impact deadline
  // at all (its damage resolves the instant it is emitted); its rate is matched to the
  // gait instead. Its legs ARE the Run cycle, and 0.79 is what the locomotion state machine
  // independently picks for that clip at his 6.25 u/s travel speed (6.25 / BALGATH_RUN_REF),
  // so the legs advance at exactly the rate the real run would and the composite cannot
  // skate.
  attackTimeScaleByAbility: {
    mob_pulse_windup: 0.98,
    mob_stomp_windup: 0.58,
    mob_warpath_swipe: 0.79,
    mob_warpath_wreck: 1,
    // The hammer lands at 1.30s, ON its 1.3s template windup, so it plays unscaled. The
    // cleave's arm crosses at 1.50s of 2.5s and its windup is 2.0s (zone2.ts, lengthened so
    // the raid has longer to read the jump), so it plays at 1.5 / 2.0 = 0.75 and the arm
    // still crosses the instant the arc resolves.
    mob_balgath_hammer: 1,
    mob_balgath_cleave: 0.75,
    // The toss is authored with its RELEASE at 1.45s and recovers to idle at 2.2s, the
    // mechanic's whole windup, so it plays unscaled: the boulder leaves his fists on the
    // authored frame and he is standing again as it lands.
    mob_balgath_boulder: 1,
    // EyeFlare peaks at 1.30s of its 2.60s timeline (the cast's highest hold); slowed to
    // 0.52 that peak arrives at 2.5s, a beat before the 2.6s glare resolves, so the eye is
    // at full stretch when the beam fires rather than already settling.
    mob_balgath_glare: 0.52,
    // The 2.2s press over a 6s windup: it plays once at its own pace and he holds idle
    // for the rest, which is what a raid-wide weight settling slowly should look like.
    mob_balgath_burden: 1,
    mob_eye_ward_blinded: 1,
  },
  // Which fist lights up while a slam winds, and for how long.
  //
  // The hand is the read. One fist means the hammer is coming down on SOMEBODY and the ring
  // on the ground is theirs; both fists mean the ground is, and everyone should be looking
  // at the circle. Nothing else in the fight distinguishes those two cases at a glance, and
  // at his size the raid is usually looking at his hands rather than his feet.
  //
  // Every duration matches its mechanic's windup exactly, so the light going out IS the
  // impact frame (charge_glow_core.ts holds near full and then drops off a cliff).
  // Barrowglass teal rather than fire, because it is the same power his eye burns with.
  // `radius` is in BONE-LOCAL units, and the rig multiplies it twice on the way out: once
  // by the visual's normScale (0.229 here: the Blender body is authored at its real 14
  // units and normalized DOWN to 3.2) and again by the entity's own scale (4.2), so about
  // 0.96 overall. A fist-sized glow is therefore about 0.67, a world radius of 0.65 (the
  // size the old 0.04 reached through the previous rig's 16x chain).
  chargeGlowByAbility: {
    mob_balgath_hammer: { hand: 'r', color: 0x76e0d8, rise: 0.45, seconds: 1.3, radius: 0.67 },
    mob_balgath_cleave: { hand: 'r', color: 0x76e0d8, rise: 0.6, seconds: 2, radius: 0.7 },
    mob_pulse_windup: { hand: 'both', color: 0x76e0d8, rise: 0.5, seconds: 1.2, radius: 0.64 },
    mob_warpath_wreck: { hand: 'both', color: 0x9ff0e6, rise: 0.45, seconds: 1.4, radius: 0.77 },
    // Earth-brown, not teal: this is not his eye's power but plain strength, fen soil
    // packed on both fists from the dig. It burns down to the RELEASE frame (1.45s).
    mob_balgath_boulder: { hand: 'both', color: 0xb08a5a, rise: 0.4, seconds: 1.45, radius: 0.67 },
  },
  // His authored topple: the eye goes out, he staggers and falls flat on his back, the
  // spine landing at 1.80s (BALGATH_DEATH_IMPACT_SEC, where the renderer throws the dust);
  // its last frame is a resting pose the renderer holds for the whole corpse window.
  death: 'Balgath_Death',
  hit: ['Hit'],
  cast: 'Balgath_EyeFlare',
  // Wake of the Fallen Star (src/sim/mob/boss_starwake.ts): his bar is the star called
  // down, on his knees with both fists driven into the fen. The bar's id is the mechanic's
  // name (the cast-bar label the client localizes).
  castByAbility: { 'Wake of the Fallen Star': 'Balgath_Starwake' },
  // Starwake drives its fists in at 1.40 s of its 2.80 s; slowed to 0.56 they land at
  // 2.5 s, on the end of the 2.5 s bar, which is the instant the fissures go down.
  castTimeScaleByAbility: { 'Wake of the Fallen Star': 0.56 },
  jump: 'Jump',
  flourish: 'Balgath_Roar',
  // The night. He folds down into a mound of granite beside the fallen star and breathes
  // (the loop), then levers himself up out of it at dawn (the one-shot, which is the same
  // rise the spawn was always meant to have and now has a state edge to fire on).
  sleep: 'Balgath_Sleep',
  wake: 'Balgath_Wake',
  // Blinded (mob/eye_ward.ts): between swings he stays hunched over the socket, groping,
  // for as long as the window lasts.
  idleByAura: { eye_ward_blinded: 'Balgath_BlindedLoop' },
};

const DRAGONKIN_BROODLORD: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  attackByAbility: { brood_cleave: 'Cleave', brood_stun: 'Stun' },
  death: 'Death',
  cast: 'FireBreath',
  flourish: 'Shout',
};
const DRAGONKIN_BROODGUARD: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  death: 'Death',
  flourish: 'Shout',
};
const DRAGONKIN_WHELP: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['JumpAttack'],
  death: 'Death',
  flourish: 'JumpAttack',
};
// Grubjaw the Glutton (the Mirefen Marsh rare): his own Tripo sculpt on the
// 25-bone mixamorig core, auto-skinned by tmp/grubjaw_build.mjs. Two authored
// swings rotate per attack (a bare Punch and the bigger WeaponA haymaker);
// Death is a synthesized hips topple, since the drop ships no death clip.
const GRUBJAW: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Punch', 'WeaponA'],
  death: 'Death',
};

// Clipless two-state prop mobs (the dragonkin egg): the GLB ships NO clips, so
// every action() lookup misses harmlessly (fadeTo null-guards) and the mesh
// just stands; state changes are mesh-visibility swaps
// (VisualDef.corpseMeshSwap), not clips. Names the nominal 'Idle' throughout
// and registers in CLIPLESS_RIGS (tests/character_clipmaps.test.ts), the same
// contract mob_spider_egg_sac holds: that registration is what exempts a
// clip-less prop from the per-clip and far-LOD bake guards.
const STATIC_PROP: ClipMap = {
  idle: 'Idle',
  walk: 'Idle',
  run: 'Idle',
  attack: ['Idle'],
  death: 'Idle',
};

// Custom baked wolf rig (wolf_basic/greyjaw, Dog_Animation donor skeleton): the
// animal() core plus the donor's Sit/Fall clips so player wolf forms sit and
// jump properly, and a Walk swim base (a paddling gait at the gentle clip
// pitch beats the steep no-clip procedural prone on a quadruped).
const WOLF_BAKED: ClipMap = {
  ...animal(['Attack']),
  sitIdle: 'Sit',
  swim: 'Walk',
  jump: 'Fall',
};

// Greyjaw's own attack (scripts/build_greyjaw_anims.mjs, issue #2889 round
// 2): greyjaw.glb is a much richer, dedicated 48-node rig (not shared with
// mob_wolf's separate wolf_basic.glb) that ships unused bonus donor clips
// (Bark, Howl, "Idle Alert", Sneak) specific to this named rare; this
// blends Howl's rear-back windup into Attack's lunge for a howl-then-pounce,
// more dramatic than the plain Attack every other WOLF_BAKED user (mob_wolf,
// form_ghost_wolf) still plays. WOLF_BAKED itself is untouched: both still read it,
// and changing the shared base would change player shaman form combat
// feel, out of scope here. greyjaw already ships and wires BOTH
// Idle_HitReact_Left and Idle_HitReact_Right (via animal()), so no
// hit-variety work is needed here: this override is attack-only.
const GREYJAW_WOLF: ClipMap = {
  ...WOLF_BAKED,
  attack: ['Greyjaw_Attack'],
};

// Druid Bear Form: a purpose-built quadruped rig (29 deform bones; the gaits are
// authored as IK foot paths, so walkRef/runRef below are MEASURED off the clips
// rather than guessed). Jump/Land are a pair: `land` opts the rig into the held
// airborne treatment (see ClipMap.land).
//
// It deliberately names no `cast`, no `emote` and no `attackByAbility`. Bear-form
// abilities are instant, and the ability-VFX painter gates its ceremonial cast
// gesture on an authored per-ability clip (hasGestureClip) while the cast base
// state falls back to idle without a `cast` clip. Leaving all three out is what
// keeps an instant cast from firing a swipe; real attacks still resolve `attack`.
const BEAR_FORM: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit'],
  death: 'Death',
  jump: 'Jump',
  land: 'Land',
  sitIdle: 'Sit',
  // a paddling walk beats the steep no-clip procedural prone on a quadruped,
  // the same call the wolf forms make
  swim: 'Walk',
};

// The cat is an in-place quadruped: world motion owns the leap trajectory,
// Jump holds its airborne final pose, and Land fires only on real touchdown.
// Utility spells intentionally have no gesture override, so buffs never swipe.
const DRUID_CAT_FORM: ClipMap = {
  // The compact 17-clip export retired Idle, CombatIdle, Sit/SitDown, Rise,
  // Wade, SwimSurface, SwimIdle and Hit_Right: Idle_Look is the idle, Swim is
  // the one water clip, Hit_Left the one flinch; combat idle, sit, wade and
  // the flourish fall back to the base machine's defaults (idle / walk).
  idle: 'Idle_Look',
  prowlIdle: 'ProwlIdle',
  prowlWalk: 'ProwlWalk',
  walk: 'Walk',
  walkBack: 'WalkBack',
  run: 'Run',
  attack: ['Attack_Left', 'Attack_Right'],
  attackByAbility: {
    claw: 'Attack_Left',
    rake: 'Attack_Right',
    ferocious_bite: 'Bite',
    rip: 'Finisher',
    pounce: 'Pounce',
    redharvest: 'Finisher',
  },
  hit: ['Hit_Left'],
  death: 'Death',
  jump: 'Jump',
  land: 'Land',
  fall: 'Fall',
  swim: 'Swim',
  swimSurface: 'Swim',
  swimIdle: 'Swim',
};

// Custom wild boar rig (wild_boar.glb)
const WILD_BOAR: ClipMap = {
  idle: 'Idle1',
  walk: 'Move2 (shuffle)',
  run: 'Move1 (jump)',
  attack: ['Attack1 (marracca)', 'Attack2 (tusks)'],
  hit: ['Hurt'],
  death: 'Dying',
};

// 14-clip biped rig (orc/frog/demonalt/yetialt)
const BIPED14: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Punch', 'Weapon'],
  hit: ['HitReact', 'HitReact_Heavy'],
  death: 'Death',
};

// The yeti family's own attack (scripts/build_yeti_anims.mjs, issue #2889
// round 2): BIPED14's Punch/Weapon attack is shared by reference across 6
// unrelated families (mob_bear, mob_yeti, mob_murloc, mob_troll, mob_demon,
// mob_demonalt). This "icy roar-and-swipe" clip is baked off yetialt.glb's
// own donor poses (Weapon's overhead swing blended through the currently
// unused No clip's head-shake), so only mob_yeti gets it.
const YETI_BIPED14: ClipMap = {
  ...BIPED14,
  attack: ['Yeti_Attack'],
};

// mob_troll's own attack (scripts/build_troll_anims.mjs, issue #2889):
// BIPED14's Punch/Weapon is shared by reference across 6 unrelated families
// (a yeti, a frog-murloc, a demon and its alt among them). This clip is baked
// off orc.glb's own donor poses (a crouch coil, the existing overhand club
// swing, the existing punch's follow-through lean, and a head nod), so only
// mob_troll gets it; the other 5 BIPED14 families are untouched.
const TROLL_BIPED14: ClipMap = {
  ...BIPED14,
  attack: ['Troll_Smash'],
};

// The murloc family's own attack (scripts/build_murloc_anims.mjs, issue
// #2889 round 2): BIPED14's Punch/Weapon attack is shared by reference
// across 6 unrelated families (mob_bear, mob_yeti, mob_murloc, mob_troll,
// mob_demon, mob_demonalt). This "slap/flop combo" clip is baked off
// frog.glb's own donor poses (Punch's forward slap blended through the
// currently unused Wave clip's arm flail), so only mob_murloc gets it.
const MURLOC_BIPED14: ClipMap = {
  ...BIPED14,
  attack: ['Murloc_Attack'],
};

// The warlock demon pet family's own attack (scripts/build_demon_anims.mjs,
// issue #2889 round 2): BIPED14's Punch/Weapon attack is shared by
// reference across 6 unrelated families (mob_bear, mob_yeti, mob_murloc,
// mob_troll, mob_demon, mob_demonalt). This "nod-and-slash" clip is baked
// off demonalt.glb's own donor poses (Weapon's swing blended through the
// currently unused Yes clip's downward nod), so only mob_demon and
// mob_demonalt get it: they already share the same base rig and
// tint-only differentiation, so sharing the new attack too is consistent
// with how the rest of that pairing works.
const DEMON_BIPED14: ClipMap = {
  ...BIPED14,
  attack: ['Demon_Attack'],
};

// The bear family's own attack (scripts/build_bear_anims.mjs, issue #2889
// round 2): BIPED14's Punch/Weapon attack is shared by reference across 6
// unrelated families (mob_bear, mob_yeti, mob_murloc, mob_troll, mob_demon,
// mob_demonalt). This "ground-swipe maul" clip is baked off yetialt.glb's
// own donor poses (Punch's forward swing blended through the currently
// unused Duck clip's low crouch-and-rise), so only mob_bear gets it.
const BEAR_BIPED14: ClipMap = {
  ...BIPED14,
  attack: ['Bear_Attack'],
};

// Tripo biped rig. These creatures come through the current biped
// pipeline, which retargets and bakes the complete game vocabulary directly.
const TRIPO_BIPED_FULL_RIG: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit', 'Hit_Stagger'],
  death: 'Death',
  cast: 'Cast',
  jump: 'Jump',
};

// The Vineclaw Stalker's own attack (scripts/build_wildheart_stalker_anims.mjs, issue
// #2889 round 2): TRIPO_BIPED_FULL_RIG's Attack is shared by reference across all 5
// Wildheart Basin mobs. This clip is baked off wildheart_stalker.glb's own donor poses
// (a compressed re-timing of its own Attack clip into a spear-throw lunge), so only
// mob_wildheart_stalker gets it; the other 4 Wildheart mobs are untouched.
const WILDHEART_STALKER: ClipMap = {
  ...TRIPO_BIPED_FULL_RIG,
  attack: ['Wildheart_Stalker_Attack'],
};

// The Sunbone Hexcaller's own attack/cast (scripts/build_wildheart_hexcaller_anims.mjs,
// issue #2889 round 2): TRIPO_BIPED_FULL_RIG's Attack and Cast are shared by reference
// across all 5 Wildheart Basin mobs. This clip is baked off wildheart_hexcaller.glb's own
// donor poses (a cast-dominated re-timing of its own Cast and Attack clips), so only
// mob_wildheart_hexcaller gets it; the other 4 Wildheart mobs are untouched. Wired into
// both attack and cast so the Hexcaller's ordinary auto-attack reads as spellwork too.
const WILDHEART_HEXCALLER: ClipMap = {
  ...TRIPO_BIPED_FULL_RIG,
  attack: ['Wildheart_Hexcaller_Attack'],
  cast: 'Wildheart_Hexcaller_Attack',
};

// Zulgar, Voice of the Basin's own attack/cast (scripts/build_wildheart_high_priest_anims.mjs,
// issue #2889 round 2): TRIPO_BIPED_FULL_RIG's Attack and Cast are shared by reference
// across all 5 Wildheart Basin mobs. This clip is baked off wildheart_high_priest.glb's
// own donor poses (a climactic Cast hold into Jump's own pose repurposed as a downward
// slam/roar release), so only mob_wildheart_high_priest gets it; the other 4 Wildheart
// mobs are untouched. Deliberately the longest and most dramatic of the five, befitting
// the dungeon boss: it is his CAST (the Pulse and the Spirit of the Hunt bars). His
// melee swing is Wildheart_High_Priest_Swing (same builder, off his own Attack donor):
// played as a swing the slam heaved his whole body (its Jump donor turns the pelvis
// 140 degrees), so the swing keeps his legs and pelvis on the idle stance and lets the
// arms, shoulders and spine carry a wind-up, a rake down and a recovery.
const WILDHEART_HIGH_PRIEST: ClipMap = {
  ...TRIPO_BIPED_FULL_RIG,
  attack: ['Wildheart_High_Priest_Swing'],
  cast: 'Wildheart_High_Priest_Attack',
};

// The Bloodmane Ravager's own attack (scripts/build_wildheart_ravager_anims.mjs, issue
// #2889 round 2): TRIPO_BIPED_FULL_RIG's Attack is shared by reference across all 5
// Wildheart Basin mobs. This clip is baked off wildheart_ravager.glb's own donor poses
// (a heavier two-beat re-timing of its own Attack and Hit clips), so only
// mob_wildheart_ravager gets it; the other 4 Wildheart mobs are untouched.
const WILDHEART_RAVAGER: ClipMap = {
  ...TRIPO_BIPED_FULL_RIG,
  attack: ['Wildheart_Ravager_Attack'],
};

// 2023 enemy rig (goblin/giant)
const ENEMY7: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['HitRecieve', 'HitRecieve_Heavy'],
  death: 'Death',
};

// The authored ogre body (the _Mob_Updates artist drop, combined by
// tmp/ogre_build.mjs): a rigged Tripo donor whose drop authors every slot,
// Run included (retimed in the build, see the gait numbers on mob_ogre
// below). Its own constant rather than ENEMY7 because the clip names
// differ (Hit, not the 2023 pack's HitRecieve pair).
const OGRE: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit'],
  death: 'Death',
};

// Warlord Drogmar's own drop (tmp/drogmar_v02_build.mjs): a rigged Tripo donor
// carrying a bone-parented Skull Cleaver, with the full slate authored, so it
// gets its own ClipMap rather than reading OGRE.
//
// CombatIdle is the one clip the artist did not ship and the build synthesizes
// (tmp/drogmar_combat_stance.mjs): the drop authors Attack AND Hit to both open
// and close on one braced guard pose (hips sunk 5.7u under the relaxed idle,
// feet 38.5u apart against its 21.6, torso 10deg forward, cleaver carried 6.6u
// higher), but never shipped the loop that HOLDS it. The stance is that pose
// wearing Idle's own breathing delta, so the warlord stays set between blows
// and his swings and flinches blend into and out of it with nothing to
// reconcile at either end.
const DROGMAR: ClipMap = {
  ...OGRE,
  combatIdle: 'CombatIdle',
};

// The kobold family's own attack (scripts/build_kobold_anims.mjs, issue
// #2889): ENEMY7's Attack was shared by reference with mob_ogre back when
// the ogre rendered on giant.glb (it has its own authored body and OGRE
// ClipMap now), so a kobold then swung the exact same single double-claw
// chop. This clip is baked off goblin.glb's own donor poses (Attack's own
// beats re-timed into a two-part combo, plus Jump, a clip goblin.glb ships
// that ENEMY7 never wires), so only mob_kobold gets it.
const KOBOLD_ENEMY7: ClipMap = {
  ...ENEMY7,
  attack: ['Kobold_Pounce'],
};

// Grix the Tunnelking's drop authors Idle/Walk/Run/Attack/Death and NO hit
// reaction. His hit slot used to borrow the shared HitRecieve_Heavy donor
// (goblin_hit_variety_anims.glb), but that donor's tracks target the goblin
// rig (Head/Arm.L/Arm.R/Body) and his drop is mixamorig-boned, so the clip
// resolved by NAME and then bound NOTHING at runtime: every hit taken faded
// the working base action out for a one-shot that drives no bone, freezing
// the rig at its last sampled pose for the clip's duration (the live
// mid-swing statue players reported). The zero-weight watchdog cannot see
// that state because the dead action's weight is a healthy 1. Until a flinch
// is baked for his own rig (blender-anim-pipeline), he takes hits with no
// reaction clip, which playHit treats as a clean no-op. That bake needs no
// new authoring: kobold.glb's native HitRecieve targets 20 mixamorig bones
// that all exist on grix.glb, so a mesh-free single-clip donor extracted from
// it (the scripts/build_*_hit_variety_anims.mjs pattern) binds directly. Do
// NOT shortcut it by listing kobold.glb itself in animUrls: the
// overwrite-by-name merge would replace his authored Idle/Walk/Run/Attack/
// Death with the Digger's (the mob_kobold_digger trap below).
// tests/character_clipmaps.test.ts now gates track BINDING as well as names.
// He is a one-off rare, so this is his own constant rather than a widened
// ENEMY7, which mob_ogre also reads.
const GRIX: ClipMap = {
  ...ENEMY7,
  hit: [],
};

// The Deeprock Diggers' authored drop (kobold.glb) is mixamorig-boned like
// Grix's, so the goblin-rig HitRecieve_Heavy donor cannot bind on it either.
// Unlike Grix, the drop ships its own HitRecieve, so the flinch keeps the
// native clip alone instead of ENEMY7's donor-backed pair.
const KOBOLD_DIGGER: ClipMap = {
  ...ENEMY7,
  hit: ['HitRecieve'],
};

// floating/flying rigs (goleling/dragon) — hover instead of walking
/** The clip set every Drowned Temple creature authors (scripts/assets/drowned_temple_creatures). */
const TEMPLE_CLIPS = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack', 'Attack2'],
  hit: ['Hit'],
  death: 'Death',
  cast: 'Cast',
};

const FLOATING: ClipMap = {
  idle: 'Flying_Idle',
  walk: 'Fast_Flying',
  run: 'Fast_Flying',
  attack: ['Headbutt', 'Punch'],
  hit: ['HitReact'],
  death: 'Death',
};

// The elemental family's own attack (scripts/build_elemental_anims.mjs, issue
// #2889): FLOATING's Headbutt/Punch is shared by reference across 9 unrelated
// families (a fire elemental, a ghost, a dragon, a flying demon imp among
// them). This clip is baked off golelingevolved.glb's own donor poses (a
// forward lunge plus its two unused gesture clips), so only mob_elemental
// gets it; the other 8 FLOATING families are untouched.
const ELEMENTAL_FLOATING: ClipMap = {
  ...FLOATING,
  attack: ['Elemental_Attack'],
};

// The ghost family's own attack (scripts/build_ghost_anims.mjs, issue #2889):
// FLOATING's Headbutt/Punch is shared by reference across 8 remaining
// families after the elemental's migration above (a dragon, the flying demon
// imp, the Nightbloom nightkin, the mushroom-folk glub among them). This clip
// is baked off ghost.glb's own donor poses (the same shared rig
// golelingevolved.glb uses, so the same forward-lunge Punch plus its two
// unused gesture clips No/Yes), so only mob_ghost gets it; the wisps
// (mob_glimmerwisp/mob_duskwisp) are unrigged bespoke meshes on a DIFFERENT
// GLB where FLOATING's clip names simply no-op, and the other FLOATING
// families stay untouched.
const GHOST_FLOATING: ClipMap = {
  ...FLOATING,
  attack: ['Ghost_Attack'],
};

// The nightkin family's own attack (scripts/build_nightkin_anims.mjs, issue
// #2889): FLOATING's Headbutt/Punch is shared by reference across 8 other
// unrelated families (a ghost, a dragon, a flying demon imp, a glowing wisp
// among them). This clip is baked off tribal.glb's own donor poses (a
// forward lunge plus its two unused gesture clips), so only mob_nightkin
// gets it; the other FLOATING families are untouched.
const NIGHTKIN_FLOATING: ClipMap = {
  ...FLOATING,
  attack: ['Nightkin_Attack'],
};

// The glub family's own attack (scripts/build_glub_anims.mjs, issue #2889
// round 2): FLOATING's Headbutt/Punch is shared by reference across 8
// unrelated families (mob_dragonkin, mob_choir_thrall, mob_demon_flying,
// mob_nightkin, mob_ghost, mob_glimmerwisp, mob_duskwisp, mob_glub among
// them). This "spore burst" clip is baked off glubevolved.glb's own donor
// poses (Punch's forward lunge blended through its two unused gesture
// clips, No and Yes), so only mob_glub gets it.
const GLUB_FLOATING: ClipMap = {
  ...FLOATING,
  attack: ['Glub_Attack'],
};

// The dragonkin family's own attack (scripts/build_dragonkin_anims.mjs, issue
// #2889): the same FLOATING constant migrated mob_elemental gets its second
// migration here, still shared by reference across the remaining 8 unrelated
// families. This clip is baked off dragonevolved.glb's own donor poses (its
// Headbutt ram plus its own unused No/Yes gesture pair, the same spare-clip
// shape the elemental script found on golelingevolved.glb), so only
// mob_dragonkin gets it; every other FLOATING family stays untouched.
const DRAGONKIN_FLOATING: ClipMap = {
  ...FLOATING,
  attack: ['Dragonkin_Attack'],
};

// The flying demon family's own attack (scripts/build_demon_flying_anims.mjs,
// issue #2889): same FLOATING sharing problem as the elemental above, baked
// off demon.glb's own donor poses (a forward lunge plus its two unused
// gesture clips, same playbook as ELEMENTAL_FLOATING). Only mob_demon_flying
// gets it; every other FLOATING family is untouched.
const DEMON_FLYING_FLOATING: ClipMap = {
  ...FLOATING,
  attack: ['DemonFlying_Attack'],
};

// 2023 enemy rig variant with a bite attack and no run clip (yeti)
const ENEMY_BITE: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Walk',
  attack: ['Bite_Front'],
  hit: ['HitRecieve', 'HitRecieve_Dazed'],
  death: 'Death',
};

// The crab's own attack (scripts/build_crab_anims.mjs, issue #2889 round 2):
// crabenemy.glb ships several unused bonus donor clips (Bite_InPlace, Dance,
// No, Yes, Jump) alongside the shared Bite_Front every ENEMY_BITE family
// plays; this blends Dance's side-to-side wiggle into Bite_InPlace's
// in-place snap for a pincer-click flourish before the bite lands, distinct
// from the plain forward-lunging Bite_Front every other ENEMY_BITE family
// (mob_treant) still plays.
const CRAB_ENEMY_BITE: ClipMap = {
  ...ENEMY_BITE,
  attack: ['Crab_Attack'],
};

// The treant's own attack (scripts/build_treant_anims.mjs, issue #2889
// round 2): a tree "biting" reads wrong, so this reinterprets the shared
// ENEMY_BITE attack as a slam/root-grab off yeti.glb's own donor poses (a
// rooted Idle hold into Bite_Front's downward lean, repurposed as a
// branch-slam, settled by Dance's sway), instead of the plain Bite_Front
// every other ENEMY_BITE family (mob_crab) still plays. A low-node-count
// rig (2-3 animated nodes throughout), so the motion reads simple and
// blocky by nature.
const TREANT_ENEMY_BITE: ClipMap = {
  ...ENEMY_BITE,
  attack: ['Treant_Attack'],
};

// Procedurally authored Water Elemental. Node transforms ripple its layered
// translucent body and drive the hands through the Waterbolt casting motion.
const WATER_ELEMENTAL: ClipMap = {
  idle: 'Idle',
  walk: 'Move',
  run: 'Move',
  // Waterbolt uses the short one-shot Cast attack; Water Jet holds this
  // dedicated forward-arms loop for its full server-authoritative channel.
  cast: 'Channel',
  attack: ['Cast'],
  hit: ['Hit'],
  death: 'Death',
};

// The contributor-authored Colossus ships a dedicated rigid-rock rig and a
// complete boss animation set. Its channel loop drives the socket-mounted
// furnace/flamethrower VFX; impact pulses are synchronized by the encounter.
const IGNIVAR: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  death: 'Death',
  cast: 'Channel',
  flourish: 'FistSpin360',
};

// Ignivar Ashcaller is stationary in the encounter. Its clips keep Apocalypse
// in a sustained channel pose while retaining its authored cast and death motion.
const IGNIVAR_HEART: ClipMap = {
  idle: 'Idle',
  walk: 'Move',
  run: 'Move',
  attack: ['Cast'],
  death: 'Death',
  cast: 'Channel',
};

const IGNIVAR_CRUCIBLE_WARDEN: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  attackByAbility: {
    [VARKHUL_CRUCIBLE_QUAKE_CAST_ID]: 'JumpSlam',
    [DUNGEON_MINIBOSS_STOMP_ABILITY_ID]: 'JumpSlam',
  },
  attackTimeScaleByAbility: {
    [VARKHUL_CRUCIBLE_QUAKE_CAST_ID]: 0.8,
    [DUNGEON_MINIBOSS_STOMP_ABILITY_ID]: 1.35,
  },
  hit: ['Hit'],
  death: 'Death',
};

const IGNIVAR_EMBER_SENTINEL: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit'],
  death: 'Death',
};

const IGNIVAR_CINDER_ARTIFICER: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  attackByAbility: {
    [VARKHUL_CINDER_REPAIR_START_ANIMATION_ID]: 'ChannelStart',
    [VARKHUL_CINDER_REPAIR_END_ANIMATION_ID]: 'ChannelEnd',
  },
  attackTimeScaleByAbility: {
    [VARKHUL_CINDER_REPAIR_START_ANIMATION_ID]: 1,
    [VARKHUL_CINDER_REPAIR_END_ANIMATION_ID]: 1,
  },
  cast: 'Channel',
  hit: ['Hit'],
  death: 'Death',
};

// Varkhul, Forgefather of the Last Flame (varkhul_forgefather.glb): the
// authored smith body. Every major windup runs through the cast loop (PowerUp,
// a two-hand gathering raise); the payoff one-shots are dispatched per strike
// by varkhul_forge_hammer.ts (the assembly forge hammer, the Anvil's Decree
// strikes, the Molten Fissure release). Forging is 1.63s, stretched to the
// sim's exact 2s hammer cadence. No hit mapping on purpose: raid-wide damage
// must never thrash the boss rig (the mob_ignivar precedent).
const VARKHUL_FORGEFATHER: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  // plain swings only; Slam is reserved for the frontal windup below
  attack: ['Slash'],
  attackByAbility: {
    [VARKHUL_FORGE_HAMMER_ABILITY_ID]: 'Forging',
    [VARKHUL_ANVILS_DECREE_CAST_ID]: 'Forging',
    // each Forgestorm wave's windup cue: he powers up and the meteors answer
    [VARKHUL_FORGESTORM_CAST_ID]: 'PowerUp',
  },
  attackTimeScaleByAbility: {
    [VARKHUL_FORGE_HAMMER_ABILITY_ID]: VARKHUL_FORGING_STRIKE_TIMESCALE,
    [VARKHUL_ANVILS_DECREE_CAST_ID]: VARKHUL_FORGING_STRIKE_TIMESCALE,
    // authored 2.367s fills the 2.5s wave warning; 1 overrides the 1.3
    // one-shot default so the pump is not rushed
    [VARKHUL_FORGESTORM_CAST_ID]: 1,
  },
  // generic channel: the contained hand gesture, never the roar. Plays up to
  // the pointing gesture's peak (0.72s in, measured off the shipped clip) and
  // HOLDS that frame while the cast channels; the arm-down recovery plays on
  // release via castPlayOut instead of replaying the raise.
  cast: 'Casting',
  castHoldPointSeconds: 0.72,
  // Casting's arm-down and Slam's stand-back-up recoveries must not be cut
  // when the cast ends mid-clip: both finish before the rig returns to base.
  // Forging stays OFF this list: the decree cadence loop hands off instantly.
  castPlayOut: ['Casting', 'Slam'],
  castByAbility: {
    // the frontal windup is a full Slam swing: he crashes the hammer down and
    // the cone answers it
    [VARKHUL_FRONTAL_CAST_ID]: 'Slam',
    // at the anvil the decree cast IS the forging loop; the 2s strike
    // one-shots land on the same clip so the cadence stays seamless
    [VARKHUL_ANVILS_DECREE_CAST_ID]: 'Forging',
  },
  castTimeScaleByAbility: {
    // Slam's crash sits ~1.5s in; 0.65 lands it just before the 2.5s release
    [VARKHUL_FRONTAL_CAST_ID]: 0.65,
    [VARKHUL_ANVILS_DECREE_CAST_ID]: VARKHUL_FORGING_STRIKE_TIMESCALE,
  },
  jump: 'Jump',
  // the roar is the ENGAGE cue only (and respawn), never a cast loop
  flourish: 'PowerUp',
  death: 'Death',
};

const SPIDER: ClipMap = {
  idle: 'Spider_Idle',
  walk: 'Spider_Walk',
  run: 'Spider_Walk',
  attack: ['Spider_Attack'],
  death: 'Spider_Death', // no hit-react in asset
};

// Velociraptor rig (velociraptor.glb): like the spider, no hit-react clips
const RAPTOR: ClipMap = {
  idle: 'Velociraptor_Idle',
  walk: 'Velociraptor_Walk',
  run: 'Velociraptor_Run',
  attack: ['Velociraptor_Attack'],
  death: 'Velociraptor_Death',
};

// Chicken-cow rig (chicken_cow.glb, procedurally authored — see
// scripts/gen_chicken_cow.mjs). Node-transform animations, no hit-react.
const CHICKEN_COW: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  death: 'Death',
  jump: 'Jump',
};

// Raid 02 asset-pipeline rig (stone_cantor.glb): Mixamo-rigged, ships
// Idle / Cast / Walk / Death plus a synthesized 'Hit' flinch authored by
// scripts/_add_cantor_hit_anim.mjs (the batch has no hit-react take). A
// caster, so attack aliases the cast clip; run aliases walk (no run clip).
const RAID_CASTER: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Walk',
  attack: ['Cast'],
  cast: 'Cast',
  hit: ['Hit'],
  death: 'Death',
};

// Tolling Bell rig (tolling_bell.glb, Meshy-generated + node-transform animated
// via scripts/_add_bell_anim.mjs, no skeleton). Non-combat, hostile:false, moved
// manually by the boss driver every tick, so walk/run/attack/death are never
// reached: they just alias the two real clips to satisfy ClipMap.
const TOLLING_BELL: ClipMap = {
  idle: 'Idle',
  walk: 'Roll',
  run: 'Roll',
  attack: [],
  death: 'Idle',
};

// ---------------------------------------------------------------------------
// Asset urls
// ---------------------------------------------------------------------------

const PLAYERS = 'models/chars/players';
/** Modular part library (one GLB, every part), see modular.ts. */
const MODULAR = 'models/chars/modular';
const ENEMIES = 'models/chars/enemies';
const FORMS = 'models/chars/forms';
const CREATURES = 'models/creatures';
const PROPS = 'models/props';
const WEAPONS = 'models/weapons';
const MOUNTS_DIR = 'models/mounts';
const BUDDIES_DIR = 'models/buddies';

/** Exported for the authored-surface guard (tests/authored_surfaces.test.ts),
 *  which sweeps every shipped held model; render code resolves through
 *  itemOffhandModelUrl, never this table directly. */
export const ITEM_OFFHAND_MODELS: Readonly<Record<string, string>> = {
  eastbrook_buckler: 'shield_starter', // the warrior and paladin starting shield
  highwatch_wallshield: 'shield_field_steel', // the common heater shield (field set)
  // A shield draws the set one rarity down, like the weapons (src/ui/weapon_variants.ts):
  // a rare shield the common ones, an epic shield the rare set's (the pointed shield `_a`
  // for the walls and bulwarks, the round shield `_b` for wards, barriers and bucklers).
  bonewrought_bulwark: 'shield_rare_a_teal',
  duskforged_bulwark: 'shield_rare_a_violet', // crafted apex tower shield (masterwrought)
  pearlward_aegis: 'shield_field_steel', // the first caster (int/spi) shield
  // The Buried Hoard shields, one row per map-rarity tier (the tier clones are
  // their own items, not heroicOf copies, so none inherits a row). Each tier draws by
  // its item quality: the base and the `legendary_` clone are both epic items.
  glacier_hewn_bulwark: 'shield_rare_a_glacier',
  rare_glacier_hewn_bulwark: 'shield_field_steel',
  legendary_glacier_hewn_bulwark: 'shield_rare_a_deepice',
  storm_tuned_buckler: 'shield_rare_b_teal',
  rare_storm_tuned_buckler: 'shield_starter',
  legendary_storm_tuned_buckler: 'shield_rare_b_teal',
  // The inscription tomes: the first held_offhand item models, procedural GLBs
  // from scripts/assets/inscription_tomes (VAR_BOOK grips). The phase 09 apex
  // grimoire joined the family at phase 18, and with it left the conscious
  // no-model pin in tests/held_weapon_models.test.ts.
  silverleaf_primer: 'tome_silverleaf',
  goldleaf_folio: 'tome_goldleaf',
  sunpetal_grimoire: 'tome_sunpetal',
  voidbound_grimoire: 'tome_voidbound',
  // Crucible raid shields (content/ignivar_loot.ts): tank wall + healer barrier.
  bulwark_of_the_inner_crucible: 'shield_rare_a_crucible',
  ember_wardens_barrier: 'shield_rare_b_ember',
  votive_ward_of_the_deathless_court: 'shield_rare_b_violet', // Nythraxis gap-fill healer shield
  templar_dawn_shield: 'shield_rare_a_dawn', // Church Order quartermaster's mail shield (faction_vendors.ts)
  varkhul_emberward: 'varkhul_emberward', // Ignivar raid legendary (Varkhul drop)
};

/** Held-model GLBs whose materials are AUTHORED surfaces: a Tripo or Blender
 *  atlas that already carries its own shading, wear, and ember detail. The
 *  held-weapon polish (assets.ts applyWeaponMaterialPolish: cream lift, gloss
 *  clamp, metalness floor, uniform emissive floor) was authored for the KayKit
 *  palette kit; on one of these it lays a flat grey film over the whole atlas
 *  (the emissive floor lifts every black texel to the same grey, the gloss
 *  clamp adds a sheen the atlas never asked for). attachProp tags their meshes
 *  so applyMaterials keeps the shipped response instead. Also scales the
 *  low-tier readability floor by the atlas, as VisualDef.authoredAtlas does
 *  for bodies. Opt-in per model on purpose: every other held model keeps the
 *  polish it always had. Keyed by held-model key (ITEM_WEAPON_VARIANTS /
 *  ITEM_OFFHAND_MODELS values). */
export const AUTHORED_HELD_MODELS: ReadonlySet<string> = new Set([
  'balgath_barrowmaul_hammer', // Foreman's Barrowmaul (Balgath world-boss drop)
  'craterglass_stave', // Craterglass Stave (Balgath world-boss drop)
  'hammer_varkhul', // Varkhul Forgebreaker (Ignivar raid legendary)
  'shardpike_spear', // Skerrit's Shardpike (Balgath quest tool)
  'varkhul_emberward', // Varkhul Emberward (Ignivar raid legendary)
  // The starter weapons (painted atlases of their own, no kit palette)
  'sword_starter',
  'dagger_starter',
  'hammer_starter',
  'axe_starter',
  'staff_starter',
  'shield_starter',
  'crossbow_starter',
  'spellbook_starter',
  // The common and uncommon field weapons (the same painted pipeline as the starters)
  'sword_field_iron',
  'sword_field_steel',
  'sword_field_bronze',
  'sword_field_2h_iron',
  'sword_field_2h_steel',
  'dagger_field_iron',
  'dagger_field_steel',
  'dagger_field_bronze',
  'hammer_field_iron',
  'hammer_field_steel',
  'hammer_field_bronze',
  'hammer_field_2h_iron',
  'hammer_field_2h_steel',
  'axe_field_iron',
  'axe_field_steel',
  'axe_field_bronze',
  'staff_field_iron',
  'staff_field_steel',
  'staff_field_bronze',
  'spear_field_iron',
  'wand_field_iron',
  'wand_field_steel',
  'shield_field_steel',
  // The rare weapons (the same painted pipeline)
  'sword_rare_a_teal',
  'sword_rare_a_ember',
  'sword_rare_a_violet',
  'sword_rare_b_teal',
  'sword_rare_b_ember',
  'sword_rare_b_violet',
  'dagger_rare_a_teal',
  'dagger_rare_a_ember',
  'dagger_rare_a_violet',
  'dagger_rare_b_teal',
  'dagger_rare_b_ember',
  'dagger_rare_b_violet',
  'hammer_rare_a_teal',
  'hammer_rare_a_ember',
  'hammer_rare_b_teal',
  'hammer_rare_b_ember',
  'hammer_rare_b_violet',
  'axe_rare_a_teal',
  'axe_rare_b_ember',
  'staff_rare_a_teal',
  'staff_rare_a_violet',
  'staff_rare_b_teal',
  'staff_rare_b_ember',
  'staff_rare_b_violet',
  'spear_rare_a_teal',
  'spear_rare_b_ember',
  'wand_rare_a_teal',
  'wand_rare_b_ember',
  'wand_rare_b_violet',
  'shield_rare_a_teal',
  // ...and the rare looks the epic items brought in when they took the rare set
  'axe_rare_a_ember',
  'axe_rare_a_violet',
  'staff_rare_a_ember',
  'shield_rare_a_violet',
  'shield_rare_b_teal',
  'shield_rare_b_ember',
  'shield_rare_b_violet',
  // ...and the repainted finishes that give each epic item sharing a design a look of its own
  'sword_rare_a_jade',
  'sword_rare_a_spectral',
  'sword_rare_a_molten',
  'sword_rare_a_royal',
  'sword_rare_a_ivory',
  'sword_rare_a_anvil',
  'dagger_rare_a_frost',
  'dagger_rare_a_bone',
  'staff_rare_a_obsidian',
  'shield_rare_a_glacier',
  'shield_rare_a_deepice',
  'shield_rare_a_dawn',
  'shield_rare_a_crucible',
  // The epic weapons and shields (the same pack convention)
  'sword_epic_deathless_crucible_heart',
  'sword_epic_deathless_spectral_teal',
  'sword_epic_ossuary_ivory_amethyst',
  'sword_epic_ossuary_wyrm_teal',
  'sword_epic_tusk_ivory_jade',
  'sword_epic_tusk_predator_steel',
  'dagger_epic_cinder_coal_ember',
  'dagger_epic_dragonfang_basin_jade',
  'dagger_epic_dragonfang_ivory_violet',
  'dagger_epic_dragonfang_moonlit_pearl',
  'dagger_epic_marrow_ivory_amber',
  'hammer_epic_spring_verdant_ivory',
  'hammer_epic_wildwood_living_forest',
  'hammer_epic_wildwood_scorched_resin',
  'axe_epic_gravecleaver_fossil_gravegreen',
  'axe_epic_gravecleaver_slag_ember',
  'staff_epic_gravewyrm_bone_emerald',
  'staff_epic_hexwood_basin_turquoise',
  'staff_epic_hexwood_last_spring',
  'staff_epic_moonfang_bone_moon',
  'staff_epic_moonfang_lunar_tide',
  'wand_epic_deathless_quenched_ember',
  'wand_epic_deathless_royal_amethyst',
  'wand_epic_deathless_storm_crystal',
  'shield_epic_crucible_heat_blue_iron',
  'shield_epic_votive_bone_votive',
  'shield_epic_votive_ember_warden',
]);

/** True when a held-prop GLB url resolves to one of AUTHORED_HELD_MODELS (a held weapon
 *  under models/weapons/). */
export function isAuthoredHeldModelUrl(url: string): boolean {
  const m = /^models\/weapons\/([^/]+)\.glb$/.exec(url);
  return m !== null && AUTHORED_HELD_MODELS.has(m[1]);
}

/** Held models that are broad flat plates: a shield's faces, an open book's spread.
 *  The character rim (gfx.ts addRimGlow) is a fresnel term, made to trace the
 *  silhouette of a rounded form. A plate turned edge-on to the camera is ONE surface
 *  at ONE grazing angle, so the rim's cool tint lands on the whole face at once and
 *  reads as a purple-grey film over the painted texture (owner report on the starter
 *  shield's inner face; a live A/B with only the rim removed gave the wood back, by
 *  day and at dusk). These draw without the rim. The standard tier's alone: the low
 *  tier has no rim to drop. */
export const RIMLESS_HELD_MODELS: ReadonlySet<string> = new Set([
  'shield_starter',
  'spellbook_starter',
  'shield_field_steel',
  'shield_rare_a_teal',
  'shield_rare_a_violet',
  'shield_rare_a_glacier',
  'shield_rare_a_deepice',
  'shield_rare_a_dawn',
  'shield_rare_a_crucible',
  'shield_rare_b_teal',
  'shield_rare_b_ember',
  'shield_rare_b_violet',
  'shield_epic_crucible_heat_blue_iron',
  'shield_epic_votive_bone_votive',
  'shield_epic_votive_ember_warden',
]);

/** True when a held-prop GLB url resolves to one of RIMLESS_HELD_MODELS. */
export function isRimlessHeldModelUrl(url: string): boolean {
  const m = /^models\/weapons\/([^/]+)\.glb$/.exec(url);
  return m !== null && RIMLESS_HELD_MODELS.has(m[1]);
}

function itemModelKey(
  itemId: string | null | undefined,
  extra: Readonly<Record<string, string>> = {},
): string | null {
  if (!itemId) return null;
  const direct = Object.hasOwn(ITEM_WEAPON_VARIANTS, itemId)
    ? ITEM_WEAPON_VARIANTS[itemId]
    : undefined;
  const directExtra = Object.hasOwn(extra, itemId) ? extra[itemId] : undefined;
  if (direct || directExtra) return direct ?? directExtra ?? null;

  const item = Object.hasOwn(ITEMS, itemId) ? ITEMS[itemId] : undefined;
  const baseId = item?.heroicOf;
  if (!baseId) return null;
  const inherited = Object.hasOwn(ITEM_WEAPON_VARIANTS, baseId)
    ? ITEM_WEAPON_VARIANTS[baseId]
    : undefined;
  const inheritedExtra = Object.hasOwn(extra, baseId) ? extra[baseId] : undefined;
  return inherited ?? inheritedExtra ?? null;
}

/** GLB url for an equipped mainhand item's held weapon model, or null if the item
 *  has no mapped model (then the class default attach is kept). Mirrors the bag
 *  icon via the shared ITEM_WEAPON_VARIANTS map, so held weapon == inventory icon. */
export function itemWeaponModelUrl(itemId: string | null | undefined): string | null {
  const key = itemModelKey(itemId);
  return key ? `${WEAPONS}/${key}.glb` : null;
}

/** GLB url for an actual equipped offhand. One-handed weapons reuse the shared
 *  inventory/held-model map; shields use the narrow render-only table above. */
export function itemOffhandModelUrl(itemId: string | null | undefined): string | null {
  const key = itemModelKey(itemId, ITEM_OFFHAND_MODELS);
  return key ? `${WEAPONS}/${key}.glb` : null;
}

/** GLB url the offhand slot should render: the active weapon skin's model when it
 *  mirrors onto a matching-type offhand weapon (a rogue's second dagger
 *  under a dagger skin), otherwise the equipped offhand item's own model. A shield,
 *  held offhand (orb/tome), or different-type offhand weapon never mirrors, so it
 *  keeps its item model; null when the offhand has no mapped model. The mirror
 *  decision is the pure sim rule, so server and clients agree on both hands. */
export function offhandModelUrl(
  offhandItemId: string | null | undefined,
  weaponSkinId: string | null | undefined,
): string | null {
  if (offhandMirrorsWeaponSkin(weaponSkinId, offhandItemId)) {
    return weaponSkinModelUrl(weaponSkinId);
  }
  return itemOffhandModelUrl(offhandItemId);
}

/** Distinct held-weapon GLB urls (one per variant), for the boot preload sweep so
 *  setWeapon can attach any equipped weapon synchronously (resolvedGltf throws on
 *  an un-preloaded url). */
export function itemWeaponModelUrls(): string[] {
  return [...new Set(Object.values(ITEM_WEAPON_VARIANTS).map((key) => `${WEAPONS}/${key}.glb`))];
}

function itemOffhandModelUrls(): string[] {
  return [...new Set(Object.values(ITEM_OFFHAND_MODELS).map((key) => `${WEAPONS}/${key}.glb`))];
}

/** GLB url for a Season 1 Armory weapon-skin cosmetic, or null for no/unknown
 *  skin. The skin model replaces the equipped item's held model (same bone, its
 *  own KAYKIT_WEAPON_ACCESSORY grip family + WEAPON_GRIP_OVERRIDES fine-tune). */
export function weaponSkinModelUrl(skinId: string | null | undefined): string | null {
  if (!skinId) return null;
  const def = WEAPON_SKINS[skinId];
  return def ? `${WEAPONS}/${def.model}.glb` : null;
}

/** Distinct weapon-skin GLB urls, preloaded like item weapon models: any nearby
 *  player can have a skin applied, and the attach path is synchronous. */
export function weaponSkinModelUrls(): string[] {
  return [...new Set(Object.values(WEAPON_SKINS).map((def) => `${WEAPONS}/${def.model}.glb`))];
}

const LOW_URL_ALIAS: Record<string, string> = {
  'models/chars/players/rogue_hooded.glb': 'models/chars/players/rogue.glb',
};

const HUMANOID_H = 2.6;

// ---------------------------------------------------------------------------
// The authored swim lane
//
// Every player body rides the same Rig_Medium, so both strokes ship in ONE
// clip-only GLB (no meshes, no skin — the bow_anims.glb precedent) that is
// layered onto each class file through `animUrls`. Authored in Blender
// (tmp/swim/build_swim.py) and retargeted onto the shipped rest pose by
// scripts/build_swim_anims.mjs.
//
// Both clips carry the FULL prone posture (body flat, head leading, face down),
// unlike the Lie_Idle pose the rest of the KayKit rigs still swim with — which
// stays in every GLB and is still what mobs and creatures use.
// ---------------------------------------------------------------------------
const SWIM_ANIMS_URL = `${PLAYERS}/swim_anims.glb`;
/** Submerged stroke: arms sweep out and back to centre, legs frog-kick. */
export const SWIM_CLIP_SUBMERGED = 'Swim_Breaststroke';
/** Surface stroke: alternating overarm crawl over a flutter kick. */
export const SWIM_CLIP_SURFACE = 'Swim_Freestyle';
/** The swim idle: upright, arms sculling, legs running an eggbeater. The only
 *  UPRIGHT clip in the pack, which is why the renderer sinks the body for it
 *  (visual.ts SWIM_RISE_TREAD) instead of floating it like the prone strokes. */
export const SWIM_CLIP_TREAD = 'Swim_Tread';
/** Walking through water too shallow to swim in: short, high-kneed, leaning. */
export const WATER_CLIP_WADE = 'Water_Wade';
/** Long-fall panic flail: upright, arched back, arms windmilling out of phase,
 *  legs treading air (tmp/fall/build_fall.py). Rides the same clip-only GLB. */
export const FALL_CLIP_FLAIL = 'Fall_Flail';

/** Layer the authored water + fall clips onto a player body's class GLB. */
function swims(def: VisualDef): VisualDef {
  return {
    ...def,
    animUrls: [...(def.animUrls ?? []), SWIM_ANIMS_URL],
    clips: {
      ...def.clips,
      swim: SWIM_CLIP_SUBMERGED,
      swimSurface: SWIM_CLIP_SURFACE,
      swimIdle: SWIM_CLIP_TREAD,
      wade: WATER_CLIP_WADE,
      fall: FALL_CLIP_FLAIL,
    },
  };
}

export const SKINS_DIR = 'textures/skins';

// ---------------------------------------------------------------------------
// Combat Mech — a class-agnostic cosmetic body. Unlike the per-class skins
// below (which swap a body atlas onto an existing class rig), the mech is a
// SEPARATE model with its own visual key (`player_mech`) and a set of chroma
// textures grouped across the three skin-event rarity tiers. Epics additionally
// ship an emissive glow map. Cosmetic preview only for now — lazy-loaded via
// preloadMechAssets() so it never bloats every client's boot.
// ---------------------------------------------------------------------------
const MECH_DIR = `${PLAYERS}/Mech/textures`;

function mechChromaUrl(c: MechChroma): string {
  if (c.rank === 'uncommon') return `${MECH_DIR}/uncommon/combatmech_${c.id}.png`;
  if (c.rank === 'rare') return `${MECH_DIR}/rares/combatmech_rare_${c.id}.png`;
  return `${MECH_DIR}/epics/combatmech_epic_${c.id}.png`;
}
function mechEmissiveUrl(c: MechChroma): string | null {
  return c.rank === 'epic' ? `${MECH_DIR}/epics/combatmech_epic_${c.id}_emis.png` : null;
}

// Per-class alternate body textures ("skins"). Index 0 = null = the model's
// embedded default texture (no swap). Index >0 = a full-atlas alternate applied
// to the body material's .map (same UVs). Classes sharing a model share its skin
// set. Players only — mobs/npcs keep their default look. See public/textures/skins/.
export const SKINS: Record<string, (string | null)[]> = {
  // The WOC warrior body carries its own authored atlases; the knight alt
  // atlases are KayKit-UV art and would paint garbage on it. Six null slots
  // keep SKIN_COUNTS.warrior (a saved skin index stays valid, and resolves
  // to the authored look).
  player_warrior: [null, null, null, null, null, null],
  // The WOC paladin body has no KayKit atlas variants (the knight atlases are
  // KayKit UVs); four identical slots keep the skin picker's shape.
  player_paladin: [null, null, null, null],
  player_hunter: [null, null, null, null, null, null],
  player_rogue: [null, null, null, null, null, null],
  player_priest: [null, null, null, null, null, null],
  player_mage: [null, null, null, null, null, null],
  player_warlock: [null, null, null, null, null, null],
  player_shaman: [null, null, null, null, null, null],
  player_druid: [null, null, null, null, null, null],
  // Combat Mech chromas — every index is a real full-model texture (no null
  // default; the embedded base texture is not one of the rewards).
  player_mech: MECH_CHROMAS.map(mechChromaUrl),
  // Bursar Fernando (the Eastbrook banker easter egg): the rogue palette with
  // the skin swatch repainted light brown and the hair/brow swatch black, in
  // the real Fernando's likeness. Index 0 is the real texture (mech precedent):
  // NPCs always resolve skin 0, so the embedded default is deliberately unused.
  npc_fernando: [`${SKINS_DIR}/rogue/fernando.png`],
};

// Emissive (glow) maps keyed exactly like SKINS, applied to .emissiveMap when a
// skin index has one. Only the Combat Mech epics glow; null entries mean no glow.
export const SKIN_EMISSIVE: Record<string, (string | null)[]> = {
  player_mech: MECH_CHROMAS.map(mechEmissiveUrl),
};

/** Number of skins (including the default) available for a visual key — min 1. */
export function skinCount(key: string): number {
  return SKINS[key]?.length ?? 1;
}

/** How many player skin variants the boot prewarm plans across every class: one rig per
 *  authored skin per class (`skinCount`), which the prewarm manifest and its telemetry
 *  both read so they can never disagree about the count. */
export function prewarmPlayerSkinVariantCount(): number {
  return ALL_CLASSES.reduce((sum, cls) => sum + skinCount(`player_${cls}`), 0);
}

/** Texture url to preview a skin option (default index 0 → the model's base.png). */
export function skinThumbUrl(key: string, index: number): string | null {
  const arr = SKINS[key];
  if (!arr || index < 0 || index >= arr.length) return null;
  if (arr[index]) return arr[index];
  const firstAlt = arr.find((u): u is string => !!u); // derive dir from an alt
  return firstAlt ? firstAlt.replace(/\/[^/]+$/, '/base.png') : null;
}

// Quaternius-style velociraptor rig (velociraptor.glb): no hit-react in the
// asset, same as the spider/raptor rigs noted in src/render/characters/CLAUDE.md.
const VELOCIRAPTOR: ClipMap = {
  idle: 'Velociraptor_Idle',
  walk: 'Velociraptor_Walk',
  run: 'Velociraptor_Run',
  attack: ['Velociraptor_Attack'],
  death: 'Velociraptor_Death',
  jump: 'Velociraptor_Jump',
};

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/** The Bone Spike's ember-orange recolour (see mob_nythraxis_bone_spike below). */
export const NYTHRAXIS_BONE_SPIKE_TINT = 0xff7a1a;
export const NYTHRAXIS_BONE_SPIKE_TINT_STRENGTH = 1;
export const NYTHRAXIS_BONE_SPIKE_SELF_ILLUMINATION = 0.35;
/** The spike's click capsule, about twice the footprint-derived default
 *  (0.88 * 2.6/1.6 * 0.9 = 1.29): a click anywhere near the spike lands on
 *  it, not on the raider it pins (owner call, 2026-09-11). */
export const NYTHRAXIS_BONE_SPIKE_CLICK_RADIUS = 2.6;

// Morthen the Gravecaller as the Lich Bishop (scripts/assets/hollow_crypt_creatures/
// build_morthen.py): two whole vocabularies on one rig. With the BELL STAFF he
// glides, strikes with the bell head and the shaft, tolls the bell for his
// Shadow Pulse, and his entrance rides his cast bar: he unfurls as he rises
// (Rise), raises his off hand as he speaks the names (SummonSouls; the v2 body
// carries no Book of Names) and holds his ward
// as he comes down (ShieldRitual). At his Last Rites the staff's crest UNFOLDS
// INTO A SCYTHE (Transform) and every clip after it carries the blade out.
// The Pearlguard Sentinel's two stances (temple_sentinel below): the manta
// gliding open-winged, and its cocoon (the wings wrapped under its belly)
// while its Pearl Carapace holds.
const SENTINEL_CLIPS: ClipMap = {
  ...TEMPLE_CLIPS,
  castByAbility: { [TEMPLE_PEARL_SLAM]: 'Slam' },
  castTimeScaleByAbility: { [TEMPLE_PEARL_SLAM]: 1 },
};
const SENTINEL_SHELL_CLIPS: ClipMap = {
  ...SENTINEL_CLIPS,
  idle: 'ShellIdle',
  walk: 'ShellWalk',
  run: 'ShellWalk',
  attack: ['ShellAttack'],
  hit: ['ShellHit'],
  cast: 'ShellIdle',
};

const MORTHEN_STAFF_CLIPS: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['StaffStrike', 'StaffStrike2'],
  attackByAbility: { [MORTHEN_TOLL]: 'BellToll' },
  attackTimeScaleByAbility: { [MORTHEN_TOLL]: 1 },
  hit: ['Hit'],
  death: 'Death',
  cast: 'SummonSouls',
  castByAbility: {
    [MORTHEN_RITE_WAKES]: 'Rise',
    [MORTHEN_RISE]: 'Rise',
    [MORTHEN_PROCLAIM]: 'SummonSouls',
    [MORTHEN_DESCEND]: 'ShieldRitual',
    // The Rite of the Unquiet: the staff held level before him, the ward up.
    [MORTHEN_RITE]: 'ShieldRitual',
  },
  castTimeScaleByAbility: { [MORTHEN_RISE]: 1, [MORTHEN_PROCLAIM]: 1, [MORTHEN_DESCEND]: 1 },
};
const MORTHEN_SCYTHE_CLIPS: ClipMap = {
  idle: 'ScytheIdle',
  walk: 'ScytheWalk',
  run: 'ScytheRun',
  attack: ['ScytheSweep', 'ScytheSweep2'],
  // Reap the Unquiet: the bar winds the blade up (ScytheSummon, the scythe
  // raised over the souls), the landing brings it round in the flat sweep, fast
  // (its cut at frame 14 lands about 0.3 s after the hit).
  attackByAbility: { [MORTHEN_TOLL]: 'ScytheToll', [MORTHEN_REAP_SWEEP]: 'ScytheSweep' },
  attackTimeScaleByAbility: { [MORTHEN_TOLL]: 1, [MORTHEN_REAP_SWEEP]: 1.9 },
  hit: ['ScytheHit'],
  death: 'ScytheDeath',
  cast: 'ScytheSummon',
  castByAbility: { [MORTHEN_REAP]: 'ScytheSummon' },
};

// The held-prop size on the art guide's crypt bodies. Their rigs stand about 1.9 units
// tall natively, where a WOC body stands 1.15 with a handslot that draws props at 0.46:
// 0.46 x 1.9 / 1.15 is 0.76, so a sword sits in their fist at the size a WOC body holds it.
const WOC_CRYPT_PROP_SIZE = 0.76;

// The skeleton minion remade through the art guide (scripts/assets/specs/
// woc_skeleton_minion.json): a T-pose concept, Tripo Smart Mesh P2.0, and a 31-bone
// rig built for this mesh with every clip animated for it in Blender at 30 fps. It
// fights unarmed, as the KayKit minion did (handslot.l/.r are there for a weapon).
// Walk and Run are authored at their ground speeds (1.44 and 4.31 raw units/s, scaled
// by height over the 1.797 posed idle height), so a wander and a full chase stay
// inside the cadence clamps. Death collapses it into a heap of bones; Awaken (the
// flourish: a respawn, Reassemble, a summon) pulls the heap back onto its feet and
// ends on Idle, and a boss's summoned minions rise on it too. Cast is a raised-hands
// conjuring loop for the cast bars.
const WOC_SKELETON_MINION: VisualDef = {
  url: `${CREATURES}/woc_skeleton_minion.glb`,
  height: 2.5,
  clips: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack'],
    hit: ['React'],
    death: 'Death',
    flourish: 'Awaken',
    cast: 'Cast',
    // a summoned minion rises the same way (sim/mob/summon_rise.ts, summon_rise_fx.ts)
    entrance: 'Awaken',
  },
  entranceGesture: SUMMON_RISE_CUE,
  // its first swing never cuts the rise short
  oneShotsHoldAttacks: ['Awaken'],
  walkRef: 2.0,
  runRef: 6.0,
  authoredAtlas: true,
  tint: 'entity',
  tintStrength: 0.25,
};

export const VISUALS: Record<string, VisualDef> = {
  // -- player classes ------------------------------------------------------
  // The WOC warrior: the artist's modular character handoff on its own 34-joint
  // `WOC_Armored_Rig`: the male base and animation library, dressed from the
  // warrior armor set (woc_armor_core.ts). Its 51 clips are the ONLY clips this
  // body plays: no KayKit donor GLB (the hit-variety, ability and swim lanes
  // ride Rig_Medium's bind pose) is layered on. Every part (body, face pieces,
  // each armor piece) is a named node the renderer shows or hides per instance
  // from `wocCharacter` (woc_parts_core.ts); equipped items select their armor
  // pieces across the six armor slots.
  player_warrior: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    // A tenth taller than the KayKit-sized roster (the artist's body reads
    // small at the shared height); the held weapons scale with the rig.
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_WARRIOR_MANIFEST,
    hideWeaponsWhileSwimming: true,
    // The refined strikes are authored with their own wind-up/strike/recovery
    // timing and are meant to play at 1x (handoff INTEGRATION.md), not the
    // KayKit-era 1.3x speed-up playAttack defaults to.
    attackTimeScale: 1,
    // The stroke rides its hips 1.33 world units above the origin, which the sim
    // seats 0.75 under the line: this leaves the chest at the surface and the
    // hips 0.07 under it (measured, tmp/woc/swim_measure.mjs). The upright
    // Swim_Idle tread keeps its hips at standing height, so it sinks further
    // to put the waterline at the chest.
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['1H_Chop', '1H_Slash']),
      // Instant casts play no gesture on this body (owner call): the six
      // shouts keep their ring and wave, the roar animation is off.
      shoutEmote: null,
      attackByHand: { twohand: '2H_Chop', dualwield: 'Dual_Chop' },
      // Dual_Chop is two self-contained fast strikes from the crossed guard, 24
      // frames at 60 fps each (2026-09-28): the cut at 0.4 s lands exactly on the
      // guard between them, and each blade lands ~0.125 s into its half
      // (WOC_CONTACTS; tests/woc_character.test.ts measures both off the library).
      dualWieldSplit: 0.4,
      // Every warrior ability the KayKit body routed keeps its entry; the clips
      // are this rig's own vocabulary (verified against the shipped GLB by
      // tests/character_clipmaps.test.ts and tests/warrior_render_contract.test.ts).
      attackByAbility: {
        mortal_strike: '2H_Chop',
        execute: '2H_Chop',
        slam: '2H_Chop',
        red_harvest: '2H_Chop',
        breachmaker: '2H_Chop',
        // Shieldcrack braces behind the offhand shield: the rig's guard (the
        // KayKit body had a synthesized shield bash; this rig ships none).
        shield_slam: 'Block',
        raging_gale: 'Dual_Chop',
        bloodthirst: 'Dual_Chop',
        // Reaping Arc and Revenge sweep the frontal arc: the sideways slash,
        // never the top-to-bottom chop (owner: "sideways sword sweep").
        cleave: '1H_Slash',
        revenge: '1H_Slash',
        thunder_clap: '1H_Chop',
        faultline: '1H_Chop',
        heroic_strike: '1H_Slash',
        overpower: '1H_Slash',
        hamstring: '1H_Slash',
        // Jawcrack is a bare-fist interrupt; this rig has no punch, so the
        // quick chop stands in.
        pummel: '1H_Chop',
        // Vaulting Charge completes through the renderer's generic 'selfCast'
        // cue, which only draws a body gesture via this exact entry: the
        // two-hand slam reads as the landing (no bespoke leap on this rig).
        heroic_leap: '2H_Chop',
        // Victor's Surge is a real weapon strike: the decisive one-hand slash.
        victory_rush: '1H_Slash',
        // Deliberately absent (owner call: instant casts play no animation on
        // this body): sanguine_aura, raised_guard, die_by_sword, berserker_rage,
        // recklessness, avatar, piercing_howl. With no entry the ability
        // painter draws no gesture and the generic cast arm stays silent
        // (CharacterVisual.playAttack gestureOnly); only real strikes swing.
      },
    },
    attach: [
      { url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/shield_round.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  // The paladin rides the SAME WOC body, appearance parts and 51 clips as the
  // warrior (its build takes the warrior pack's base and appearance; only the
  // armor pack differs) and dresses from `armor_paladin.glb`. Same owner rules
  // as the warrior: instant casts play no gesture, only real strikes swing.
  player_paladin: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_PALADIN_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['1H_Chop', '1H_Slash']),
      shoutEmote: null,
      attackByHand: { twohand: '2H_Chop', dualwield: 'Dual_Chop' },
      dualWieldSplit: 0.4,
      // Only the weapon strikes: Crusader Strike and Vowkeeper Strike are
      // one-hand blows, Final Edict the decisive two-hand chop; the two
      // interrupts stand in with the quick chop like the warrior's Jawcrack.
      // Every instant cast (auras, blessings, wards, shocks, hammers, the
      // taunts, Consecration, Bastion Sweep, Sunward Disc) has no entry on
      // purpose: no gesture, no emote. Timed heals ride the cast loop.
      attackByAbility: {
        crusader_strike: '1H_Chop',
        vowkeeper_strike: '1H_Slash',
        final_edict: '2H_Chop',
        hushbrand: '1H_Chop',
        rebuke: '1H_Chop',
        mercy_lance: 'Cast_Shoot',
      },
    },
    attach: [
      { url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/shield_square.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  // The hunter on the WOC body (equipment set of 2026-09-18). The auto shot and
  // every instant shot play the artist's crossbow clip; a timed shot aims from
  // its raise and holds the crossbow up until the cast lands, then the release
  // half (the shot and the lowering) plays at the damage event, so the raise
  // never replays under the shot (clipSplits). The clip is a snap shot
  // (2026-09-29): the sim launches the bolt on the attack event, so the
  // crossbow is up and aimed by 0.13 s and fires straight after the 0.17 s
  // split, instead of the old 0.62 s raise that fired long after the bolt.
  // Melee strikes swing the blade. Aspects, traps and pet commands play nothing.
  player_hunter: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_HUNTER_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['Ranged_Shoot']),
      meleeAttack: ['1H_Chop', '1H_Slash'],
      shoutEmote: null,
      clipSplits: [
        { clip: 'Ranged_Shoot', at: 0.17, names: ['Ranged_Shoot#aim', 'Ranged_Shoot#release'] },
      ],
      cast: 'Ranged_Shoot#aim',
      castHoldPointSeconds: 0.15,
      castByAbility: {
        volley: 'Ranged_Shoot',
        rapid_fire: 'Ranged_Shoot',
        tame_beast: 'Cast_Loop',
        revive_pet: 'Cast_Loop',
      },
      attackByAbility: {
        aimed_shot: 'Ranged_Shoot#release',
        measured_shot: 'Ranged_Shoot#release',
        arcane_shot: 'Ranged_Shoot',
        serpent_sting: 'Ranged_Shoot',
        wyvern_sting: 'Ranged_Shoot',
        raptor_strike: '1H_Chop',
        mongoose_bite: '1H_Slash',
        wing_clip: '1H_Slash',
        bloodhook: '1H_Slash',
        counter_shot: 'Ranged_Shoot',
        startle_shot: 'Ranged_Shoot',
        concussive_shot: 'Ranged_Shoot',
        multi_shot: 'Ranged_Shoot',
        shrapnel_charge: 'Ranged_Shoot',
      },
    },
    attach: [{ url: `${WEAPONS}/crossbow_starter.glb`, bone: 'handslot.r' }],
  },
  // The rogue on the WOC body: every strike, opener and finisher is a weapon
  // blow, so the physical damage event swings the artist's clips (the dual
  // halves alternate when two blades are drawn) and needs no per-ability
  // entry; stealth, sprint, poisons and the cooldowns play nothing.
  player_rogue: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_ROGUE_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['1H_Chop', '1H_Slash']),
      shoutEmote: null,
      attackByHand: { dualwield: 'Dual_Chop' },
      dualWieldSplit: 0.4,
      // The one-hand names resolve through the loadout: with a blade in each hand the chop
      // family plays the thrust (Dual_Stab) and the slash family the X-slash (Dual_Cross);
      // with one blade the free-hand single set. Sinister Strike, Hemorrhage and the rest of
      // the builders swing the fast Dual_Chop halves like the auto attack.
      attackByAbility: {
        venom_dart: 'Cast_Shoot',
        crippling_poison: '1H_Slash',
        rupture: '1H_Slash',
        eviscerate: '1H_Slash',
        expose_armor: '1H_Slash',
        backstab: '1H_Chop',
        ambush: '1H_Chop',
        gouge: '1H_Chop',
        cheap_shot: '1H_Chop',
        kidney_shot: '1H_Chop',
      },
    },
    attach: [
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  // The priest on the WOC body (the Holy Priest set). Smite and Mind Blast
  // release through the throw; the heals lower the arm; Mind Flay, Mind Sear
  // and the Choir channel the cast loop. The halo rides the head bone at the
  // hood's tip, sized to this rig (the KayKit 1.45 cleared the mage hat).
  player_priest: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_PRIEST_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['2H_Chop']),
      shoutEmote: null,
      // A timed cast raises the casting arm (Cast_Raise) and holds it at the
      // top until the cast lands: a bolt then releases through the throw
      // (Cast_Shoot, attackByAbility below), anything else (heals, wards,
      // summons, conjures) lowers the arm through the clip's own recovery.
      // Channels weave the artist's cast loop. Every instant is silent: no
      // gesture, no emote.
      cast: 'Cast_Raise',
      castHoldPointSeconds: 1.0,
      castPlayOut: ['Cast_Raise'],
      castByAbility: {
        mind_flay: 'Cast_Loop',
        mind_sear: 'Cast_Loop',
        choir_of_deliverance: 'Cast_Loop',
      },
      attackByAbility: { smite: 'Cast_Shoot', mind_blast: 'Cast_Shoot' },
    },
    halo: 0xffd766,
    haloUpOffset: 0.28,
    haloRadius: 0.2,
    attach: [
      { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', swapOnly: true },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  // The shaman on the WOC body: weapon strikes (Stormstrike, the imbued auto
  // attack, two-hand and dual-wield swings) ride the blade clips; Lightning
  // Bolt and Chain Lightning release through the throw; the heals, Ghost Wolf
  // and Ancestor Return lower the arm. Shocks, totems, shields and imbues play
  // nothing.
  player_shaman: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_SHAMAN_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['1H_Chop', '1H_Slash']),
      shoutEmote: null,
      attackByHand: { twohand: '2H_Chop', dualwield: 'Dual_Chop' },
      dualWieldSplit: 0.4,
      // A timed cast raises the casting arm (Cast_Raise) and holds it at the
      // top until the cast lands: a bolt then releases through the throw
      // (Cast_Shoot, attackByAbility below), anything else (heals, wards,
      // summons, conjures) lowers the arm through the clip's own recovery.
      // Channels weave the artist's cast loop. Every instant is silent: no
      // gesture, no emote.
      cast: 'Cast_Raise',
      castHoldPointSeconds: 1.0,
      castPlayOut: ['Cast_Raise'],
      attackByAbility: { lightning_bolt: 'Cast_Shoot', chain_lightning: 'Cast_Shoot' },
    },
    attach: [
      { url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/shield_round.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  // The mage on the WOC body. Bolts, the timed ground spells and the timed
  // crowd control release through the throw; Arcane Missiles and Evocation
  // channel the cast loop; barriers, procs, Blink and the instant novas play
  // nothing. The Hourglass keeps a throw because the ability painter forces a
  // gesture on hostile crowd control, and a throw beats the staff swing it
  // would fall back to.
  player_mage: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_MAGE_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['2H_Chop']),
      shoutEmote: null,
      // A timed cast raises the casting arm (Cast_Raise) and holds it at the
      // top until the cast lands: a bolt then releases through the throw
      // (Cast_Shoot, attackByAbility below), anything else (heals, wards,
      // summons, conjures) lowers the arm through the clip's own recovery.
      // Channels weave the artist's cast loop. Every instant is silent: no
      // gesture, no emote.
      cast: 'Cast_Raise',
      castHoldPointSeconds: 1.0,
      castPlayOut: ['Cast_Raise'],
      castByAbility: { arcane_missiles: 'Cast_Loop', evocation: 'Cast_Loop' },
      attackByAbility: {
        fireball: 'Cast_Shoot',
        frostbolt: 'Cast_Shoot',
        flurry: 'Cast_Shoot',
        glacial_spike: 'Cast_Shoot',
        pyroblast: 'Cast_Shoot',
        arcane_surge: 'Cast_Shoot',
        scorch: 'Cast_Shoot',
        flamestrike: 'Cast_Shoot',
        blizzard: 'Cast_Shoot',
        rings_of_frost: 'Cast_Shoot',
        polymorph: 'Cast_Shoot',
        temporal_hourglass: 'Cast_Shoot',
        glacial_front: 'Cast_Shoot',
        dragons_breath: 'Cast_Shoot',
      },
    },
    attach: [
      { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', swapOnly: true },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  // The warlock on the WOC body: the wand auto attack is the throw itself,
  // every timed bolt and curse releases through it, Drain Life channels the
  // cast loop, the summons lower the arm. Life Tap, Demon Skin, the pet
  // commands and every other instant play nothing.
  player_warlock: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_WARLOCK_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['Cast_Shoot']),
      meleeAttack: ['1H_Chop', '1H_Slash'],
      shoutEmote: null,
      // A timed cast raises the casting arm (Cast_Raise) and holds it at the
      // top until the cast lands: a bolt then releases through the throw
      // (Cast_Shoot, attackByAbility below), anything else (heals, wards,
      // summons, conjures) lowers the arm through the clip's own recovery.
      // Channels weave the artist's cast loop. Every instant is silent: no
      // gesture, no emote.
      cast: 'Cast_Raise',
      castHoldPointSeconds: 1.0,
      castPlayOut: ['Cast_Raise'],
      castByAbility: { drain_life: 'Cast_Loop' },
      attackByAbility: {
        shadow_bolt: 'Cast_Shoot',
        immolate: 'Cast_Shoot',
        corruption: 'Cast_Shoot',
        soul_lance: 'Cast_Shoot',
        searing_pain: 'Cast_Shoot',
        soul_harvest: 'Cast_Shoot',
        chaos_bolt: 'Cast_Shoot',
        fear: 'Cast_Shoot',
        needle_of_fate: 'Cast_Shoot',
      },
    },
    attach: [
      { url: `${WEAPONS}/wand.glb`, bone: 'handslot.r' },
      {
        // The starter spellbook, laid out like the open kit book it replaced. This
        // rig carries no Spellbook_open accessory node (the kit rigs' seat for the
        // book), so the book sits on the hand slot itself; half a turn about its
        // spine opens it toward the warlock instead of away from him (owner call).
        // The turn is the hand's alone: the carry takes its pose from back_grips.
        url: `${WEAPONS}/spellbook_starter.glb`,
        bone: 'handslot.l',
        rotationY: Math.PI,
      },
    ],
    weaponSlots: [0],
  },
  // The druid on the WOC body (the caster form; bear, cat and travel forms are
  // their own visuals). Wrath and Starfire release through the throw, Roots and
  // Hibernate too, Hurricane channels the cast loop, the heals lower the arm.
  // Moonfire, Faerie Fire, the buffs and the shapeshifts play nothing.
  player_druid: {
    // the male base and animation library, streamed on demand (woc_armor_core.ts)
    url: `${PLAYERS}/woc/base_male.glb`,
    animUrls: [`${PLAYERS}/woc/anims_male.glb`],
    lazyPreload: true,
    height: HUMANOID_H * 1.1,
    authoredAtlas: true,
    envSheen: WOC_ENV_SHEEN,
    wocCharacter: WOC_DRUID_MANIFEST,
    hideWeaponsWhileSwimming: true,
    attackTimeScale: 1,
    swimRise: { stroke: -0.65, tread: -1.0 },
    // The backpedal is authored at its game speed (0.65 x the 7 yd/s run).
    walkBackRef: 4.55,
    rightShoulderSheathe: true,
    clips: {
      ...woc(['2H_Chop']),
      shoutEmote: null,
      // A timed cast raises the casting arm (Cast_Raise) and holds it at the
      // top until the cast lands: a bolt then releases through the throw
      // (Cast_Shoot, attackByAbility below), anything else (heals, wards,
      // summons, conjures) lowers the arm through the clip's own recovery.
      // Channels weave the artist's cast loop. Every instant is silent: no
      // gesture, no emote.
      cast: 'Cast_Raise',
      castHoldPointSeconds: 1.0,
      castPlayOut: ['Cast_Raise'],
      castByAbility: { hurricane: 'Cast_Loop', tranquility: 'Cast_Loop' },
      attackByAbility: {
        wrath: 'Cast_Shoot',
        starfire: 'Cast_Shoot',
        entangling_roots: 'Cast_Shoot',
        hibernate: 'Cast_Shoot',
      },
    },
    attach: [
      { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', swapOnly: true },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },

  // -- cosmetic body skin (class-agnostic; both the skin preview and a live
  //    player whose skinCatalog === 'mech', see visualKeyFor) ----------------
  player_mech: swims({
    url: `${PLAYERS}/Mech/characters/CombatMech.glb`,
    height: HUMANOID_H,
    // The mech is rigged to the same KayKit Rig_Medium skeleton as every other
    // player class; its GLB shipped with no clips, so the full KayKit set is
    // baked in from knight.glb (scripts/bake_mech_anims.mjs) — these names now
    // resolve like any other class. Lazy-loaded; see preloadMechAssets().
    clips: { ...kaykit(['1H_Melee_Attack_Chop']), wandAttack: 'Spellcast_Shoot' },
    // Same bow-draw donor the hunter loads. The mech is the one body that shows
    // a HUNTER's equipped weapon, so it is also the one body besides the hunter
    // that can display a bow skin, and Bow_Draw_Shot targets the same KayKit
    // Rig_Medium bones this model uses. Without it a displayed bow falls back to
    // the melee chop (skin_attack.ts pickSkinAttackClips).
    animUrls: [
      `${PLAYERS}/Mech/characters/CombatMech_hit_variety_anims.glb`,
      `${PLAYERS}/bow_anims.glb`,
    ],
    // Class-agnostic cosmetic body, but it still holds the wearer's equipped
    // mainhand: the shared handslot.r bone carries the grip (the mech reuses the
    // exact KayKit rig), so weaponSlots swaps attach[0] to the equipped weapon's
    // model just like every other class. The sword is only the no-weapon default.
    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],
    weaponSlots: [0],
    lazyPreload: true,
  }),

  // -- forms ---------------------------------------------------------------
  form_sheep: {
    url: `${CREATURES}/alpaca.glb`,
    height: 1.2,
    clips: animal(['Attack_Headbutt']),
  },
  // Purpose-built quadruped (replaced a brown-tinted yeti, which was a biped
  // standing in for a bear). No tint: the sculpt ships its own texture.
  // walkRef/runRef are measured from the clips themselves (a planted foot slides
  // backwards relative to the hips at exactly body speed), scaled by
  // height/rawHeight = 2.35/0.588. They put full run (RUN_SPEED 7) at timeScale
  // 1.30, clear of the 1.6 clamp where feet start skating.
  form_bear: {
    url: `${CREATURES}/bear_form.glb`,
    height: 2.35,
    clips: BEAR_FORM,
    walkRef: 1.6,
    runRef: 5.4,
    attackTimeScale: 1,
  },
  form_metamorph: {
    url: `${FORMS}/metamorphosis.glb`,
    height: 2.55,
    // Generated Lich rig. Tripo bipeds face +X, while character visuals face
    // +Z at world facing 0. Jump is intentionally absent: the generic biped
    // jump distorted this winged silhouette, so airborne frames use Idle plus
    // the controlled procedural wing pose in CharacterVisual.
    yaw: -Math.PI / 2,
    attackTimeScale: 6,
    deathTimeScale: 3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
  },
  // The Knucklebone of Balgath's Shape of the Foreman (combat/balgath_trinkets.ts): the
  // Mirefen world boss's own body at a head above a player rather than raid-boss sized,
  // since twenty of them can stand in one pull. Built by the same Blender factory as the
  // boss (scripts/assets/balgath_cyclops/form.py): a quarter of his triangles and his own
  // rig, with clips of its OWN for the gaits. The boss's walk and run are a giant's lumber,
  // timed for 4 and 8 yards a second at thirteen yards tall; at a player's size and a
  // player's 7 yd/s those cycles had to be driven near four times over to keep up, which
  // reads as legs whirring in place. The form's Walk and Run are re-keyed for a
  // player-sized stride at player speed, so its legs plant. The swings, slams, glare and
  // roar are his. The eye burns like his (the same measured anchor).
  form_foreman: {
    url: `${FORMS}/balgath_form.glb`,
    authoredAtlas: true,
    height: 3.0,
    attackTimeScale: 1.35,
    // Gait refs MEASURED on this body, planted foot (node scripts/anim/measure_gait.mjs
    // <balgath_form_raw.glb> --height 3.0 --scale 1.1; FOREMAN_SHAPE_SCALE is 1.1): a
    // player's 7 yd/s run plays the cycle at 7 / 6.17 = 1.13x and a 2.5 yd/s walk at
    // 1.6x, both inside the default clamps, so no ceiling has to be lifted any more.
    walkRef: 1.56,
    runRef: 6.17,
    eyeGlow: {
      bone: 'Head',
      offset: [0, 1.22, 1.74],
      color: 0x5fe8d2,
      radius: 0.2,
      pulseHz: 0.45,
      selfLitMaterial: 'BalgathGlow',
    },
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Balgath_Swipe', 'Balgath_Punch', 'Balgath_Clobber'],
      abilityAttack: ['Balgath_Hammer', 'Balgath_Stomp', 'Balgath_Smash'],
      cast: 'Balgath_EyeFlare',
      hit: ['Hit'],
      death: 'Death',
      jump: 'Jump',
      flourish: 'Balgath_Roar',
    },
    lazyPreload: true,
  },
  form_cat: {
    url: `${CREATURES}/druid_cat_form.glb`,
    // Sized a fifth above the world wolves (mob_wolf / form_ghost_wolf are 1.6)
    // so the druid's cat reads as the bigger predator on the field.
    height: 1.92,
    clips: DRUID_CAT_FORM,
    authoredAtlas: true,
    // Measured planted-paw speeds at height 1.1 (tests/druid_cat_asset.test.ts),
    // scaled by 1.92/1.1 with the height; clip durations retain a slower walk.
    walkRef: 2.78992,
    walkBackRef: 4.82101,
    runRef: 9.13075,
    prowlRef: 5.47846,
    gait: { runEnter: 3.2, runExit: 2.6 },
    // Scaled with the body: a 1.92 cat at the slowed-run band (3.2 yd/s over a
    // 9.13 ref) sits at .35, so the floor drops to .3 to keep the feet matched.
    runTimeScaleMin: 0.3,
    swimRise: { stroke: 0.21, tread: 0.21 },
    swimHeadHeight: 1.74,
    attackTimeScale: 1,
    deathTimeScale: 1,
  },
  // Shaman Shadewolf retains the original wolf, tint and ghost-material overlay.
  form_ghost_wolf: {
    url: `${CREATURES}/wolf_basic.glb`,
    height: 1.6,
    clips: WOLF_BAKED,
    tint: 0xd08b45,
    tintStrength: 0.35,
  },
  // Druid Travel Form: a daft chicken-cow hybrid (custom GLB). No tint: its
  // authored cow-spots/comb/beak colours carry the look.
  form_travel: {
    url: `${CREATURES}/chicken_cow.glb`,
    height: 2.3,
    clips: CHICKEN_COW,
  },

  // -- rideable mounts (src/sim/content/mounts.ts catalog) -------------------
  // All lazyPreload: fetched on the first sight of a mounted player
  // (preloadMountAssets in assets.ts), never in the boot sweep. Baked
  // textures, no tint. Seat heights + procedural bob live in
  // src/render/mount_visuals.ts. Heights are deliberately imposing (a mount
  // should tower over the 2.6 humanoid the way a horse towers over a person);
  // walkRef/runRef foot-match each model's Walk/Run cycle cadence (baked or
  // authored) to mounted ground speed.
  // The horse ships AUTHORED gait clips (Idle/Walk/Run baked from the source
  // model's own animation set, Sleep repurposed as Death), not the procedural
  // bake_mount_gaits.mjs cycles the Tripo mounts carry; walkRef/runRef are
  // re-matched to its 1.03s walk / 0.40s gallop cadence.
  mount_valorsteed: {
    url: `${MOUNTS_DIR}/valorsteed.glb`,
    height: 3.8,
    clips: MOUNT_RIGGED,
    walkRef: 2.3,
    runRef: 12,
    lazyPreload: true,
  },
  mount_grag_bear: {
    url: `${MOUNTS_DIR}/grag_bear.glb`,
    height: 4.0,
    clips: MOUNT_RIGGED,
    walkRef: 2.6,
    runRef: 9,
    lazyPreload: true,
  },
  mount_stalkglider_snail: {
    url: `${MOUNTS_DIR}/stalkglider_snail.glb`,
    height: 3.1,
    clips: MOUNT_RIGGED,
    lazyPreload: true,
  },
  mount_aether_hover_cycle: {
    url: `${MOUNTS_DIR}/aether_hover_cycle.glb`,
    height: 2.3,
    clips: MOUNT_RIGGED,
    hover: 0.6,
    lazyPreload: true,
  },
  mount_shadowjump_toad: {
    url: `${MOUNTS_DIR}/shadowjump_toad.glb`,
    height: 3.2,
    clips: MOUNT_RIGGED,
    walkRef: 2.6,
    runRef: 9,
    lazyPreload: true,
  },
  mount_stormfeather_griffin: {
    url: `${MOUNTS_DIR}/stormfeather_griffin.glb`,
    height: 4.1,
    clips: MOUNT_RIGGED,
    walkRef: 2.6,
    runRef: 9,
    lazyPreload: true,
  },
  // Epic world-boss turkey: one authored strut cycle serves as BOTH Walk and
  // Run (plus a baked breathing Idle), so the run reference is deliberately
  // low; at full mounted speed the strut plays fast, which is the joke.
  mount_thunderstrut_gobbler: {
    url: `${MOUNTS_DIR}/thunderstrut_gobbler.glb`,
    height: 3.5,
    clips: MOUNT_RIGGED,
    walkRef: 1.8,
    runRef: 4.5,
    lazyPreload: true,
  },
  // Goblin Rocket Sled: clipless rigid vehicle. Runtime exhaust and motion live
  // in its mount-owned render controller, never in a baked idle animation.
  mount_goblin_rocket_sled: {
    url: `${MOUNTS_DIR}/goblin_rocket_sled.glb`,
    height: 2.5,
    clips: MOUNT_RIGGED,
    authoredAtlas: true,
    lazyPreload: true,
  },
  // Toy rally car. Rigid node animation, no skin: the wheels, the four
  // independent springs and the body all move as separate nodes.
  // Wheel rate is authored at 14.93 deg/frame against 9 spokes, so playback
  // past ~1.34x makes the wheels strobe backwards; raise the clip's spoke
  // count rather than dropping runRef past that.
  mount_rallycart_rxt: {
    url: `${MOUNTS_DIR}/rallycart_rxt.glb`,
    // 3.1 was the rider-fit solve; three tuning passes in game took it down
    // 7.5%, 7.5% and 10% from there. `seat` and `seatFwd` in mount_visuals.ts
    // are ABSOLUTE world units, so they are scaled by the same 0.771 and must
    // move together with any further change here.
    height: 2.39,
    // A car has ONE forward gait, so both bands play Run and the cadence is
    // separated by walkRef/runRef. It reverses and jumps for real, and it has
    // no death clip, so death holds the idle.
    clips: {
      idle: 'Idle',
      walk: 'Run',
      run: 'Run',
      walkBack: 'WalkBackward',
      jump: 'Jump',
      attack: [],
      death: 'Idle',
    },
    walkRef: 3,
    runRef: 4.4,
    authoredAtlas: true,
    // Wheels stop when the car stops, rather than turning on through a fade.
    cutToIdle: true,
    lazyPreload: true,
  },
  // The Lanternback Troll: a hand-authored rig (troll body skinned, the iron
  // throne and both lanterns each welded rigid to a single bone) with authored
  // Idle/Walk/Run/Death clips. runRef is deliberately the RIDDEN speed
  // (RUN_SPEED 7 x +80% = 12.6), the same call the Drakemaw Raptor makes above:
  // his stride is a long loose lope, and foot-matching a 3.4yd stride to 12.6
  // yd/s would play the cycle at 3.7 strides/sec, which reads as a wind-up toy
  // on a mount this heavy. At 12.6 the timeScale lands on 1.0 and he lopes at
  // the authored 2.5 steps/sec.
  mount_lanternback_troll: {
    url: `${MOUNTS_DIR}/lanternback_troll.glb`,
    // 7.0 makes him the tallest thing in the stable by a distance (the griffin
    // is 4.1), which is the point: he is a hill troll wearing a throne, and at
    // 5.0 he read as merely large rather than as something you would strap a
    // chair to. walkRef scales with him, since a bigger creature covers more
    // ground per stride and would otherwise scurry.
    height: 7.0,
    clips: MOUNT_RIGGED,
    walkRef: 5.6,
    runRef: 12.6,
    lazyPreload: true,
  },
  // The Chimeglass Tortoise. Low and broad: 3.6 puts the crown of his shell
  // near a horse's saddle without pretending he is horse-shaped.
  //
  // walkRef/runRef are a CADENCE choice, not a foot match, and the gap is not
  // small: say so plainly rather than calling it a slide. His legs rest 99.6%
  // extended, so the reach envelope caps his stride at 0.092 model units, about
  // 0.33yd here. At a mounted 12.6 yd/s (RUN_SPEED 7 x +80%) a true foot match
  // would need ~38 strides/sec. Nothing recovers that, so his feet carry only
  // ~5% of the ground he covers and the refs buy a readable gait instead.
  //
  // The numbers are picked to land INSIDE locomotionTimeScale's clamp rather
  // than against it: run clamps to [0.6, 1.6] and walk to [0.6, 1.8], so any
  // runRef at or under 7.9 would saturate at 1.6 and every value in that range
  // would render identically. 10 gives 1.26 (about 1.7 strides/sec), brisk for
  // a tortoise without reading as a wind-up toy.
  mount_chimeglass_tortoise: {
    url: `${MOUNTS_DIR}/chimeglass_tortoise.glb`,
    height: 3.6,
    clips: MOUNT_TORTOISE,
    walkRef: 3.6,
    runRef: 10,
    lazyPreload: true,
  },
  // Compact fantasy tank. One wheel revolution per locomotion clip matches
  // its authored tread cadence at the reference ground speeds below.
  mount_terrorspark_groundshaker: {
    url: `${MOUNTS_DIR}/terrorspark_groundshaker.glb`,
    height: 2.8,
    clips: MOUNT_RIGGED,
    walkRef: 3,
    runRef: 4.4,
    lazyPreload: true,
  },
  // The Drakemaw Raptor (broodlord legendary drop): saddle-broken Tripo biped,
  // gait-baked by scripts/bake_mount_gaits.mjs like the bear/toad/griffin. The
  // imported source clips drove Hip TRANSLATION half a model unit off the bind
  // pose (baked-in root motion), which at this height threw the body clear of
  // the saddle and lurched it every stride; the baker authors rotation-only
  // keys plus a root Y bob, so that cannot recur. walkRef is MEASURED off the
  // baked clip (tmp/dragonkin_gait_measure.mjs): walk 3.02 yd/s.
  mount_drakemaw_raptor: {
    url: `${MOUNTS_DIR}/drakemaw_raptor.glb`,
    height: 3.4,
    clips: MOUNT_RIGGED,
    walkRef: 3.0,
    // runRef is deliberately the RIDDEN speed (RUN_SPEED 7 x +80% = 12.6), not
    // the Run clip's measured 9.04 yd/s, so timeScale lands on exactly 1.0 and
    // the clip plays at its authored 2.0 strides/sec (6.3 yd per bound).
    // Foot-matching instead (runRef 9.04) gives timeScale 1.48 and a 2.96/sec
    // cadence, which read as badly sped up on a 3.4 yd mount. That is the real
    // tradeoff on this rig: under a perfect foot match, cadence is
    // bodySpeed / (2 x stride x normScale) and so depends only on stride
    // LENGTH, never on clip duration, which timeScale rescales away. Short legs
    // therefore can only buy a calm cadence with slide. This costs 28%, well
    // inside what the other baked mounts already ship (grag_bear's 3.58 yd/s
    // natural against the same 12.6 leaves it sliding over half its travel).
    runRef: 12.6,
    lazyPreload: true,
  },
  // Tall two-legged fantasy bird authored on its own avian skeleton. The
  // source faces -X, so +90 degrees maps its beak to the renderer's +Z
  // facing convention. Forward movement intentionally uses Run for both
  // locomotion bands: this mount never presents a walking forward gait.
  mount_avian_strider: {
    url: `${MOUNTS_DIR}/avian_strider.glb`,
    height: 4.32,
    yaw: Math.PI / 2,
    // Baked Tripo atlas: the low-tier uniform emissive floor would grey out
    // every dark texel of the plumage, so scale the floor by the atlas.
    authoredAtlas: true,
    clips: AVIAN_MOUNT_RIGGED,
    // Cadence, tuned by eye. A mounted rider moves at ONE speed, so both time
    // scales are constants: forward is RUN_SPEED 7 * (1 + moveSpeedPct 0.8) =
    // 12.6 yd/s, reverse is that * BACKPEDAL_MULT 0.65 = 8.19. That makes the
    // refs below exact dials rather than speed-matching curves.
    //
    //   reverse  8.19 / walkRef 5.52 = 1.484
    //   forward 12.6  / runRef  7.16 = 1.760
    //
    // walkRef is the only reference walkBack reads; it is shared with the
    // forward walk band, which this mount only enters when slowed below the
    // run threshold. History: 4.5 -> 6.0 -> 6.67 -> 5.80 -> 5.52.
    walkRef: 5.52,
    // 12.6 -> 10.5 -> 8.4 -> 7.64 -> 7.28 -> 7.16, cumulatively 76% up on the
    // authored cadence. The stock 1.6 run ceiling silently bound this from
    // 7.64 down (7.64 and 7.28 both resolved to 1.6, so the second change did
    // nothing), hence the raised ceilings below.
    runRef: 7.16,
    // Raised from the stock 1.8/1.6 so the refs above stay live. The authored
    // gaits were built for a calmer bird than the one the sim actually moves,
    // and clamping at stock turns further tuning into a dead knob rather than
    // a slower mount. 2.0 leaves room to keep dialing before the clip itself
    // needs re-timing at the source.
    walkTimeScaleMax: 2.0,
    runTimeScaleMax: 2.0,
    // Opted in BECAUSE of the pushed cadence above: at 1.76 the outgoing run
    // otherwise keeps sprinting for the whole 0.22s crossfade while the body
    // has already stopped, and the harder the gait is driven the worse that
    // exit reads. No other rig is affected.
    gaitWindDown: true,
    lazyPreload: true,
  },

  // The Cluckwork Mech Bird (the store mount): authored Blender clips on its
  // own 28-bone rig (no bake_mount_gaits entry, never bake over it). walkRef
  // is the Run cycle's measured natural speed (stride 0.332 raw p2p, 0.433s
  // cycle, height 3.4 over rawHeight 1.0 = 5.2 yd/s), so walking plays near
  // the authored look. runRef follows the drakemaw precedent above: the
  // RIDDEN speed (RUN_SPEED 7 x +75% = 12.25) so timeScale lands on 1.0 and
  // the servo sprint keeps its authored cadence; the slide this trades away
  // sits between the drakemaw's 28% and grag_bear's half-travel, and the
  // 1-2-1 mount_run gait beat carries the footfall read.
  mount_mech_bird: {
    url: `${MOUNTS_DIR}/mech_bird.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 3.4,
    clips: MOUNT_MECH_BIRD,
    walkRef: 5.2,
    runRef: 12.25,
    lazyPreload: true,
  },
  // Developer-only Halloween cart (image-to-glb static prop, no clips of its
  // own): height is the measured shipped bbox (npx gltf-transform inspect).
  // The puller is a SEPARATE visual (skel_rickshaw_puller) composed at
  // runtime by src/render/rickshaw_mount.ts, not baked into this GLB.
  mount_rickshaw_mount: {
    url: `${MOUNTS_DIR}/rickshaw_mount.glb`,
    // MUST match the shipped GLB's measured bbox height exactly (npx
    // gltf-transform inspect): prepareVisual's normScale = height /
    // measuredHeight, so a stale value here silently RESCALES the whole
    // model to compensate. A canopy-raise once landed with almost no visible
    // effect in-game because this field was left stale through two geometry
    // changes, quietly shrinking the whole mount to compensate; the canopy
    // was later cut entirely (floating/unmounted, unconnected wheel spokes),
    // dropping the real height back down. Re-measure after any geometry
    // change to this GLB.
    // Re-measured off the shipped GLB after this pass's geometry work (arched
    // seat back, trimmed throne wings, harness collar, lantern rebuild): 2.8 was
    // stale and was silently rescaling the whole cart.
    height: 4.779,
    // This GLB ships NO clips: the wheels are spun procedurally by
    // rickshaw_mount.ts's spinMountWheels, because crossfading a spin clip out drags the wheel back
    // toward its bind rotation and reads as backwards spin on every stop (full
    // history in scripts/assets/rickshaw_mount/model.js, above WHEEL_NODES).
    // MOUNT_RIGGED's names therefore resolve to nothing, which is already a
    // no-op: visual.ts registers actions only for clips that exist.
    clips: MOUNT_RIGGED,
    lazyPreload: true,
  },

  // Ambient Highwatch stable horse (sim mob 'stable_horse', MOB_KEYS below). Reuses
  // the Valorsteed GLB + its authored gait clips so it renders and ambles as a real
  // horse through the STANDARD mob-visual path, never a humanoid capsule. Unlike the
  // rider mounts this is NOT lazyPreload: a mob body is built synchronously by
  // createCharacterVisual (which throws on a not-yet-fetched asset), so it must be
  // in the boot sweep. Shorter than the imposing 3.8 ridden Valorsteed so loose
  // paddock horses read at a natural size; no tint (authored colours).
  mob_stable_horse: {
    url: `${MOUNTS_DIR}/valorsteed.glb`,
    height: 2.9,
    clips: MOUNT_RIGGED,
    walkRef: 2.3,
    runRef: 12,
  },

  // -- mob families --------------------------------------------------------
  mob_wolf: {
    // Custom Tripo wolf auto-rigged onto the Dog_Animation quadruped skeleton
    // (same pipeline as greyjaw), clips renamed to the animal() names at bake
    // time. Baked basecolor texture; keeps a light entity tint so this doubles
    // as the beast-family fallback and each beast keeps its own colour.
    url: `${CREATURES}/wolf_basic.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 1.6,
    clips: WOLF_BAKED,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // The Gleamfolk pixie villager (Veiled Hollow): Tripo biped from the user's
  // game-style concept, auto-rigged, clips renamed to the game vocabulary at
  // bake time. A light entity tint gives individual villagers variety.
  mob_mushroom_pixie: {
    url: `${CREATURES}/mushroom_pixie.glb`,
    height: HUMANOID_H, // villagers stand player-height, cap and all
    // The Tripo rig rests facing +x; yaw swings the model onto the game's
    // +z-forward convention so walking and combat face the right way.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      jump: 'Jump',
    },
    tint: 'entity',
    tintStrength: 0.2,
  },
  greyjaw: {
    // Custom Tripo wolf auto-rigged onto the Dog_Animation quadruped skeleton;
    // clips renamed to the animal() names at bake time. Baked texture, no tint.
    // Old Greyjaw's model: 2.2 at scale 1 (his template scale 1.25 makes the
    // rare ~2.75 in-world vs the 1.6 pack wolf).
    url: `${CREATURES}/greyjaw.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.2,
    clips: GREYJAW_WOLF,
    // Greyjaw_Attack clip donor (scripts/build_greyjaw_anims.mjs): mesh-free,
    // baked off this same rig's own poses (a howl-then-pounce, distinct from
    // the plain Attack every other WOLF_BAKED user still plays).
    animUrls: [`${CREATURES}/greyjaw_ability_anims.glb`],
  },
  mob_boar: {
    url: `${CREATURES}/wild_boar.glb`,
    height: 1.45,
    clips: WILD_BOAR,
    tint: 'entity',
    tintStrength: 0.4,
  },
  // Quaternius animal rig (shares clip names with wolf) — fox/deer/critters that
  // would otherwise fall back to mob_wolf via FAMILY_KEYS['beast'].
  mob_fox: {
    url: `${CREATURES}/fox.glb`,
    height: 1.0,
    clips: animal(['Attack']),
    tint: 'entity',
    tintStrength: 0.35,
  },
  // smaller silhouette of the same rig for ground critters (hares, badgers);
  // no dedicated rabbit/mustelid asset ships, so this is the closest small beast.
  mob_critter: {
    url: `${CREATURES}/fox.glb`,
    height: 0.7,
    clips: animal(['Attack']),
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Cosmetic followers: each active buddy keeps its authored rig and colors.
  buddy_horse: {
    url: `${BUDDIES_DIR}/horse.glb`,
    height: 0.75,
    clips: BUDDY_CLIPS,
  },
  buddy_crystal_lich: {
    url: `${BUDDIES_DIR}/crystal_lich.glb`,
    height: 0.9,
    clips: BUDDY_CLIPS,
  },
  buddy_forgemaw: {
    url: `${BUDDIES_DIR}/forgemaw.glb`,
    height: 0.85,
    clips: BUDDY_CLIPS,
    // The rig is authored facing -Z, so without this it heels the owner
    // back-to-front: chest toward the camera while its owner walks away.
    yaw: Math.PI,
  },
  // Yumi, the Protect Yumi objective cat familiar (Meshy rig, scale baked by
  // scripts/_bake_meshy_scale.mjs, meshopt + 1024 webp). The GLB ships ONE
  // clip, the block: mapped as the HIT reaction so she blocks when struck
  // (playHit rides every landed damage event). No idle/walk clips on
  // purpose: the objective never moves on its own, and baseAction falls back
  // to the authored rest pose when a slot's clip is absent. Painted texture,
  // so no entity tint.
  mob_yumi_cat: {
    url: `${CREATURES}/yumi_cat.glb`,
    height: HUMANOID_H * 1.2, // the objective reads over player heads
    clips: {
      idle: 'None',
      walk: 'None',
      run: 'None',
      attack: [],
      death: 'None',
      hit: ['Armature|Block5|baselayer'],
    },
  },
  mob_stag: {
    url: `${CREATURES}/stag.glb`,
    height: 1.9,
    // Attack_Kick, not 'Attack': the rig ships no clip by that name, so every
    // second swing in the rotation resolved to nothing and played no animation
    // at all (the repainted siblings below always had it right).
    // Own bespoke charge attack (scripts/build_stag_anims.mjs, issue #2889):
    // spread the animal() factory result and override only attack, so the
    // repainted siblings (veiled_stag/gleamstag/veiled_doe/aurelhorn, separate
    // GLB files on the same rig) keep the standing Headbutt/Kick pair.
    clips: { ...animal(['Attack_Headbutt', 'Attack_Kick']), attack: ['Stag_Attack_Charge'] },
    animUrls: [`${CREATURES}/stag_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.35,
  },
  // the Veiled Hollow stags: the shipped stag rig repainted to the approved
  // concepts (tmp/make_hollow_stags.mjs): dusk coats baked into the materials
  // and the antlers split onto their own emissive amethyst material, so no
  // entity tint (a wash would muddy the baked palette and the antler glow)
  mob_veiled_stag: {
    url: `${CREATURES}/veiled_stag.glb`,
    height: 1.9,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  mob_gleamstag: {
    url: `${CREATURES}/gleamstag.glb`,
    height: 1.9,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  // the does: the same rig with the antler mesh removed and a softer coat
  mob_veiled_doe: {
    url: `${CREATURES}/veiled_doe.glb`,
    height: 1.6,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  // Aurelhorn keeps the bull's bulk (height) but joins the herd's species:
  // the same repainted stag rig in the patriarch's gold
  mob_aurelhorn: {
    url: `${CREATURES}/aurelhorn.glb`,
    height: 2.1,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  // Training dummy: the immortal practice target (zone3.ts training_dummy,
  // hpBase 999999, no drops). Custom Tripo humanoid auto-rigged onto the
  // biped skeleton, KAYKIT_CLIP_PLAN vocabulary. The dummy never casts or
  // jumps (sim's dummy handling holds it stationary and ability-less), so
  // those two clips are stripped from the shipped GLB rather than carried as
  // dead weight. Shared by the whole Highwatch practice row and the Eastbrook
  // hub dummy (MOB_VISUALS below points all four dummy templates here): two
  // fixed spots in the whole world, so it stays lazy-preloaded (fetched on
  // first sight, renderer.ts) rather than joining every client's eager boot set.
  mob_training_dummy: {
    url: `${CREATURES}/training_dummy.glb`,
    height: 2.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
    },
    lazyPreload: true,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Deepfen Spearjaw (The Drowned Litany): unused Quaternius raptor rig, a
  // toothy quadruped that reads far more like a swamp predator than the
  // generic wolf fallback (docs/prd/drowned-litany-asset-generation-plan.md).
  mob_spearjaw: {
    url: `${CREATURES}/velociraptor.glb`,
    height: 1.8,
    clips: VELOCIRAPTOR,
    tint: 'entity',
    tintStrength: 0.3,
  },
  // brown-tinted yeti rig, same recipe as the druid Bear form.
  mob_bear: {
    url: `${CREATURES}/yetialt.glb`,
    // Bear_Attack clip donor (scripts/build_bear_anims.mjs): mesh-free,
    // baked off this same rig's own poses.
    animUrls: [`${CREATURES}/yetialt_hit_variety_anims.glb`, `${CREATURES}/bear_ability_anims.glb`],
    height: 2.2,
    clips: BEAR_BIPED14,
    tint: 0x5a4030,
    tintStrength: 0.5,
  },
  // the same rig worn honestly: an ice-white yeti for the Frostveil
  mob_yeti: {
    url: `${CREATURES}/yetialt.glb`,
    height: 2.5,
    clips: YETI_BIPED14,
    // Yeti_Attack clip donor (scripts/build_yeti_anims.mjs): mesh-free,
    // baked off this same rig's own poses. Loads alongside the hit-variety
    // donor GLB below; both are mesh-free so their clips just merge in.
    animUrls: [`${CREATURES}/yetialt_hit_variety_anims.glb`, `${CREATURES}/yeti_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.55,
  },
  mob_spider: {
    url: `${CREATURES}/spider.glb`,
    height: 1.4,
    clips: SPIDER,
    tint: 'entity',
    tintStrength: 0.35,
  },
  mob_murloc: {
    url: `${CREATURES}/frog.glb`,
    height: 1.7,
    clips: MURLOC_BIPED14,
    // Murloc_Attack clip donor (scripts/build_murloc_anims.mjs): mesh-free,
    // baked off this same rig's own poses. Loads alongside the hit-variety
    // donor GLB below; both are mesh-free so their clips just merge in.
    animUrls: [`${CREATURES}/frog_hit_variety_anims.glb`, `${CREATURES}/murloc_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.45,
  },
  mob_kobold: {
    url: `${CREATURES}/goblin.glb`,
    height: 2.1,
    animUrls: [
      `${CREATURES}/goblin_hit_variety_anims.glb`,
      `${CREATURES}/kobold_ability_anims.glb`,
    ],
    clips: KOBOLD_ENEMY7,
    tint: 'entity',
    tintStrength: 0.2, // keep the green readable
  },
  // The Mirefen Marsh rare, replacing his stand-in generic-troll body. Only
  // the `grubjaw` template maps here (MOB_KEYS below), so every other troll
  // keeps mob_troll. Gait refs measured (tmp/dragonkin_gait_measure.mjs) at
  // his template scale 2.275: walk 4.36 (wander 2.63 -> 0.60x, exactly at the
  // clamp floor, which is why the build slows his Walk clip) and run 10.94
  // (chase 7.5 -> 0.69x). Both inside the matcher's clamps, so the feet plant.
  mob_grubjaw: {
    url: `${CREATURES}/grubjaw.glb`,
    height: 2.9,
    clips: GRUBJAW,
    walkRef: 4.36,
    runRef: 10.94,
    // Barely-there wash. mob_troll tints 0.12 toward its template's BRIGHT
    // green, which is what makes a stock Mirefen Troll pop; Grubjaw's own
    // template colour is a dark 0x145a32, so the same strength only muddied
    // his authored olive hide and read as near-black beside them.
    tint: 'entity',
    tintStrength: 0.04,
  },
  // The authored kobold body (the Kolbolds v02 artist drop, combined by
  // tmp/kobold_build.mjs). Zone 1's Deeprock Diggers and their Tunnelking ONLY:
  // the `burrower` family default deliberately stays mob_kobold (goblin.glb),
  // because the other ten burrowers on it are sprites, gnomes and wretches that
  // would every one of them read as a giant rat.
  //
  // `clips` is KOBOLD_DIGGER (ENEMY7 with the hit slot narrowed to the native
  // HitRecieve): the GLB carries Idle/Walk/Run/Attack/HitRecieve/Death, so
  // this needs neither the KOBOLD_ENEMY7 attack override nor
  // kobold_ability_anims.glb. That donor is deliberately NOT in animUrls, and
  // this is the trap worth naming: prepareVisual fills its clip map from the
  // base GLB and THEN lets every animUrls entry overwrite BY NAME, so listing it
  // would silently replace this model's authored Attack with the synthesized
  // Kobold_Pounce baked off goblin.glb's poses. goblin_hit_variety_anims.glb
  // used to ride along for HitRecieve_Heavy, but its tracks target the goblin
  // rig and this drop is mixamorig-boned, so the clip bound nothing and froze
  // the rig mid-pose on half of all hit reactions (see the KOBOLD_DIGGER
  // constant); it was removed rather than kept for a clip that cannot play.
  //
  // walkRef/runRef are MEASURED off the clips themselves
  // (tmp/kobold_gait_measure.mjs) at tunnel_rat's 0.85 template scale, the
  // dominant population by 14 spawns to 1: natural 1.23 and 2.51 yd/s on the v02
  // body. Left on the 2.2/7 defaults, a 7 yd/s chase runs the cycle at 1.0x and
  // the planted foot trails the body 2.8x; measured, the run pushes to its 1.6
  // clamp and the walk lands near an exact foot match. Re-measure on any new
  // drop: v01's cycles gave 1.31/2.22, and its Walk was 1.00s against v02's 1.13s.
  mob_kobold_digger: {
    url: `${CREATURES}/kobold.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.1,
    clips: KOBOLD_DIGGER,
    // The mid-idle pose drops the tail 0.23 units (at scale 1) below the foot
    // plane, and the ground anchor is the lowest skinned vertex, so the body
    // floated by exactly that much (measured live: foot bones 0.227 above
    // ground). Sink it back so the feet plant and the tail tip drags.
    hover: -0.2,
    walkRef: 1.23,
    runRef: 2.51,
    // Light wash, for grubjaw's reason above: the drop ships an authored brown
    // hide, and the goblin body's 0.2 (sized to keep a GREEN skin readable) only
    // muddies it.
    tint: 'entity',
    tintStrength: 0.12,
  },
  // Grix the Tunnelking: his own body at last. He was the clearest case of the
  // gap this batch closes, a rare ELITE rendering identically to the level-4
  // Deeprock Diggers he summons, with only the rare/elite nameplate frame to
  // tell a player which one was the boss.
  //
  // The GLB carries a bone-parented PROP: his shovel is a child of
  // mixamorigRightHand, not a skinned part, so it rides the hand through every
  // clip with no track of its own. That also means two materials (body, shovel),
  // each with its own basecolor, which is why tmp/grix_build.mjs supplies them
  // per material instead of through the single-texture path the kobolds use.
  //
  // No `tint`, deliberately, even though his template DOES carry a colour
  // (0xb9770e in zone1.ts). On the shared goblin/kobold bodies the entity tint is
  // what separates one template from the next; Grix is a one-off with authored
  // art (crown, robes, the shovel) and washing an amber over it only muddies it.
  // His template colour still earns its keep elsewhere: the minimap/nameplate
  // surfaces read it. Same reasoning as mob_water_elemental's untinted body.
  //
  // walkRef/runRef MEASURED (tmp/grix_gait_measure.mjs) at his template scale of
  // 1.0: natural 1.23 and 2.31 yd/s against a 7 yd/s chase.
  mob_grix: {
    url: `${CREATURES}/grix.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.1,
    clips: GRIX,
    // Same dragging-tail float as mob_kobold_digger, smaller: mid-idle his
    // tail dips 0.09 units (at scale 1) below the foot plane (measured live:
    // foot bones 0.093 above ground at his 1.275 template scale).
    hover: -0.07,
    walkRef: 1.23,
    runRef: 2.31,
    // The authored Attack is a 1.5s double-pump heave whose contact frame
    // sits at ~0.7 of the clip (measured by hand-height scrub), and mob melee
    // one-shots fire ON the damage event: at the 1.3 default the shovel
    // visibly landed ~0.8s AFTER the health bar moved. 3x brings contact to
    // ~0.35s after the hit and the whole swing to 0.5s, inside his 2.0s
    // swing cadence (the mob_gravewing tuning pattern).
    attackTimeScale: 3,
  },
  mob_troll: {
    url: `${CREATURES}/orc.glb`,
    height: 2.4,
    // faint wash only — 0.35 flooded every material with the template green
    clips: TROLL_BIPED14,
    // Troll_Smash clip donor (scripts/build_troll_anims.mjs): mesh-free,
    // baked off this same rig's own poses. The second donor GLB
    // (scripts/build_biped14_hit_variety_anims.mjs) donates the second
    // BIPED14 hit-reaction clip, HitReact_Heavy.
    animUrls: [`${CREATURES}/troll_ability_anims.glb`, `${CREATURES}/orc_hit_variety_anims.glb`],
    tint: 'entity',
    tintStrength: 0.12,
  },
  // The authored ogre body (the _Mob_Updates artist drop, combined by
  // tmp/ogre_build.mjs), replacing the 2023-pack giant.glb stick rig the
  // whole family rendered as. Gait refs measured (tmp/ogre_gait_measure.mjs)
  // at the dominant template scale 1.3 (thornpeak_ogre / ogre_crusher /
  // rift_stone_ogre; the kobold_digger dominant-population precedent): Walk
  // natural 2.79 yd/s, and the authored Run cycle measured 4.83, a 1.45x
  // ask against the family's 7.0 chase, so the build retimes it 1.21x in
  // place (a 0.60s heavy sprint cadence), natural 5.84, and the chase runs
  // at ~1.2x with clamp headroom instead of at the 1.6 edge.
  mob_ogre: {
    url: `${CREATURES}/ogre.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.8,
    clips: OGRE,
    walkRef: 2.79,
    runRef: 5.84,
    // Light wash, the kobold_digger reason: the drop ships an authored brown
    // hide, and the old 0.2 (sized to keep the giant's flat atlas readable)
    // would only muddy it. Entity tint still separates the family's mobs.
    tint: 'entity',
    tintStrength: 0.12,
  },
  // Warlord Drogmar, the ogre family's quest boss. His own body rather than the
  // family's mob_ogre fallback: he is a named kill objective fought up close, so
  // the atlas ships at full 1024 (no maxTex clamp in specs/drogmar.json) where
  // the trash ogres clamp to 512.
  //
  // Gait refs are the drop's own MEASURED natural speeds at this height and his
  // content scale of 1.5 (tmp/drogmar_v02_gait.mjs): Walk 1.37s/stride 37.6u ->
  // 2.65 yd/s, Run 0.80s/stride 41.1u -> 4.95 yd/s. Declared as measured rather
  // than retimed to the family's numbers, which is what makes the foot match
  // exact: his moveSpeed 7 chase lands at timeScale 1.41, inside the 1.6 run
  // clamp with headroom to spare.
  mob_drogmar: {
    url: `${CREATURES}/drogmar.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.8,
    clips: DROGMAR,
    walkRef: 2.65,
    runRef: 4.95,
    // Same light wash as mob_ogre and for its reason: the drop ships an authored
    // hide, so a heavy tint would only muddy it. Entity tint still separates him
    // from the Crushers he leads.
    tint: 'entity',
    tintStrength: 0.12,
  },
  // Five Wildheart troll silhouettes use the same complete biped vocabulary,
  // but preserve their woven cloth, bone paint, feathers, and jungle palette.
  mob_wildheart_stalker: {
    url: `${CREATURES}/wildheart_stalker.glb`,
    // Wildheart_Stalker_Attack clip donor (scripts/build_wildheart_stalker_anims.mjs):
    // mesh-free, baked off this same rig's own poses.
    animUrls: [
      `${CREATURES}/wildheart_stalker_hit_variety_anims.glb`,
      `${CREATURES}/wildheart_stalker_ability_anims.glb`,
    ],
    height: 2.5,
    yaw: -Math.PI / 2,
    clips: WILDHEART_STALKER,
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_wildheart_ravager: {
    url: `${CREATURES}/wildheart_ravager.glb`,
    // Wildheart_Ravager_Attack clip donor (scripts/build_wildheart_ravager_anims.mjs):
    // mesh-free, baked off this same rig's own poses.
    animUrls: [
      `${CREATURES}/wildheart_ravager_hit_variety_anims.glb`,
      `${CREATURES}/wildheart_ravager_ability_anims.glb`,
    ],
    height: 2.7,
    yaw: -Math.PI / 2,
    clips: WILDHEART_RAVAGER,
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_wildheart_hexcaller: {
    url: `${CREATURES}/wildheart_hexcaller.glb`,
    // Wildheart_Hexcaller_Attack clip donor (scripts/build_wildheart_hexcaller_anims.mjs):
    // mesh-free, baked off this same rig's own poses.
    animUrls: [
      `${CREATURES}/wildheart_hexcaller_hit_variety_anims.glb`,
      `${CREATURES}/wildheart_hexcaller_ability_anims.glb`,
    ],
    height: 2.5,
    yaw: -Math.PI / 2,
    clips: WILDHEART_HEXCALLER,
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_wildheart_beastmaster: {
    url: `${CREATURES}/wildheart_beastmaster.glb`,
    animUrls: [`${CREATURES}/wildheart_beastmaster_hit_variety_anims.glb`],
    height: 3,
    yaw: -Math.PI / 2,
    clips: TRIPO_BIPED_FULL_RIG,
    tint: 'entity',
    tintStrength: 0.03,
  },
  mob_wildheart_high_priest: {
    url: `${CREATURES}/wildheart_high_priest.glb`,
    // Wildheart_High_Priest_Attack clip donor
    // (scripts/build_wildheart_high_priest_anims.mjs): mesh-free, baked off this same
    // rig's own poses.
    animUrls: [
      `${CREATURES}/wildheart_high_priest_hit_variety_anims.glb`,
      `${CREATURES}/wildheart_high_priest_ability_anims.glb`,
    ],
    height: 3.2,
    yaw: -Math.PI / 2,
    clips: WILDHEART_HIGH_PRIEST,
    tint: 'entity',
    tintStrength: 0.03,
  },
  mob_elemental: {
    url: `${CREATURES}/golelingevolved.glb`,
    height: 2.2,
    hover: 0.3,
    clips: ELEMENTAL_FLOATING,
    // Elemental_Attack clip donor (scripts/build_elemental_anims.mjs):
    // mesh-free, baked off this same rig's own poses.
    animUrls: [`${CREATURES}/elemental_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.4,
  },
  mob_ignivar: {
    url: `${CREATURES}/ignivar_herald.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.65,
    // The contributor rig is authored directly onto the game's +Z-facing bind.
    yaw: 0,
    // Preserve the furnace read without the glossy HIFI treatment. The old
    // 0.2 plus an envMapIntensity boost date from the near-black arena grade;
    // under the sunset forge rig the boost read as a milky IBL sheen, so the
    // boss keeps a lower ember glow and the stock envMapIntensity of 1.
    selfIllumination: 0.14,
    // The contributor atlas ships metallicFactor 1 with a metallic-roughness
    // texture, which lays a specular sheen over the whole body under the
    // forge key light; matte keeps the albedo readable instead.
    matte: true,
    clips: IGNIVAR,
    walkRef: 1.6,
    runRef: 3.2,
    attackTimeScale: 1,
  },
  mob_ignivar_heart_of_the_end: {
    url: `${CREATURES}/ignivar_ashcaller.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 1.8,
    yaw: 0,
    selfIllumination: 0.16,
    // One of its two materials ships metallicFactor 1 plus a metallic-
    // roughness texture; matte kills that metallic response so the ash robes
    // stay diffuse under the raid rooms' key light. The old 1.3 boost here
    // was dead config: three overwrites per-material envMapIntensity with
    // scene.environmentIntensity for materials lit by scene.environment.
    matte: true,
    clips: IGNIVAR_HEART,
    attackTimeScale: 6,
    deathTimeScale: 3,
  },
  mob_ignivar_crucible_warden: {
    url: `${CREATURES}/crucible_warden.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.2,
    yaw: 0,
    // The three automata (this def and the two below) carried 0.18 plus an
    // envMapIntensity of 1.35 as a readability crutch for the near-black
    // rooms (a knob three ignores under scene.environment, see the boss defs
    // above). The sunset forge rig lights them now, so they keep only a
    // whisper of glow. Their GLBs already ship metalness 0 with no MR maps,
    // so matte here lifts the authored 0.85 roughness to 1, flattening the
    // key light's remaining dielectric highlight so the gunmetal paint reads.
    selfIllumination: 0.08,
    matte: true,
    clips: IGNIVAR_CRUCIBLE_WARDEN,
  },
  mob_ignivar_ember_sentinel: {
    url: `${CREATURES}/ember_sentinel.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.3,
    yaw: 0,
    selfIllumination: 0.08,
    matte: true,
    clips: IGNIVAR_EMBER_SENTINEL,
  },
  mob_ignivar_cinder_artificer: {
    url: `${CREATURES}/cinder_artificer.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    height: 2.1,
    yaw: 0,
    selfIllumination: 0.08,
    matte: true,
    clips: IGNIVAR_CINDER_ARTIFICER,
  },
  mob_varkhul_forgefather: {
    url: `${CREATURES}/varkhul_forgefather.glb`,
    authoredAtlas: true, // baked Tripo/contributor atlas: low-tier floor rides the map
    // 9.6u at the template's 3.2 scale: colossus-class, matching Ignivar's
    // own arena presence.
    height: 3,
    yaw: 0,
    // The authored Death lies flat with its lowest skinned vertex 16.62 raw
    // units above the feet anchor. At this 3u normalization that is 0.565u.
    deathGroundOffset: 0.565,
    // The smith atlas is near-black leather and iron; the add-tier grade
    // (0.18/1.35) reads as a silhouette in the Crucible. Match the Ignivar
    // colossus furnace grade instead so the bronze and beard stay legible.
    // The smith atlas ships metalness 0 with no MR maps at authored
    // roughness 1, which the body clamp used to pull DOWN to 0.9 gloss;
    // matte holds it at 1, and that roughness step is the visible de-sheen.
    // The old 1.6 boost was dead config (three overwrites per-material
    // envMapIntensity with scene.environmentIntensity under scene env), so
    // deleting it changes nothing on screen; the brightened room rig
    // carries legibility.
    selfIllumination: 0.22,
    matte: true,
    clips: VARKHUL_FORGEFATHER,
    // planted-foot naturals measured off the shipped clips (63.4 and 166.2
    // raw units/s at rawHeight 88.48, scaled by height 3 x mob scale 3.2)
    walkRef: 6.9,
    runRef: 18,
  },
  mob_water_elemental: {
    url: `${CREATURES}/water_elemental.glb`,
    height: 2.65,
    hover: 0.12,
    clips: WATER_ELEMENTAL,
    attackTimeScale: 1.1,
  },
  mob_gravewing: {
    url: `${CREATURES}/gravewing.glb`,
    height: 2.4,
    // Tripo's rig faces +X; character visuals face +Z at world facing 0.
    yaw: -Math.PI / 2,
    // The source Attack clip is 6.625s. Gravewing swings every 1.8s, or about
    // 1.29s with both Necromancy haste buffs, so play it in 1.10s and return
    // to locomotion before another swing can restart the full-body one-shot.
    attackTimeScale: 6,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      jump: 'Jump',
    },
  },
  mob_dragonkin: {
    url: `${CREATURES}/dragonevolved.glb`,
    height: 2.4,
    hover: 0.25,
    // light tint only — heavy washes crush the wyrm to black under the green
    // sanctum torchlight
    clips: DRAGONKIN_FLOATING,
    // Dragonkin_Attack clip donor (scripts/build_dragonkin_anims.mjs):
    // mesh-free, baked off this same rig's own poses.
    animUrls: [`${CREATURES}/dragonkin_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.2,
  },
  // --- The Drakelands dragonkin brood (v0.35 rework) ---------------------
  // Tripo sculpts on the 25-bone mixamorig core with artist-authored clips,
  // baked by tmp/dragonkin_build.mjs. The brood replaces the old floating
  // dragonevolved wyrm ONLY in the Drakelands (per-template MOB_KEYS
  // overrides below); the other dragonkin-family mobs keep the family
  // fallback above.
  // The gait references below are MEASURED, not guessed
  // (tmp/dragonkin_gait_measure.mjs): ref = the clip's own natural world
  // speed, 2 x stride x normScale x entityScale / duration, which is exactly
  // what locomotionTimeScale divides the body speed by. They are per-DEF and
  // scale-dependent, which is why the matriarch has her own def below rather
  // than sharing the broodlord's: at scale 2.85 her stride covers 33% more
  // ground per cycle, and reusing the lord's refs over-strode her by 25%.
  mob_dragonkin_broodlord: {
    url: `${CREATURES}/dragonkin_elite.glb`,
    authoredAtlas: true, // baked Tripo atlas: low-tier floor rides the map
    height: 2.6,
    clips: DRAGONKIN_BROODLORD,
    // scale 2.25: walk 4.24 (wander 3.3 -> 0.78x), run 7.92 (chase 9.5 ->
    // 1.20x). Both land inside the matcher's clamps, so the feet plant.
    walkRef: 4.24,
    runRef: 7.92,
    // 'entity' tint: the broodlords wash dark scale-brown (template color).
    tint: 'entity',
    tintStrength: 0.12,
  },
  // Cindraleth: the same GLB and clips as her broodlords, own refs for her
  // scale 2.85 body (walk 5.37, run 10.04 -> her 9.0 chase plays at 0.90x).
  // Her template color (0xf0b040) tints this shared body gold, so she reads
  // as the gilded mother of the same brood.
  mob_dragonkin_matriarch: {
    url: `${CREATURES}/dragonkin_elite.glb`,
    authoredAtlas: true, // baked Tripo atlas: low-tier floor rides the map
    height: 2.6,
    clips: DRAGONKIN_BROODLORD,
    walkRef: 5.37,
    runRef: 10.04,
    tint: 'entity',
    tintStrength: 0.12,
  },
  mob_dragonkin_broodguard: {
    url: `${CREATURES}/dragonkin_mob.glb`,
    authoredAtlas: true, // baked Tripo atlas: low-tier floor rides the map
    height: 2.2,
    clips: DRAGONKIN_BROODGUARD,
    // scale 1.5: walk 2.15 (wander 2.98 -> 1.39x), run 5.59 (chase 8.5 ->
    // 1.52x, a 0.55s sprint cadence). Feet plant at both speeds.
    walkRef: 2.15,
    runRef: 5.59,
    tint: 'entity',
    tintStrength: 0.1,
  },
  mob_dragonkin_whelp: {
    url: `${CREATURES}/dragonkin_baby.glb`,
    authoredAtlas: true, // baked Tripo atlas: low-tier floor rides the map
    height: 1.05,
    clips: DRAGONKIN_WHELP,
    // scale 0.85: walk 0.54, run 1.87. A hatchling 0.9yd tall CANNOT
    // foot-match a 10 yd/s chase (11 body-lengths/sec, gecko territory: the
    // clip would need a 0.1s cycle), so this one keeps a residual slide by
    // physics, not by oversight. The compressed 0.32s cycle reads as a
    // frantic scurry, which is what hides it; the refs stay honest so the
    // slow wander gait (and any future speed change) still matches.
    walkRef: 0.54,
    runRef: 1.87,
    tint: 'entity',
    tintStrength: 0.1,
  },
  // The egg is a clipless two-shell prop mob: alive shows Egg_Closed, death
  // swaps to Egg_Open (the cracked shell IS the corpse; see corpseMeshSwap).
  mob_dragon_egg: {
    url: `${CREATURES}/dragon_egg.glb`,
    // Blender-default roughness 0.5 export: the body clamp kept it glossy, a grey
    // specular sheen over the painted shell. matte restores the flat paint.
    matte: true,
    authoredAtlas: true, // baked atlas: low-tier floor rides the map
    height: 0.95,
    clips: STATIC_PROP,
    corpseMeshSwap: { hide: 'Egg_Closed', show: 'Egg_Open' },
    tint: 'entity',
    tintStrength: 0.08,
  },
  // Bog Thrall (The Drowned Litany): unused floating ghost rig, a stronger
  // fit for an undead swarm add than the generic skel_minion skeleton
  // (docs/prd/drowned-litany-asset-generation-plan.md).
  mob_choir_thrall: {
    url: `${CREATURES}/ghost.glb`,
    height: 1.6,
    hover: 0.3,
    clips: FLOATING,
    // Strong pull toward the template's pale sage: the ghost's own materials
    // are charcoal-grey and vanish against the black Litany pools; undead in
    // this delve read bone-pale per the marsh palette brief in the asset plan.
    tint: 'entity',
    tintStrength: 0.6,
  },
  // Tolling Bell (The Drowned Litany): Meshy-generated, not a KayKit/Quaternius
  // reuse: a rolling bell has no obvious existing-asset stand-in
  // (docs/prd/drowned-litany-asset-generation-plan.md).
  mob_tolling_bell: {
    url: `${CREATURES}/tolling_bell.glb`,
    // Reads ~2m in world after the template's 0.6 scale: the rolling bell is a
    // boss projectile the player dodges, so it must loom, not look like a prop.
    height: 3.4,
    clips: TOLLING_BELL,
    tint: 'entity',
    tintStrength: 0.15,
  },
  // Dedicated Destruction summons generated through the creature pipeline.
  // Their authored fel textures stay untinted. The manifest height combines
  // with each MobTemplate scale to render Emberkin at 1.15 units, Duskmurk
  // at 3.0 units, and the Pyre Colossus at 4.25 units.
  mob_emberkin: {
    url: `${CREATURES}/emberkin.glb`,
    height: 2.1,
    yaw: -Math.PI / 2,
    attackTimeScale: 6,
    deathTimeScale: 3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      jump: 'Jump',
      attackByAbility: { emberkin_felbolt: 'Cast' },
    },
  },
  // WIP forge mech (mech.glb, Tripo auto-rig on a mixamorig core). It ships only
  // a CRAWL -> STAND UP -> DIE clip set (no idle/walk/attack yet), so idle/walk/
  // run all read as the crawl, StandUp doubles as the attack lunge and the spawn
  // flourish, and Death is the death. yaw/height are first-pass guesses; tune
  // against the live model.
  mob_mech: {
    url: `${CREATURES}/mech.glb`,
    height: 2.0,
    // Mixamo/Tripo rig faces +Z natively (unlike the KayKit creatures that need
    // -PI/2), so no yaw offset: without this the body sat 90 degrees off its
    // travel direction and read as sideways gliding while crawling.
    yaw: 0,
    idleFrozen: true,
    clips: {
      idle: 'Crawl',
      walk: 'Crawl',
      run: 'Crawl',
      attack: ['StandUp'],
      death: 'Death',
      flourish: 'StandUp',
    },
  },
  mob_gloomshade: {
    url: `${CREATURES}/gloomshade_abyssal_guardian.glb`,
    height: 2.6,
    yaw: -Math.PI / 2,
    attackTimeScale: 6,
    deathTimeScale: 3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      jump: 'Jump',
      attackByAbility: { gloomshade_abyssal_chain: 'Cast' },
    },
  },
  mob_pyre_colossus: {
    url: `${CREATURES}/pyre_colossus.glb`,
    height: 2.5,
    yaw: -Math.PI / 2,
    attackTimeScale: 6,
    deathTimeScale: 3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      jump: 'Jump',
    },
  },
  // Shared fallback rig for the remaining warlock demons. The entity colour
  // and the mob template's scale distinguish their silhouettes.
  mob_demon: {
    url: `${CREATURES}/demonalt.glb`,
    height: 1.8,
    clips: DEMON_BIPED14,
    // Demon_Attack clip donor (scripts/build_demon_anims.mjs): mesh-free,
    // baked off this same rig's own poses. Shared with mob_demonalt below.
    animUrls: [
      `${CREATURES}/demonalt_hit_variety_anims.glb`,
      `${CREATURES}/demon_ability_anims.glb`,
    ],
    tint: 'entity',
    tintStrength: 0.5,
  },
  mob_demon_flying: {
    url: `${CREATURES}/demon.glb`,
    height: 1.7,
    hover: 0.35,
    clips: DEMON_FLYING_FLOATING,
    // Bespoke attack clip (scripts/build_demon_flying_anims.mjs): a
    // mesh-free clip donor GLB baked off this rig's own donor poses.
    animUrls: [`${CREATURES}/demon_flying_anims.glb`],
    tint: 'entity',
    tintStrength: 0.25,
  },
  // the Nightbloom's realm-only rigs, all first appearances: the moonfleece
  // herds (alpaca), the gloam striders (velociraptor), and the hovering
  // masked nightkin (tribal, a flying rig: they drift rather than walk)
  mob_alpaca: {
    url: `${CREATURES}/alpaca.glb`,
    height: 1.7,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
    tint: 'entity',
    tintStrength: 0.3,
  },
  mob_raptor: {
    url: `${CREATURES}/velociraptor.glb`,
    height: 1.6,
    clips: RAPTOR,
    tint: 'entity',
    tintStrength: 0.35,
  },
  mob_nightkin: {
    url: `${CREATURES}/tribal.glb`,
    height: 1.9,
    hover: 0.3,
    clips: NIGHTKIN_FLOATING,
    // Nightkin_Attack clip donor (scripts/build_nightkin_anims.mjs):
    // mesh-free, baked off this same rig's own poses.
    animUrls: [`${CREATURES}/nightkin_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.3,
  },
  // the Veiled Hollow's spirits: the ghost rig, entity-tinted (teal hollow
  // remnants and the ice wisp still wear it)
  mob_ghost: {
    url: `${CREATURES}/ghost.glb`,
    height: 1.6,
    hover: 0.4,
    clips: GHOST_FLOATING,
    // Ghost_Attack clip donor (scripts/build_ghost_anims.mjs): mesh-free,
    // baked off this same rig's own poses.
    animUrls: [`${CREATURES}/ghost_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.55,
  },
  // the Hollow wisps: bespoke static meshes from the approved concepts
  // (user-generated via Tripo). No rig on purpose: they drift and hover,
  // and every clip lookup null-guards, so FLOATING names simply no-op.
  // Baked palettes, so no entity tint. Front faces +x off the generator;
  // yaw turns it to the +z game convention.
  mob_glimmerwisp: {
    url: `${CREATURES}/glimmerwisp.glb`,
    height: 1.6,
    hover: 0.4,
    clips: FLOATING,
    yaw: -Math.PI / 2,
  },
  mob_duskwisp: {
    url: `${CREATURES}/duskwisp.glb`,
    height: 1.6,
    hover: 0.4,
    clips: FLOATING,
    yaw: -Math.PI / 2,
  },
  // spore-borne mushroom folk: the glub blob drifting just above the glade
  mob_glub: {
    url: `${CREATURES}/glubevolved.glb`,
    height: 1.4,
    hover: 0.15,
    clips: GLUB_FLOATING,
    // Glub_Attack clip donor (scripts/build_glub_anims.mjs): mesh-free,
    // baked off this same rig's own poses.
    animUrls: [`${CREATURES}/glub_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.45,
  },
  // the Hollow's wandering bosses: two more rigs no other zone uses
  mob_crab: {
    url: `${CREATURES}/crabenemy.glb`,
    height: 1.7,
    clips: CRAB_ENEMY_BITE,
    // Crab_Attack clip donor (scripts/build_crab_anims.mjs): mesh-free,
    // baked off this same rig's own poses. Loads alongside the hit-variety
    // donor GLB below; both are mesh-free so their clips just merge in.
    animUrls: [
      `${CREATURES}/crabenemy_hit_variety_anims.glb`,
      `${CREATURES}/crab_ability_anims.glb`,
    ],
    tint: 'entity',
    tintStrength: 0.35,
  },
  mob_bull: {
    url: `${CREATURES}/bull.glb`,
    height: 2.1,
    // the bull rig has no plain Idle clip; grazing IS its idle
    clips: {
      idle: 'Eating',
      walk: 'Walk',
      run: 'Gallop',
      attack: ['Attack_Headbutt', 'Attack_Kick'],
      hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'],
      death: 'Death',
    },
    tint: 'entity',
    tintStrength: 0.3,
  },
  // mossy treant: the shaggy yeti under a bark-green entity wash
  mob_treant: {
    url: `${CREATURES}/yeti.glb`,
    height: 2.6,
    clips: TREANT_ENEMY_BITE,
    // Treant_Attack clip donor (scripts/build_treant_anims.mjs): mesh-free,
    // baked off this same rig's own poses. Loads alongside the yeti's
    // hit-variety donor GLB; both are mesh-free so their clips just merge in.
    animUrls: [`${CREATURES}/yeti_hit_variety_anims.glb`, `${CREATURES}/treant_ability_anims.glb`],
    tint: 'entity',
    tintStrength: 0.72, // the white pelt needs a heavy wash to read as moss
  },
  mob_demonalt: {
    url: `${CREATURES}/demonalt.glb`,
    height: 2.1,
    clips: DEMON_BIPED14,
    // Demon_Attack clip donor (scripts/build_demon_anims.mjs): mesh-free,
    // baked off this same rig's own poses. Shared with mob_demon above.
    animUrls: [
      `${CREATURES}/demonalt_hit_variety_anims.glb`,
      `${CREATURES}/demon_ability_anims.glb`,
    ],
    tint: 'entity',
    tintStrength: 0.35,
  },

  // -- delve-specific variants (same rigs, colour-differentiated via mob.color) -
  // Ledger Wraith: the minion, pale; a stronger wash reads as near-transparent
  delve_skel_wraith: { ...WOC_SKELETON_MINION, tintStrength: 0.55 },
  delve_skel_ringer: {
    // Funeral Ringer: skeleton rogue rig, cloth-brown tint at mid strength
    url: `${ENEMIES}/skeleton_rogue.glb`,
    animUrls: [`${ENEMIES}/skeleton_rogue_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attach: [{ url: `${WEAPONS}/skeleton_axe.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.45,
  },
  delve_mob_acolyte: {
    // Gravecall Acolyte: hooded mage with hat + staff, deep dark-brown saturation
    url: `${PLAYERS}/mage.glb`,
    animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.6,
  },
  delve_skel_effigy: {
    // Saintless Effigy: armoured skeleton, high stone-pale wash, reads as carved stone
    url: `${ENEMIES}/skeleton_warrior.glb`,
    animUrls: [`${ENEMIES}/skeleton_warrior_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attach: [
      { url: `${WEAPONS}/skeleton_blade.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/skeleton_shield_large_a.glb`, bone: 'handslot.l' },
    ],
    tint: 'entity',
    tintStrength: 0.65,
  },
  delve_skel_varric: {
    // Deacon Vandric: boss mage rig with Taunt flourish on pull
    url: `${ENEMIES}/skeleton_mage.glb`,
    animUrls: [`${ENEMIES}/skeleton_mage_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.35,
  },

  // -- undead (KayKit skeletons, shared 41-joint rig) ------------------------
  // The minion is the art guide's own skeleton now (WOC_SKELETON_MINION above).
  skel_minion: WOC_SKELETON_MINION,
  // The Bonebound Rickshaw's puller ONLY: a separate key on its own rebuilt
  // rig (see RICKSHAW_PULLER_CLIPS above for why it is a separate GLB from
  // skeleton_minion.glb, which skel_minion above used, no
  // regression to any of its own consumers).
  //
  // 2.166 is a DELIBERATE ART CHOICE, not a measurement, and it is the one
  // value in this entry that is not free to change. `height` is a TARGET:
  // prepareVisual poses a throwaway clone mid-idle, measures that, and
  // derives normScale = height / posedHeight, so whatever goes here IS the
  // puller's rendered size. The rest of this skeleton family stands at the
  // 2.5 convention (skel_minion, skel_warrior), so this puller is
  // deliberately about 13% shorter than the identical rig walking around as
  // a mob: it reads as a hunched grunt harnessed to a cart rather than a
  // soldier, and it keeps the crown clear of the cart's own canopy line.
  //
  // Changing it is a geometry change, not a number change. The shaft
  // cross-brace (model.js SHAFT_TIP_Y/Z/SIDE_X) is positioned against this
  // rig's measured handslot bones AT THIS SIZE, and RICKSHAW_PULLER_OFFSET_Z
  // /_Y (src/render/rickshaw_mount.ts) were tuned live against it. Scaling
  // to 2.5 moves the hand bones and breaks the grip alignment; re-tune all
  // three together and retake the screenshots if you ever do.
  skel_rickshaw_puller: {
    url: `${ENEMIES}/skeleton_minion_free.glb`,
    height: 2.166,
    clips: RICKSHAW_PULLER_CLIPS,
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_warrior: {
    url: `${ENEMIES}/skeleton_warrior.glb`,
    animUrls: [`${ENEMIES}/skeleton_warrior_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_rogue: {
    url: `${ENEMIES}/skeleton_rogue.glb`,
    animUrls: [`${ENEMIES}/skeleton_rogue_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_mage: {
    url: `${ENEMIES}/skeleton_mage.glb`,
    animUrls: [`${ENEMIES}/skeleton_mage_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_boss: {
    url: `${ENEMIES}/skeleton_mage.glb`,
    height: 2.5,
    // Morthen the Gravecaller's visual (a dungeon final boss, dungeons.ts): its
    // own attack instead of the plain 2H chop skel_mage and delve_skel_varric
    // still share off the same skeletonClips() vocabulary (scripts/
    // build_skelboss_anims.mjs, issue #2889). Spread the factory result and
    // override only attack, so skel_mage/delve_skel_varric/rift_ritualist stay
    // on the shared swing.
    clips: { ...skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'), attack: ['SkelBoss_Attack'] },
    animUrls: [
      `${ENEMIES}/skeleton_mage_hit_variety_anims.glb`,
      `${ENEMIES}/skelboss_ability_anims.glb`,
    ],
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_necromancer: {
    url: `${ENEMIES}/necromancer.glb`,
    animUrls: [`${ENEMIES}/necromancer_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  // The Infernal Citadel's Magus Vel'Kor: the same necromancer rig, but drenched in
  // its entity colour (the shared skel_necromancer tints at 0.25 and stays
  // bone-white, which reads as a snowdrift under the citadel's blood-red grade).
  rift_ritualist: {
    url: `${ENEMIES}/necromancer.glb`,
    animUrls: [`${ENEMIES}/necromancer_hit_variety_anims.glb`],
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    tint: 'entity',
    tintStrength: 0.8,
  },
  skel_golem: {
    url: `${ENEMIES}/skeleton_golem.glb`,
    height: 3.4,
    // Bespoke attack (scripts/build_skeleton_golem_anims.mjs, issue #2889
    // follow-up batch): this rig backs four named boss/rare VisualDef
    // assignments (nythraxis_scourge_of_thornpeak, a dungeon final boss; plus
    // ancient_guardian, waking_warden, idol_guardian below), but still played
    // the exact same generic swing every plain humanoid mob uses. Spreads the
    // original skeletonLargeClips result and overrides just the attack
    // field, the same pattern ELEMENTAL_FLOATING uses over the shared
    // FLOATING constant: idle/walk/run/hit/death stay the shared set.
    clips: {
      ...skeletonLargeClips(['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop']),
      attack: ['Golem_Slam'],
    },
    animUrls: [`${ENEMIES}/skeleton_golem_anims.glb`],
    // the baked golem axe ships without the 180° grip flip the rig expects, so
    // the blade faces backwards; spin it about its handle (local Y) to face out.
    weaponFix: [{ node: 'Skeleton_Golem_Axe', rotY: Math.PI }],
    tint: 'entity',
    tintStrength: 0.25,
  },

  // -- the Hollow Crypt trash (sim/content/hollow_crypt_trash.ts) ----------------
  // The crypt's skeletons are the art guide's models (concept, Tripo P2, a skeleton
  // and every clip built from scratch in Blender), each with the trash kit's casts on
  // its own gestures.
  //
  // The Ossuary Warrior: an ossuary guard in rusted plate studded with skulls and
  // bones, an iron sword in its right hand. Attack is the overhead chop, Attack2 the
  // diagonal slice. Cleave is Grave Cleave: both hands take the hilt, the sword hangs
  // overhead straining while the 1.6 s bar fills and falls into the ground on the
  // bar's end (frame 49, bar-locked), then the recovery plays out. Death crumples it
  // onto its back and the helmed skull rolls clear: that corpse is Reassemble's bone
  // pile, and Awaken (the flourish on the dead-to-alive edge) rolls the skull back
  // and hauls the body up to Idle. Walk and Run are authored at 1.37 and 4.2 raw
  // units/s over the 1.819 posed idle height. The sword's size matches the WOC
  // bodies' hold (their handslot draws props at 0.46 on a body 1.15 units tall).
  crypt_skel_warrior: {
    url: `${CREATURES}/woc_crypt_ossuary_warrior.glb`,
    height: 3.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['React'],
      death: 'Death',
      flourish: 'Awaken',
      castByAbility: { [CRYPT_GRAVE_CLEAVE]: 'Cleave' },
      castPlayOut: ['Cleave'],
    },
    castClipSync: [CRYPT_GRAVE_CLEAVE],
    oneShotsHoldAttacks: ['Awaken'],
    attach: [
      { url: `${WEAPONS}/sword_field_iron.glb`, bone: 'handslot.r', size: WOC_CRYPT_PROP_SIZE },
    ],
    walkRef: 2.5,
    runRef: 7.6,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.25,
  },
  // Reassemble's Stirring Bones (crypt_bone_pile): the pile IS the fallen
  // warrior's own corpse, so this draws no body; its click capsule, widened so
  // the pile is easy to target over the corpse, nameplate and bar stay. The
  // soul-green countdown glow and the tether are hollow_crypt/crypt_bone_fx.ts.
  // When the bones stand, the warrior's own rig plays its flourish
  // (Skeletons_Awaken_Standing) on the dead-to-alive edge (CharacterVisual.revive).
  crypt_skel_bone_pile: {
    url: `${ENEMIES}/skeleton_warrior.glb`,
    height: 1.4,
    // Bound from the warrior GLB alone (no hit-variety pack: it is never seen).
    clips: {
      idle: 'Lie_Idle',
      walk: 'Lie_Idle',
      run: 'Lie_Idle',
      attack: [],
      hit: ['Hit_A'],
      death: 'Death_A',
    },
    bodyless: true,
    clickRadius: 2,
  },
  // A Remembrance Candle's usable body (crypt_remembrance_candle, Morthen's
  // Rite: encounters/hollow_crypt/morthen_candles.ts) stands at its pillar's
  // foot: the pillar is the kit's and the flame the crypt's own painter
  // (hollow_crypt/morthen_candle_fx.ts), so this draws no body. Its click
  // capsule, nameplate and bar stay, raised to the candle's height so the
  // relight is easy to target; bound off the bone pile's rig (never seen).
  crypt_rite_candle_body: {
    url: `${ENEMIES}/skeleton_warrior.glb`,
    height: 3.6,
    clips: {
      idle: 'Lie_Idle',
      walk: 'Lie_Idle',
      run: 'Lie_Idle',
      attack: [],
      hit: ['Hit_A'],
      death: 'Death_A',
    },
    bodyless: true,
    clickRadius: 2.2,
  },
  // The Gravecaller Adept: a novice of the cult in a violet hooded robe split over its
  // legs, a violet staff in its right hand. Cast is the conjuring loop (Grave Spark).
  // Bolt is Grave Bolt: the staff levelled, the off hand drawn back to the shoulder
  // through the 2.5 s bar and thrust out on its end (frame 76). Volley is Gravespark
  // Volley: staff and hand climb overhead through the 3 s bar and fling forward on its
  // end (frame 91). Both are bar-locked and play their recovery out. Walk and Run are
  // authored at 1.21 and 4.0 raw units/s over the 1.818 posed idle height.
  crypt_skel_adept: {
    url: `${CREATURES}/woc_crypt_gravecaller_adept.glb`,
    height: 3.2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['React'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: { [CRYPT_GRAVE_BOLT]: 'Bolt', [CRYPT_GRAVESPARK_VOLLEY]: 'Volley' },
      castPlayOut: ['Bolt', 'Volley'],
    },
    castClipSync: [CRYPT_GRAVE_BOLT, CRYPT_GRAVESPARK_VOLLEY],
    attach: [
      { url: `${WEAPONS}/staff_rare_a_violet.glb`, bone: 'handslot.r', size: WOC_CRYPT_PROP_SIZE },
    ],
    walkRef: 2.13,
    runRef: 7.0,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // The Gravecaller Necromancer: a senior priest in black over violet robes, a mantle of
  // finger bones and a chained ledger, a violet staff in its right hand. Cast is the
  // conjuring loop (Grave Spark, Grave Rupture); Raise is the Raise Bones channel, both
  // arms and the staff lifting the dead with each heave. Walk and Run are authored at
  // 1.13 and 3.9 raw units/s over the 1.836 posed idle height.
  crypt_skel_necromancer: {
    url: `${CREATURES}/woc_crypt_gravecaller_necromancer.glb`,
    height: 3.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['React'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: { [CRYPT_RAISE_BONES]: 'Raise' },
    },
    attach: [
      { url: `${WEAPONS}/staff_rare_b_violet.glb`, bone: 'handslot.r', size: WOC_CRYPT_PROP_SIZE },
    ],
    walkRef: 2.03,
    runRef: 7.0,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.3,
  },
  // The rest of the Hollow Crypt roster, raised a head or more over a player (2.6) so
  // nothing in the crypt stands at player size: the cutthroat, the Bone Minion (it
  // grows into the Brute), the Brute itself, the Sexton, the Cantor and her choir,
  // Morthen, and Rimeweb over her brood.
  //
  // The Ossuary Cutthroat: a lean skeleton bound in burial shroud, a bone dagger in each
  // hand, crouched low. Attack is the right-hand stab, Attack2 the double-dagger lunge
  // (also what its Rending Leap plays: the leap's windup carries no ability id, so it
  // swings the plain attack mid-arc). Walk and Run are authored at 1.45 and 4.6 raw
  // units/s over the 1.734 posed (crouched) idle height.
  crypt_skel_cutthroat: {
    url: `${CREATURES}/woc_crypt_ossuary_cutthroat.glb`,
    height: 3.2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['React'],
      death: 'Death',
    },
    attach: [
      { url: `${WEAPONS}/dagger_rare_a_bone.glb`, bone: 'handslot.r', size: WOC_CRYPT_PROP_SIZE },
      { url: `${WEAPONS}/dagger_rare_a_bone.glb`, bone: 'handslot.l', size: WOC_CRYPT_PROP_SIZE },
    ],
    walkRef: 2.68,
    runRef: 8.5,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.25,
  },
  crypt_skel_minion: { ...WOC_SKELETON_MINION, height: 3.5 },
  // The Bone Brute: a hulk of fused ribcages and bundled bone, unarmed, its skull sunk
  // between the shoulders. Attack is a right hook, Attack2 a short two-fist hammer. Slam
  // is Marrow Crush: both fists climb overhead through the 2 s bar and smash the floor on
  // its end (frame 61, bar-locked), then the recovery plays out. Walk and Run are
  // authored at 1.17 and 3.6 raw units/s over the 1.819 posed idle height.
  crypt_skel_brute: {
    url: `${CREATURES}/woc_crypt_bone_brute.glb`,
    height: 4.6,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['React'],
      death: 'Death',
      castByAbility: { [CRYPT_MARROW_CRUSH]: 'Slam' },
      castPlayOut: ['Slam'],
    },
    castClipSync: [CRYPT_MARROW_CRUSH],
    walkRef: 2.97,
    runRef: 9.1,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.25,
  },
  // Sexton Marrow (scripts/assets/hollow_crypt_creatures/build_marrow.py): the
  // parish gravedigger raised and still digging, sculpted on the Bastion kit at
  // full size (template scale 1): a stooped skeleton about twice a player's
  // height under a peaked cowl of grave cloth, a leather apron, a hooded tin
  // lantern at his hip and the long spade. At rest he digs (Idle); every bar
  // clip is locked to its bar and plays its recovery out: Shovelful flings the
  // earth at 1.0 of its 1.2 s bar, Measure levels the spade at the mark from 0.5,
  // GravediggersBlow lands at 0.7 of 0.8. BellRing is a 1.0 s loop (the haul
  // bottoming at 0.9, in step with ropePull) with his fists on his own axis,
  // the spade stood in the earth beside him.
  crypt_skel_sexton: {
    url: `${CREATURES}/crypt_sexton_marrow.glb`,
    // The build's IDLE_HEIGHT and MINZ, half a second into Idle (as the game measures).
    height: 5.783,
    hover: -0.038,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Measure',
      castByAbility: {
        [MARROW_SHOVELFUL]: 'Shovelful',
        [MARROW_MEASURE]: 'Measure',
        [MARROW_BURIAL_TOLL]: 'BellRing',
        [MARROW_GRAVEDIGGERS_BLOW]: 'GravediggersBlow',
      },
      castTimeScaleByAbility: {
        [MARROW_SHOVELFUL]: 1,
        [MARROW_MEASURE]: 1,
        [MARROW_BURIAL_TOLL]: 1,
        [MARROW_GRAVEDIGGERS_BLOW]: 1,
      },
      castPlayOut: ['Shovelful', 'Measure', 'GravediggersBlow'],
    },
    // The one-shot bars follow the bar; the bell loops for as long as it rings.
    castClipSync: [MARROW_SHOVELFUL, MARROW_MEASURE, MARROW_GRAVEDIGGERS_BLOW],
    castPlayOutHoldsAttacks: true,
    walkRef: 1.671,
    runRef: 6.109,
    authoredAtlas: true,
    selfIllumination: 0.1,
    clickRadius: 2.2,
  },
  // Cantor Ilvane (scripts/assets/hollow_crypt_creatures/build_cantor.py): a tall
  // skeletal choir mistress in a faded violet cassock and a torn surplice, a great
  // pleated ruff, a black lace veil under a crown of silver organ pipes, the hymnal
  // open in her left hand and a finger-bone baton with a violet light in her right.
  // Her song glows violet (the eyes, the voice in her open jaw, the baton, the notes).
  // Sing is the Dirge: bar-locked, its peak reached by 1.75 s (the Crescendo's 1.8 s
  // bar) and held, climbing, to the 2.5 s bar's end. PlayOrgan loops at the Bone
  // Organ's keys (the hymnal hangs open over them); Conduct is her flourish.
  crypt_skel_cantor: {
    url: `${CREATURES}/crypt_cantor_ilvane.glb`,
    // The build's IDLE_HEIGHT (feet to the crown's tallest pipe, half a second into
    // Idle); her template's 1.1 draws her about 6.5 yd, two and a half players.
    height: 5.964,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Conduct',
      castByAbility: {
        [ILVANE_DIRGE]: 'Sing',
        [ILVANE_UNBROKEN_DIRGE]: 'Sing',
        [ILVANE_BONE_ORGAN]: 'PlayOrgan',
      },
      castTimeScaleByAbility: {
        [ILVANE_DIRGE]: 1,
        [ILVANE_UNBROKEN_DIRGE]: 1,
        [ILVANE_BONE_ORGAN]: 1,
      },
    },
    // The Dirge follows its bar (normal or Crescendo); the organ loops while she plays.
    castClipSync: [ILVANE_DIRGE, ILVANE_UNBROKEN_DIRGE],
    walkRef: 2.2,
    runRef: 6.34,
    authoredAtlas: true,
    selfIllumination: 0.1,
    clickRadius: 2.2,
  },
  // The Hollow Chorister (the art guide's model): a skeleton of the ruined choir in a lace
  // hood and surplice over a violet cassock, its jaw open mid-hymn. It fights unarmed
  // with two raking claw swipes; Sing is its cast loop. Death drops it in its robes, and
  // Awaken (the flourish: heroic Encore stands a fallen Chorister back up) reverses the
  // fall into Idle. Walk and Run are authored at 1.10 and 3.9 raw units/s over the 1.806
  // posed idle height.
  crypt_skel_chorister: {
    url: `${CREATURES}/woc_crypt_hollow_chorister.glb`,
    height: 3.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['React'],
      death: 'Death',
      flourish: 'Awaken',
      cast: 'Sing',
    },
    oneShotsHoldAttacks: ['Awaken'],
    walkRef: 2.0,
    runRef: 7.1,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.3,
  },
  // Morthen, the Lich Bishop (the clip sets above): about three players tall
  // at his template's 1.35, floating on his soul smoke, the smoke funnel sunk
  // into the ring floor (morthen_fx_core.ts MORTHEN_HOVER) so his whole body
  // and face read from the default camera; his corpse is lifted back onto the
  // flags as he falls (MORTHEN_DEATH_LIFT).
  crypt_morthen_lich: {
    url: `${CREATURES}/crypt_morthen_lich.glb`,
    height: 6.994,
    hover: MORTHEN_HOVER,
    deathLift: MORTHEN_DEATH_LIFT,
    clips: MORTHEN_STAFF_CLIPS,
    phaseClips: {
      [MORTHEN_STAFF_HELD]: { clips: MORTHEN_STAFF_CLIPS },
      [MORTHEN_SCYTHE_HELD]: { clips: MORTHEN_SCYTHE_CLIPS },
      [MORTHEN_SCYTHE_UNFOLD]: { clips: MORTHEN_SCYTHE_CLIPS, enter: 'Transform' },
    },
    authoredAtlas: true,
    selfIllumination: 0.08,
    clickRadius: 2.2,
  },
  // The Lady of the Bonechill (scripts/assets/hollow_crypt_creatures/build_lady.py),
  // the ghost of a bride buried in the ravine's ice: authored at size (`height`
  // and `hover` are the build's IDLE_HEIGHT and MINZ half a second into Idle,
  // the ice crown on top), floating half a yard over the ice. Her gown, veil and
  // sleeves are one alpha-blended material whose translucency lives in the baked
  // atlas (it survives the far-LOD bake); the face and hands stay solid. The
  // Lament and the Bridal Freeze play the Wail on their bars (the Freeze's 2.5 s
  // bar at 1.2, so the scream peaks as either lands); the Embrace's reach closes
  // on its bar's end, and the hold loops while the sim lifts her aloft.
  crypt_lady_bonechill: {
    url: `${CREATURES}/crypt_lady_bonechill.glb`,
    height: 6.749,
    hover: 0.544,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      // Letting go (gently or not): the arms open.
      attackByAbility: { [LADY_EMBRACE_RELEASED]: 'Release', [LADY_EMBRACE_DROPPED]: 'Release' },
      hit: ['Hit'],
      death: 'Death',
      cast: 'Wail',
      castByAbility: {
        [LADY_BRIDES_LAMENT]: 'Wail',
        [LADY_BRIDAL_FREEZE]: 'Wail',
        [LADY_FROZEN_EMBRACE]: 'EmbraceReach',
        [LADY_EMBRACE_HOLD]: 'EmbraceHold',
      },
      castTimeScaleByAbility: {
        [LADY_BRIDES_LAMENT]: 1,
        [LADY_BRIDAL_FREEZE]: 1.2,
        [LADY_FROZEN_EMBRACE]: 1,
      },
    },
    // The scream and the reach follow their bars; the hold just loops.
    castClipSync: [LADY_BRIDES_LAMENT, LADY_BRIDAL_FREEZE, LADY_FROZEN_EMBRACE],
    authoredAtlas: true,
    selfIllumination: 0.3,
    clickRadius: 2.2,
  },
  mob_crypt_rimeweb: {
    url: `${CREATURES}/spider.glb`,
    height: 2.7,
    clips: SPIDER,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // A hooded cultist of the Gravecallers with a crooked staff: calls the crows.
  mob_crypt_crow_caller: {
    url: `${PLAYERS}/rogue_hooded.glb`,
    animUrls: [`${PLAYERS}/rogue_hooded_hit_variety_anims.glb`],
    height: 3.3,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      castByAbility: { [CRYPT_MURDER_CALL]: 'Spellcast_Raise' },
    },
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.6,
  },
  // The Chapel Gargoyle (scripts/assets/hollow_crypt_creatures/build_stone_gargoyle.py):
  // a great, heavy stone brute with baked cracked-stone surfaces, authored about
  // 4.5 yd tall crouched and raised to scale 1.5 by its template, so it looms
  // well over three players high on its arch (a player stands 2.6). It is a statue while it
  // perches (`Perch`, read as airborne up on the cap), cracks free on the pull
  // (`Awaken`, keyed on the dive cue), plunges (`Dive`), slams down (`DiveLand`),
  // fights from a braced crouch (`Ready`), rakes with its talons and rears to
  // shriek. Its talons curl just under its feet: the negative hover plants them.
  mob_crypt_gargoyle: {
    url: `${CREATURES}/crypt_gargoyle.glb`,
    authoredAtlas: true,
    height: 5.81,
    hover: -0.22,
    flight: true,
    clips: {
      idle: 'Perch',
      combatIdle: 'Ready',
      walk: 'Walk',
      run: 'Run',
      jump: 'Perch',
      fall: 'Dive',
      land: 'DiveLand',
      attack: ['ClawRake', 'ClawRake2'],
      attackByAbility: { [CRYPT_PERCH_DIVE]: 'Awaken' },
      attackTimeScaleByAbility: { [CRYPT_PERCH_DIVE]: 1.9 },
      hit: ['Hit'],
      death: 'Death',
      cast: 'Screech',
      castByAbility: { [CRYPT_STONE_SHRIEK]: 'Screech' },
    },
    selfIllumination: 0.18,
  },
  // The Carrion Crow is always on the wing: `hover` lifts it and its Death clip
  // drops the body onto the floor.
  mob_crypt_crow: {
    url: `${CREATURES}/crypt_crow.glb`,
    height: 1.7,
    hover: 2.2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    selfIllumination: 0.15,
  },
  // The Ossuary Drake (scripts/assets/hollow_crypt_creatures/build_bone_drake.py):
  // a colossal skeletal wyvern, its head about 10 yd up and its wings about 34
  // across, centred on its SHOULDERS so the jaws that pour the Barrowflame hang
  // over the breath cone's apex. It flies its patrol (`Fly`: two downbeats and a
  // long glide), cries as it breaks off (`SkyRoar`, the landing cue), glides
  // down (`Glide`), lands (`Land`), walks and runs on its wing knuckles, bites
  // (never claws), and plays each strike to its bar: the breath inhales over the
  // 2 s bar and its exhale plays OUT after it; the tail sweeps and the wings
  // buffet exactly at their bars' ends. Plain swings never cut those short.
  mob_crypt_drake: {
    url: `${CREATURES}/crypt_drake.glb`,
    authoredAtlas: true,
    height: 13.63,
    hover: -0.19,
    flight: true,
    clips: {
      idle: 'Idle',
      idleBeat: { clip: 'Roar', everySec: 16, jitterSec: 5 },
      walk: 'Walk',
      run: 'Run',
      jump: 'Fly',
      fall: 'Glide',
      land: 'Land',
      attack: ['Bite', 'Bite2'],
      attackByAbility: { [CRYPT_SKY_LANDING]: 'SkyRoar' },
      attackTimeScaleByAbility: { [CRYPT_SKY_LANDING]: 1 },
      hit: ['Hit'],
      death: 'Death',
      cast: 'Roar',
      castByAbility: {
        [CRYPT_BARROWFLAME_BREATH]: 'Breath',
        [CRYPT_TAIL_LASH]: 'TailSweep',
        [CRYPT_WING_GUST]: 'WingBuffet',
      },
      castTimeScaleByAbility: {
        [CRYPT_BARROWFLAME_BREATH]: 1,
        [CRYPT_TAIL_LASH]: 1,
        [CRYPT_WING_GUST]: 1,
      },
      castPlayOut: ['Breath', 'TailSweep', 'WingBuffet'],
      flourish: 'Roar',
    },
    castPlayOutHoldsAttacks: true,
    selfIllumination: 0.12,
  },

  // The Knellwyrm (scripts/assets/hollow_crypt_creatures/build_knellwyrm.py):
  // the Ossuary Drake's charred kin, built on its skeleton and rig, with ghost
  // fire burning through its skull, ribs, spine and tail and a crown of horns.
  // Authored at the drake's size; its template raises it a quarter again. It
  // glides in from the sky (the arrival bar), takes wing for its Pyre Strafe,
  // flies the lane with its neck plunged and jaws wide, and rears up with its
  // wings flung wide for Dread Bellow; the drake's strikes play to their bars.
  mob_crypt_knellwyrm: {
    url: `${CREATURES}/crypt_knellwyrm.glb`,
    authoredAtlas: true,
    height: 15.07,
    hover: -0.19,
    flight: true,
    clips: {
      idle: 'Idle',
      idleBeat: { clip: 'Roar', everySec: 14, jitterSec: 4 },
      walk: 'Walk',
      run: 'Run',
      jump: 'Fly',
      fall: 'Glide',
      land: 'Land',
      attack: ['Bite', 'Bite2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Roar',
      castByAbility: {
        [CRYPT_BARROWFLAME_BREATH]: 'Breath',
        [CRYPT_TAIL_LASH]: 'TailSweep',
        [CRYPT_WING_GUST]: 'WingBuffet',
        [KNELLWYRM_ARRIVE]: 'Glide',
        [KNELLWYRM_PYRE_STRAFE]: 'TakeWing',
        [KNELLWYRM_STRAFE_RUN]: 'Strafe',
        [KNELLWYRM_DREAD_BELLOW]: 'Bellow',
        // Heroic Burning Knell. Aloft, a flier's `jump` (Fly) owns the rig and
        // these play only on the frames it reads grounded (the take-off, the
        // touchdown); the mark and the pour also ride one-shots below.
        [KNELLWYRM_KNELL_RISE]: 'TakeWing',
        [KNELLWYRM_KNELL_MARK]: 'SkyRoar',
        [KNELLWYRM_KNELL_BREATH]: 'Strafe',
        [KNELLWYRM_KNELL_LAND]: 'Glide',
      },
      castTimeScaleByAbility: {
        [CRYPT_BARROWFLAME_BREATH]: 1,
        [CRYPT_TAIL_LASH]: 1,
        [CRYPT_WING_GUST]: 1,
        [KNELLWYRM_PYRE_STRAFE]: 1,
        [KNELLWYRM_DREAD_BELLOW]: 1,
        // TakeWing is authored on the 2.5 s rise (60 frames at 24 fps).
        [KNELLWYRM_KNELL_RISE]: 1,
      },
      // The Knell's beats aloft (morthen_rite_fx_core.ts): it roars the fire
      // down over the marked half, then dives into the pour (Strafe's 33
      // frames are the 1.4 s breath at rate 1).
      attackByAbility: { [KNELL_GESTURE_SKY_ROAR]: 'SkyRoar', [KNELL_GESTURE_POUR]: 'Strafe' },
      attackTimeScaleByAbility: { [KNELL_GESTURE_SKY_ROAR]: 1, [KNELL_GESTURE_POUR]: 1 },
      castPlayOut: ['Breath', 'TailSweep', 'WingBuffet', 'Bellow'],
      flourish: 'Roar',
    },
    castPlayOutHoldsAttacks: true,
    selfIllumination: 0.2,
  },

  // -- the Sunken Bastion trash (sim/content/sunken_bastion.ts) ------------------
  // The Bastion's drowned garrison and its sea beasts, each its own Blender
  // body (the drowned, the sea hag, the acolyte, the war hound and the Turnkey
  // sculpted in scripts/assets/sunken_bastion_drowned/; the crabs in
  // scripts/assets/sunken_bastion_creatures/), all well past the player's size, each with
  // the clips of its one job: the watchman's halberd sweep, the arbalest's
  // aimed lane shot, the sergeant's rallying roar, the sea hag's lure and ward.
  // The drowned stand head and shoulders over a player (about 1.6x for a
  // prisoner, 2x for the elite sailors, 2.6x for the sergeant); presentation
  // only, the templates' gameplay is untouched.
  // The Bastion Revenant: a drowned marine sculpted whole (scripts/assets/
  // sunken_bastion_drowned/: the OpenVDB sculpt kit), bloated sea-grey flesh
  // under a morion with a high comb and a boat brim, sea light in its sunken
  // eyes and open mouth, rusted half-plate crusted with barnacles and hung
  // with kelp, the Bastion's tower-over-waves on a torn tabard, a buckler on
  // the bare left forearm and a heavy cutlass with a knuckle bow. Its Onrush
  // dash runs in the Run clip; Rise (hauling itself up out of the tide) is
  // its flourish. Drips, brine sprays and its death gush are
  // sunken_bastion/bastion_drowned_fx.ts. walkRef/runRef are the clips' own
  // foot speeds at the drawn size.
  bastion_drowned_revenant: {
    url: `${CREATURES}/drowned_revenant.glb`,
    height: 4.95,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2', 'Attack3'],
      hit: ['Hit'],
      death: 'Death',
      flourish: 'Rise',
    },
    walkRef: 1.73,
    runRef: 6.68,
    authoredAtlas: true,
    selfIllumination: 0.18,
  },
  // The Drowned Watchman: the wall watch sculpted whole on the Revenant's kit,
  // gaunt and upright where the Revenant is bloated and hunched: a kettle hat
  // with a drooping brim, a riveted brigandine with the tower sigil, a split
  // watch coat to the knees, a long halberd with a sodden pennon and a sea-light
  // lantern at the hip. He stands at attention with the pole upright, thrusts
  // and chops with both hands, and the Halberd Sweep winds the pole back
  // through the bar and lands the sweep as it ends (1.575 s at 1.05x = the 1.5 s
  // bar), the follow-through playing out after. The Boathook Drag's 2 s bar
  // plays the thrust at 0.32x, locked to the bar: the pole drawn back, driven
  // out at 1.56 s and held at full reach as the hook flies at the bar's end
  // (sunken_bastion/bastion_boathook_fx.ts), the recovery playing out after.
  bastion_skel_watchman: {
    url: `${CREATURES}/drowned_watchman.glb`,
    height: 4.9,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      // The pole is drawn back through the bar and sweeps as it ends.
      castByAbility: { [BASTION_HALBERD_SWEEP]: 'HalberdSweep', [BASTION_BOATHOOK]: 'Attack' },
      castTimeScaleByAbility: { [BASTION_HALBERD_SWEEP]: 1.05, [BASTION_BOATHOOK]: 0.32 },
      castPlayOut: ['HalberdSweep', 'Attack'],
    },
    castClipSync: [BASTION_BOATHOOK],
    walkRef: 1.45,
    runRef: 6.33,
    authoredAtlas: true,
    selfIllumination: 0.16,
  },
  // The Fogbound Arbalest: the wall's marksman sculpted whole on the
  // Revenant's kit, stooped and wary where the Watchman stands tall: a deep
  // sodden hood and mantle, rags wound over the lower face, a quilted gambeson
  // instead of plate, a quiver at the hip and a heavy windlass crossbow (long
  // stock, steel prod, a drawn string and a loaded bolt, each on its own bone)
  // carried low across the body. Shoot is the Rusted Bolt: shouldered over the
  // 0.6 s windup, the loose on the release frame (the bolt and the drawn string
  // vanish, the loosed string shows), the kick, then the nose dropped, the
  // windlass cranked and a fresh bolt laid in. Aim is the Piercing Bolt: held
  // down the lane over the 2 s bar, the loose landing as the bar ends, the
  // reload playing out after. The bolts themselves fly in
  // sunken_bastion/bastion_creature_fx.ts from ARBALEST_MUZZLE.
  bastion_skel_arbalest: {
    url: `${CREATURES}/drowned_arbalest.glb`,
    height: 5.1,
    attackTimeScale: 1,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Shoot'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: { [BASTION_PIERCING_BOLT]: 'Aim' },
      castTimeScaleByAbility: { [BASTION_PIERCING_BOLT]: 1 },
      castPlayOut: ['Aim'],
    },
    castPlayOutHoldsAttacks: true,
    walkRef: 1.55,
    runRef: 7.2,
    authoredAtlas: true,
    selfIllumination: 0.16,
  },
  // The Drowned Sergeant: the wall's sergeant sculpted whole on the Revenant's
  // kit, the heaviest plate on the wall over a barrel-chested drowned body: a
  // closed great helm with a T-slit (the sea light burning in the slit and the
  // mouth slot) and a ragged kelp plume, huge layered pauldrons crusted with
  // barnacles, the sergeant's faded sash across the breast, the Bastion's
  // tabard and a bearded boarding axe carried on the shoulder, the left fist
  // on his hip. Attack cleaves down off the shoulder, Attack2 is a two-handed
  // overhead chop; Rally (the axe thrust high, the fist beaten on the breast)
  // is his flourish. walkRef/runRef are the clips' own foot speeds at the
  // drawn size.
  bastion_skel_sergeant: {
    url: `${CREATURES}/drowned_sergeant.glb`,
    // 4.85 to the crown of the helm; the shouldered axe head rides above it.
    height: 5.15,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      // Rally the Watch: the axe thrust high and the fist on the breast.
      flourish: 'Rally',
      // Loose on My Mark (the trash pass's second wave): the same axe thrust
      // high at the mark, held for the 2 s shout.
      castByAbility: { [BASTION_LOOSE_ON_MY_MARK]: 'Rally' },
    },
    walkRef: 2.19,
    runRef: 8.23,
    authoredAtlas: true,
    selfIllumination: 0.16,
  },
  // The Mist Chanter: the sea hag who sings the fog in, sculpted whole on the
  // drowned kit (scripts/assets/sunken_bastion_drowned/chanter/): a tall bent
  // crone, bone and slack grey skin, a long hooked nose under a deep shawl-hood
  // of rag and old fishing net, lank weed-hair spilling out to her breast, sea
  // light in her eyes, rag skirts to her bare feet and a crooked driftwood
  // staff dangling an anglerfish lure of sea light. Chilling Mist comes off the
  // lure thrust out (Attack) or off her claw swept across (Attack2), both
  // releasing 0.6 s in (the petSpell windup); Fog Ward is the staff raised in
  // both hands and circled overhead. Drawn taller than before so she looms
  // over a player; presentation only.
  bastion_mistweaver: {
    url: `${CREATURES}/mist_chanter.glb`,
    height: 4.4,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      // Chilling Mist: the lure thrust out; Fog Ward: the staff raised high.
      cast: 'Cast',
      castByAbility: { [BASTION_FOG_WARD]: 'Ward' },
    },
    walkRef: 1.11,
    runRef: 4.57,
    authoredAtlas: true,
    selfIllumination: 0.16,
  },
  // The Tidebound Acolyte: a living cultist of Vael's hymn, sculpted whole on
  // the drowned kit (scripts/assets/sunken_bastion_drowned/acolyte/): tall and
  // upright in layered sea-green robes with wide sleeves, a deep cowl under a
  // tall finned mitre, gill slits in the neck and sea light in the eyes, a
  // shell medallion, a coral-crowned staff holding a pearl of sea light and a
  // great conch in the left hand. He fights with the staff (a two-handed blow
  // down, a flat sweep of the crown); Brine Mend loops the conch held high and
  // tipped over the bar. Drawn well past a player now; presentation only.
  bastion_acolyte: {
    url: `${CREATURES}/tidebound_acolyte.glb`,
    height: 5.0,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Mend',
      castByAbility: { [BASTION_BRINE_MEND]: 'Mend' },
    },
    walkRef: 1.06,
    runRef: 4.86,
    authoredAtlas: true,
    selfIllumination: 0.16,
  },

  // The Sunken Bastion's bosses (sim/encounters/sunken_bastion), each sculpted
  // whole on the drowned kit. Knight-Commander Olen (scripts/assets/
  // sunken_bastion_drowned/olen/): the officer his drowned garrison still serves,
  // towering over it in fluted plate trimmed with tarnished brass, the Bastion's
  // tower-over-waves in brass on his breast; a grand morion with a crest of
  // faded crimson horsehair and a bevor up under the nose, sea light burning in
  // the shadow of the brim; a commander's cloak torn to the calves, a great
  // tower shield held by its upright grip (the sigil in brass, barnacles crusting
  // its foot) and a broad longsword. He chops over the shield's rim, drives the
  // shield in and reaps with a flat sweep (Attack3, his Reaping Arc); the
  // Oathbound Charge's bar is OathCharge (stamp, the oath roared with the sword
  // to the sky, down behind the shield), bar-locked so he launches on the bar's
  // end into Run, the shield-first charge; Breached he reels in Stunned.
  bastion_olen: {
    url: `${CREATURES}/knight_commander_olen.glb`,
    // Drawn over the sergeant (7.2) and the Turnkey (8.3) at his 1.2: about 8.9.
    height: 7.4,
    clips: {
      idle: 'Idle',
      combatIdle: 'CombatIdle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2', 'Attack3'],
      hit: ['Hit'],
      death: 'Death',
      stunned: 'Stunned',
      cast: 'Judgement',
      // The fallen paladin's kit (encounters/sunken_bastion/olen.ts): the
      // sword driven into the flags, the shield hurled, the sword levelled at
      // the Sentence's mark, the kneel and the vigil in the Oath's bubble.
      castByAbility: {
        [OLEN_HALLOWED_BRINE]: 'Consecrate',
        [OLEN_REBOUNDING_BULWARK]: 'ShieldThrow',
        [OLEN_TIDE_SENTENCE]: 'Judgement',
        [OLEN_OATH_KNEEL]: 'OathKneel',
        [OLEN_OATH_VIGIL]: 'OathVigil',
      },
      castTimeScaleByAbility: {
        [OLEN_HALLOWED_BRINE]: 1,
        [OLEN_REBOUNDING_BULWARK]: 1,
        [OLEN_TIDE_SENTENCE]: 1,
        [OLEN_OATH_KNEEL]: 1,
      },
      // The shield comes home to his arm (bastion_olen_fx.ts).
      attackByAbility: { [OLEN_SHIELD_CATCH_GESTURE]: 'ShieldCatch' },
    },
    // Every bar's clip lands its moment on the bar (the plant, the release at
    // 1.3 of the throw's 1.5, the kneel); the vigil loops for as long as it holds.
    castClipSync: [
      OLEN_HALLOWED_BRINE,
      OLEN_REBOUNDING_BULWARK,
      OLEN_TIDE_SENTENCE,
      OLEN_OATH_KNEEL,
    ],
    // The held shield (its own Shield bone) stays hidden while the hurled one
    // flies, and comes back with the catch.
    meshToggles: [
      {
        nodes: [OLEN_SHIELD_BONE],
        hideNow: OLEN_SHIELD_AWAY_GESTURE,
        showNow: OLEN_SHIELD_HOME_GESTURE,
      },
    ],
    walkRef: 2.5,
    runRef: 9.93,
    authoredAtlas: true,
    selfIllumination: 0.16,
  },
  // Gaoler Ossick (scripts/assets/sunken_bastion_drowned/ossick/): the gaol's
  // master, drowned in his own yard, sculpted whole on the drowned kit: a hulking
  // hunched brute, the shoulders heaped up past his ears and crusted with
  // barnacles, arms like mooring posts ending in his own snapped manacles, a
  // bald drowned head caged in an iron brank with sea light behind the bands, a
  // leather harness over the bare grey chest, a ship's anchor slung on his back
  // on a chain over the shoulder, shackle pairs at his hip and an iron-bound
  // cudgel. Every bar is bar-locked, its release on the bar's end and its
  // follow-through played out: AnchorHurl takes the anchor off his back and
  // hurls it one-handed (the slung anchor, its own mesh, stays hidden while his
  // thrown one lies on a victim: bastion_gaol_fx.ts re-sends the gestures),
  // ShackleHeave thrusts the cudgel through his belt and heaves the shackles in
  // both fists, CudgelSlam brings the cudgel straight down.
  bastion_ossick: {
    url: `${CREATURES}/gaoler_ossick.glb`,
    // Hunched, yet over the Turnkey (8.3) and Olen (8.9) at his 1.4: about 9.8.
    height: 7.0,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'CudgelSlam',
      castByAbility: {
        [OSSICK_ANCHOR]: 'AnchorHurl',
        [OSSICK_SHACKLE]: 'ShackleHeave',
        [OSSICK_CUDGEL]: 'CudgelSlam',
      },
      castTimeScaleByAbility: { [OSSICK_ANCHOR]: 1, [OSSICK_SHACKLE]: 1, [OSSICK_CUDGEL]: 1 },
      castPlayOut: ['AnchorHurl', 'ShackleHeave', 'CudgelSlam'],
    },
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    meshToggles: [
      {
        nodes: [OSSICK_ANCHOR_BACK_MESH],
        hideNow: OSSICK_ANCHOR_AWAY_GESTURE,
        showNow: OSSICK_ANCHOR_HOME_GESTURE,
      },
    ],
    walkRef: 2.74,
    runRef: 9.37,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // Vael the Fogbinder, Death itself, and his shadow copies wear ONE look (the
  // veil hides him among them; only the Fogbeacon's beam tells them apart):
  // the hooded skeletal reaper built in Blender (scripts/assets/
  // sunken_bastion_creatures/reaper.py), a great scythe in hand, soul fire in
  // his sockets, ribs and lantern, hovering a hand over the flags. The scythe
  // is modelled in his right fist and never turns against it (the arms and
  // body swing it; tests/vael_reaper.test.ts). Authored at size (`height` and
  // `hover` are the build's IDLE_HEIGHT and MINZ half a second into Idle, the
  // upright scythe's blade on top; the hood's peak about 6.5), drawn at the
  // template's 1.35. The Shadow Crossing's bar sinks him through the floor
  // (Vanish) and rises him out of the pool (Emerge); the sweep off the pool is
  // his flourish, fired by the Reaping Scythe's cue.
  bastion_vael: {
    url: `${CREATURES}/vael_reaper.glb`,
    height: 9.21,
    hover: 0.406,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [VAEL_MIST_SURGE]: 'Cast',
        [VAEL_DROWNING_HYMN]: 'Hymn',
        [VAEL_SHADOWSTEP]: 'Vanish',
        [VAEL_REAPING_SCYTHE]: 'Emerge',
        // The Fog Veil: all four figures rise out of the roof the same way.
        [VAEL_VEIL_RISE]: 'Emerge',
        // His entrance: he rises out of the roof at each stop (the veil's
        // pace), and sinks back under it (also the sink before each veil).
        [VAEL_INTRO_RISE]: 'Emerge',
        [VAEL_SINK]: 'Vanish',
        // The fog gathering before the veil: he raises the lantern and sings it in.
        [VAEL_VEIL_GATHER]: 'Hymn',
      },
      // The veil's rise is twice the Emerge clip's length: played at bar pace
      // it rises ONCE over the whole bar (looped at rate 1 it rose, dropped
      // back under and rose again). The entrance's rises share its bar.
      castTimeScaleByAbility: {
        [VAEL_VEIL_RISE]: VAEL_VEIL_RISE_CLIP_RATE,
        [VAEL_INTRO_RISE]: VAEL_VEIL_RISE_CLIP_RATE,
      },
      // Emerge starts under the flags: it takes the body at once, never
      // crossfading out of a standing pose (a copy popping in upright).
      castSnapIn: ['Emerge'],
      flourish: 'ScytheSweep',
    },
    // The sink and the rises follow their bars (the Shadow Crossing's sink
    // would otherwise run late behind a swing, so the sim moved him to the
    // pool while he still stood above the floor); the Hymn and the Mist Surge
    // keep looping.
    castClipSync: [
      VAEL_SHADOWSTEP,
      VAEL_REAPING_SCYTHE,
      VAEL_VEIL_RISE,
      VAEL_INTRO_RISE,
      VAEL_SINK,
    ],
    authoredAtlas: true,
    selfIllumination: 0.06,
    clickRadius: 2.2,
  },

  // The Wreckbound Sailor keeps the stable crawler visual key. Custom Blender
  // sculpt, ragged naval clothes and a spectral wake; no crab geometry remains.
  bastion_crawler: {
    url: `${CREATURES}/bastion_ghost_sailor.glb`,
    height: 2.8,
    hover: 0.2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.2,
    deathTimeScale: 1,
  },
  // The Bastion Warhound: one of the garrison's war mastiffs, drowned with its
  // handlers and risen with them (scripts/assets/sunken_bastion_drowned/
  // warhound/: the quadruped sculpt kit). Gaunt and slack-hided, the ribs
  // standing out and a hole torn through the left flank to the bone, a snarl
  // of yellowed teeth under an iron chamfron, sea light in its eyes and throat;
  // a spiked iron war collar with a snapped chain, a quilted war-coat with
  // riveted lames down the spine and the Bastion's caparison on the flanks,
  // barnacled and hung with kelp. Its Lunge flies in the Leap pose (held while
  // airborne) and lands on Land; Attack is a lunging bite with a tearing
  // shake, Attack2 rears up and slams both forepaws down; Howl is its
  // flourish, and Pack Frenzy plays it through the gesture hook when a fallen
  // packmate quickens it (sunken_bastion/bastion_trash_fx.ts). walkRef/runRef
  // are the clips' own foot speeds at the drawn size.
  bastion_warhound: {
    url: `${CREATURES}/bastion_warhound.glb`,
    height: 3.55,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      jump: 'Leap',
      land: 'Land',
      stunned: 'Stunned',
      flourish: 'Howl',
      attackByAbility: { [BASTION_PACK_HOWL_GESTURE]: 'Howl' },
      attackTimeScaleByAbility: { [BASTION_PACK_HOWL_GESTURE]: 1 },
    },
    walkRef: 2.22,
    runRef: 8.07,
    authoredAtlas: true,
    selfIllumination: 0.14,
  },
  // The Shackled Prisoner: one of the gaol's chained dead, sculpted whole on
  // the drowned kit (scripts/assets/sunken_bastion_drowned/prisoner/): a
  // starved grey body with every rib standing out, a long matted mane of weed
  // over a grinning drowned face, rag breeches, iron manacles, collar and an
  // ankle shackle with their chains snapped short. Hunched and twitching, he
  // lurches dragging the shackled foot and fights like a cornered animal: both
  // fists hammered down (Attack), a lunge for the throat (Attack2). When his
  // chains snap (Snapped Fetters) he flings his arms wide and drops to his
  // knees (Kneel, through the gesture hook) and holds there (KneelLoop, held
  // while the aura lasts) until he leaves the world.
  bastion_prisoner: {
    url: `${CREATURES}/drowned_prisoner.glb`,
    height: 4.6,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      attackByAbility: { [BASTION_FETTERS_KNEEL_GESTURE]: 'Kneel' },
      attackTimeScaleByAbility: { [BASTION_FETTERS_KNEEL_GESTURE]: 1 },
      heldByAura: { [BASTION_SNAPPED_FETTERS]: 'KneelLoop' },
    },
    walkRef: 1.21,
    runRef: 5.7,
    authoredAtlas: true,
    selfIllumination: 0.1,
  },
  // The Gaol Turnkey: the drowned jailer, sculpted whole on the drowned kit
  // (scripts/assets/sunken_bastion_drowned/turnkey/): a vast bloated body,
  // bare swollen arms crusted with barnacles, a studded leather jerkin and a
  // long apron, an executioner's leather hood with sea light in its eye holes,
  // an iron collar and its snapped chain, the great ring of keys in his right
  // fist, a chain wound on his left forearm and the gaol's lantern at his hip.
  // He flails the ring overhead and down (KeySwing) and lashes the chain off
  // his forearm (ChainLash); opening the cells he takes the lantern off his
  // hip and hoists it high, rattling the keys (LanternRaise, played from the
  // lantern flare in sunken_bastion/bastion_creature_fx.ts at the top of the
  // raise); the Iron Cage's bar is the ring held up and shaken (Cast).
  bastion_turnkey: {
    url: `${CREATURES}/gaol_turnkey.glb`,
    // The gaol's miniboss: drawn at a boss's size (about 8.3 at its 1.3),
    // over three players tall.
    height: 6.4,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['KeySwing', 'ChainLash'],
      attackByAbility: { [BASTION_OPEN_CELLS_GESTURE]: 'LanternRaise' },
      attackTimeScaleByAbility: { [BASTION_OPEN_CELLS_GESTURE]: 1 },
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    walkRef: 2.17,
    runRef: 6.65,
    authoredAtlas: true,
    selfIllumination: 0.14,
  },
  // The Turnkey's Iron Cage and Ossick's Drowned Anchor (scripts/assets/
  // sunken_bastion_creatures/gaol_props.py): hittable encounter bodies. The
  // cage drops onto its prisoner (the sim lowers it through pos.y) with its
  // snapped chain swinging; both rattle when struck. Authored at size.
  bastion_gaol_cage: {
    url: `${CREATURES}/gaol_cage.glb`,
    height: 8.27,
    hover: -0.33,
    clips: {
      idle: 'Idle',
      walk: 'Idle',
      run: 'Idle',
      attack: ['Idle'],
      hit: ['Hit'],
      death: 'Idle',
    },
    authoredAtlas: true,
    clickRadius: 2,
  },
  bastion_drowned_anchor: {
    url: `${CREATURES}/drowned_anchor.glb`,
    height: 6.64,
    hover: -0.07,
    clips: {
      idle: 'Idle',
      walk: 'Idle',
      run: 'Idle',
      attack: ['Idle'],
      hit: ['Hit'],
      death: 'Idle',
    },
    authoredAtlas: true,
    clickRadius: 1.8,
  },

  // Shipwreck Captain: authored naval apparition, with gestures timed to the
  // authoritative encounter bars. Stable key preserves existing consumers.
  mob_turretback: {
    url: `${CREATURES}/bastion_ghost_captain.glb`,
    height: 7.5,
    hover: 0.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack', 'Attack2'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [GHOST_CAPTAIN_BROADSIDE]: 'Broadside',
        [GHOST_CAPTAIN_ANCHOR]: 'Anchor',
        [GHOST_CAPTAIN_BOARDING]: 'Boarding',
      },
      castTimeScaleByAbility: {
        [GHOST_CAPTAIN_BROADSIDE]: 1,
        [GHOST_CAPTAIN_ANCHOR]: 1,
        [GHOST_CAPTAIN_BOARDING]: 1,
      },
    },
    authoredAtlas: true,
    selfIllumination: 0.2,
    deathTimeScale: 1,
    clickRadius: 2.25,
  },

  // -- the Drowned Temple (sim/content/drowned_temple.ts, temple.ts) ----------
  // The lagoon temple's own roster, each its own Blender body (scripts/assets/
  // drowned_temple_creatures/), all well past the player's size, each with
  // the clips of its jobs. Heights allow for the templates' own scale, so the
  // drawn sizes land at about 2x the player for the trash, 3x for the bosses'
  // kin and far more for the Colossus and Ysolei. Presentation only.
  // The Nacre Templeguard (drowned_templeguard; scripts/assets/
  // drowned_temple_creatures/templeguard_seahorse/): a living nacre statue of a
  // temple knight with a seahorse's head and fan crest, ridged plate over
  // white coral, a coral-and-nacre trident and a scallop shield. It fights from
  // a braced guard (CombatIdle), thrusts (Attack) and shield-bashes (Attack2),
  // and runs with the trident couched like a lance (Run, which also carries
  // the heroic Onrush dash: a mob's charge is plain fast movement, so the
  // warrior-only rush/rushArrival slots stay unmapped). Both casts are
  // bar-locked one-shots that strike on the bar's end: Trident Sweep (1.5 s)
  // swings at 1.5, Skewering Trident (1.8 s) throws at 1.8, the trident flying
  // down the lane while a water trident re-forms in its fist. Dying, its light
  // bursts out and it slumps into a heap of plate and pearls. Drawn 5.5 to the
  // crest at its 1.1 (2.1 players).
  temple_templeguard: {
    url: `${CREATURES}/temple_templeguard.glb`,
    height: 5.0,
    clips: {
      ...TEMPLE_CLIPS,
      combatIdle: 'CombatIdle',
      castByAbility: {
        [TEMPLE_TRIDENT_SWEEP]: 'TridentSweep',
        [TEMPLE_SKEWERING_TRIDENT]: 'Hurl',
      },
      castTimeScaleByAbility: { [TEMPLE_TRIDENT_SWEEP]: 1, [TEMPLE_SKEWERING_TRIDENT]: 1 },
      castPlayOut: ['TridentSweep', 'Hurl'],
    },
    walkRef: 1.43,
    runRef: 6.13,
    castClipSync: true,
    castPlayOutHoldsAttacks: true,
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // The Drowned Pilgrim (drowned_pilgrim; scripts/assets/drowned_temple_creatures/
  // pilgrim_snail/, built as the design's "Tide Pilgrim"):
  // a giant sacred sea snail with a moon shrine on its carved nacre shell. It
  // glides on a pedal wave, darts its snout (Attack) and crashes its shell
  // down (Attack2); below 30 percent its enrage rears it up and blazes the
  // shrine violet (Frenzy, played off the enrage's nova through the temple's
  // gesture hook); dying, it pulls into its shell, topples and its pearl goes
  // dark. Drawn about 4.65 tall to the shrine at its 0.95 (1.8 players).
  temple_pilgrim: {
    url: `${CREATURES}/temple_pilgrim.glb`,
    height: 4.9,
    clips: {
      ...TEMPLE_CLIPS,
      attackByAbility: { [TEMPLE_PILGRIM_FRENZY_GESTURE]: 'Frenzy' },
      attackTimeScaleByAbility: { [TEMPLE_PILGRIM_FRENZY_GESTURE]: 1 },
    },
    // A swing landing mid-frenzy must not cut the rear and the violet blaze short.
    oneShotsHoldAttacks: ['Frenzy'],
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // The Pale Choir Acolyte (pale_choir_acolyte; scripts/assets/
  // drowned_temple_creatures/acolyte_moonjelly/): a novice of the moon choir
  // the water remade, hovering a hand above the floor. The bell of a moon
  // jelly is her hood (its four rings glowing through it), a serene face with
  // closed eyes sings under its brim; a nacre bodice, and below the waist a
  // skirt of sea-silk, two frilled oral arms and a veil of frills and
  // tentacles trailing to the floor, all on follow-through chains. She glides
  // (Walk, Run). The Pale Hymn is a petSpell bolt: its 0.6 s windup cue plays
  // the attack clips (Attack: both hands throw the frost dart as the bell
  // snaps open; Attack2: a one-handed strike), authored at their own pace so
  // the dart leaves on the release. Lullaby (2.0 s bar) opens the bell wide
  // and wheels its rings while she sways; Pale Mending (2.5 s bar) reaches
  // her hands and oral arms to the ally with a ball of cyan light. Both are
  // bar-locked with no play-out, so a kick breaks the song visibly. Dying,
  // the bell crumples and she sinks through the floor into a moonlit pool.
  // Drawn 5.2 to the bell's crown at her 1.0 (2 players).
  temple_acolyte: {
    url: `${CREATURES}/temple_acolyte.glb`,
    height: 5.2,
    clips: {
      ...TEMPLE_CLIPS,
      castByAbility: { [TEMPLE_LULLABY]: 'Lullaby', [TEMPLE_PALE_MENDING]: 'Mend' },
      castTimeScaleByAbility: { [TEMPLE_LULLABY]: 1, [TEMPLE_PALE_MENDING]: 1 },
    },
    attackTimeScale: 1,
    walkRef: 2.5,
    runRef: 7,
    castClipSync: true,
    authoredAtlas: true,
    selfIllumination: 0.05,
  },
  // The Moonlit Siren (moonlit_siren; scripts/assets/drowned_temple_creatures/
  // siren_spout/): a tall priestess of the moon choir whose body turns to a
  // fish tail below the waist. She never crawls: a waterspout winds round
  // her tail from the floor to her hips and holds her upright (it whirls one
  // turn a loop). Floating silver hair, fin ears, a crescent crown hung with
  // pearls, a coral staff crowned with a moon pearl. Brine Lash is a petSpell
  // bolt: its 0.6 s windup cue plays the attack clips (Attack: a staff blow;
  // Attack2: the staff levelled and cracked like a whip, the pearl flaring),
  // both authored to release on the windup's end. Call the Tide (2.5 s bar)
  // plays Sing: arms wide, staff high, the spout swells and three bubbles of
  // tide fly out as the bar ends, where the sim raises the Tidewisps;
  // bar-locked with no play-out, so a kick breaks the song visibly. Dying, the
  // spout falls away and she sinks into a pool of foam. Drawn 6.0 at her 1.0.
  temple_siren: {
    url: `${CREATURES}/temple_siren.glb`,
    height: 6.0,
    clips: {
      ...TEMPLE_CLIPS,
      // Call of the Shallows (the trash pass's second wave) sings on the same
      // clip, bar-locked so a kick or a broken song stops it visibly.
      castByAbility: { [TEMPLE_CALL_THE_TIDE]: 'Sing', [TEMPLE_CALL_OF_THE_SHALLOWS]: 'Sing' },
      castTimeScaleByAbility: { [TEMPLE_CALL_THE_TIDE]: 1, [TEMPLE_CALL_OF_THE_SHALLOWS]: 1 },
    },
    attackTimeScale: 1,
    walkRef: 2.5,
    runRef: 7,
    castClipSync: true,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // The Ice Wraith (ice_wraith; shipped by
  // scripts/assets/specs/drowned_temple_ice_wraith.json): a legless spirit of
  // blue ice hovering on a shard tail under a cloak and halo of loose
  // crystals, each arm ending in three long talons that reach the floor. It
  // glides (Walk carries Run too: nothing steps), rakes overhand with its
  // right claw (Attack), flinches (HitReact) and has its own Death. It ships
  // no cast clip: Static Coil, Lightning Spit and the Arcing Spark run their
  // bars over its hover, read from their floor marks and their lightning. A
  // clip for one of them is a castByAbility entry in this row. Its hover
  // dips its talons a third of a yard under its rest height, so it is drawn
  // that much off the floor, and its Death (a heap of shards) settles back
  // onto it. Drawn 4.8 to its crest at its 1.2 (nearly two players).
  temple_ice_wraith: {
    url: `${CREATURES}/temple_ice_wraith.glb`,
    height: 4.0,
    hover: 0.3,
    deathGroundOffset: 0.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Walk',
      attack: ['Attack'],
      hit: ['HitReact'],
      death: 'Death',
    },
    walkRef: 2.5,
    runRef: 7,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // The Lagoon Snapper (lagoon_snapper; scripts/assets/
  // drowned_temple_creatures/snapper_nautilus/): a giant sacred nautilus, its
  // spiral shell standing like a wheel (turquoise tiger stripes, a glowing
  // nacre lip, silver crescent medallions with pearls in its navel), a fleshy
  // hood, lidless eyes with a slit of light, a crown of tentacles round a
  // blue-black beak. Its swings part the tentacles and strike with the beak.
  // Snap (1.5 s bar) plays Snap: the crown gathers, the shell rocks back, the
  // beak shoots out with every tentacle flung open on the bar's end. Shell Up
  // is a self-stun, so its stunned loop (ShellUp) holds while it lasts: the
  // tentacles drawn in, the hood shut over the aperture. Dying, the shell tips
  // onto its side. Drawn 4.6 at its 1.2.
  temple_snapper: {
    url: `${CREATURES}/temple_snapper.glb`,
    height: 3.83,
    clips: {
      ...TEMPLE_CLIPS,
      stunned: 'ShellUp',
      castByAbility: { [TEMPLE_SNAP]: 'Snap' },
      castTimeScaleByAbility: { [TEMPLE_SNAP]: 1 },
    },
    walkRef: 2.0,
    runRef: 5.0,
    castClipSync: true,
    authoredAtlas: true,
    selfIllumination: 0.08,
  },
  // The Pearlguard Sentinel (pearlguard_sentinel; scripts/assets/
  // drowned_temple_creatures/sentinel_manta/, reworked in round two): the
  // Moonmantle Ray, a giant sacred manta of moonlight gliding a yard over the
  // flags. A thick, muscled disc: its back the deep night-sea blue with pearl
  // chevrons on the shoulders and nine raised nacre plates carved with the
  // moon's phases (new moon on its left wingtip to full on its right); the
  // wings thin to edges of clear cyan with a filament of light inside;
  // underneath, a pale pearl heart of the belly fading to turquoise strewn
  // with stars, deep gill slits and a keel. Its cephalic lobes run forward
  // into one silver crescent moon standing round its heart pearl (a sculpted
  // pearl lit from within, a crescent carved on its face); a whip tail ends
  // in pointed tide-glass. Idle: a slow wave rolling out along the wings.
  // Walk glides on deep beats, Run (also its Onrush) darts risen with the
  // wings swept back like an arrowhead; walkRef/runRef are the glide speeds
  // those beats are authored for (its wander and its chase). Attack: a cut
  // with the right wing's edge (CONTACT 0.42); Attack2: the tail arched over
  // its back and lashed down (0.5). Pearl Slam (1.5 s bar) plays Slam: it
  // rears up on its tail, wings opened high, and drives them down on the bar's
  // end. Pearl Carapace: temple_fx swaps the rig to its cocoon stance (the
  // wings wrapped under its belly, moon plates out, ShellClose to enter,
  // ShellOpen bursting free). Dying, it sinks to the floor and its wing light
  // goes out from the tips inward, the pearl last. `hover` is its Idle's
  // lowest point (the tail tip), so the floor of the model stays the floor of
  // the world; drawn 1.52 high at rest and still 6.8 wingtip to wingtip at
  // its 1.15 (the thicker body makes it a little taller per unit of span).
  temple_sentinel: {
    url: `${CREATURES}/temple_sentinel.glb`,
    height: 1.3236,
    hover: 0.673,
    clips: SENTINEL_CLIPS,
    phaseClips: {
      [TEMPLE_SENTINEL_SHELL_OPEN]: { clips: SENTINEL_CLIPS, enter: 'ShellOpen' },
      [TEMPLE_SENTINEL_SHELL_CLOSED]: { clips: SENTINEL_SHELL_CLIPS, enter: 'ShellClose' },
    },
    walkRef: 2.4,
    runRef: 6.5,
    castClipSync: true,
    authoredAtlas: true,
    selfIllumination: 0.08,
  },
  // The Glimmerscale Lurker (glimmerscale_lurker; scripts/assets/
  // drowned_temple_creatures/lurker_mantis/): a giant mantis shrimp the
  // moon-water made sacred, long, low and armoured in iridescent plates
  // (turquoise to violet, pearl rims, a carved crescent on every tergite;
  // round two sculpts the armour: keels down every plate, hooked pleura down
  // its flanks, swimmerets, a ribbed shield and a rostral spine, ringed and
  // spurred legs, a combed propodus and a hammer-ringed club, a pitted shell),
  // its front half reared, eyes on turning stalks banded in silver, two
  // raptorial arms folded like jackknives, a tail fan of nacre paddles. Its
  // swings snap the arms out (Attack: both, Attack2: one; contact at 0.16).
  // Pounce flies in the Leap pose (arms flung open) and lands on Land. Glimmer
  // Venom (2.0 s bar) plays Spit: it rears back with the glowing bolus swelling
  // in its mouth and spits as the bar ends; bar-locked, so a kick shows.
  // Dying, it rolls onto its back and its flank lights go out one by one.
  // Drawn 4.4 at the reared front at its 1.2 (about 7 long): the design's 3.6
  // read smaller than the player beside its long low body, so it grew to
  // stay imposing.
  temple_lurker: {
    url: `${CREATURES}/temple_lurker.glb`,
    height: 3.65,
    clips: {
      ...TEMPLE_CLIPS,
      jump: 'Leap',
      land: 'Land',
      // The trash mechanics pass: the Prism Glare plays Cast (reared, head
      // back, the stalked eyes swinging), its rainbow eye temple_trash_fx's.
      castByAbility: { [TEMPLE_GLIMMER_VENOM]: 'Spit', [TEMPLE_PRISM_GLARE]: 'Cast' },
      castTimeScaleByAbility: { [TEMPLE_GLIMMER_VENOM]: 1, [TEMPLE_PRISM_GLARE]: 1 },
    },
    walkRef: 2.6,
    runRef: 7.2,
    castClipSync: true,
    authoredAtlas: true,
    selfIllumination: 0.1,
  },
  // The bosses. Choirmother Selthe (choirmother_selthe; scripts/assets/
  // drowned_temple_creatures/selthe_matriarch/): the siren matriarch, built
  // on the Moonlit Siren's skeleton but broad and heavy in the game's
  // stylized way (round two: a deep ribcage, strong shoulders and arms, a
  // thicker coil, a larger head with a heavy scowling brow, glowing slit
  // eyes, two small fangs and the lionfish's violet bars across her face,
  // arms and flanks), a vast lionfish fan opening
  // behind her like the pipes of an organ (silver rays, pearl tips, sheer
  // turquoise to violet fins), her tail coiled in the pool of moonlit water
  // she rides, the golden Great Conch on her chest, a jaw that drops too far
  // when she sings. Sea-Song (1.5 s bar) plays SeaSong: arms wide, head back,
  // the mouth wide, the fan shivering, the song on the bar's end. She is a
  // caster and never swings her hands: Moonwater Bolt (2.0 s bar) plays Bolt,
  // water gathered at her shoulder and flung on the bar's end; Mere Surge
  // (3.0 s bar) plays Surge, sinking into the pool and hurling the wave on the
  // bar's end; the Drowning Aria (a 5 s channel) loops Beam, both arms thrust
  // at her target. The bolt and the surge finish their follow-through. Her old
  // Slap and claw swings stay in the file, unplayed. The Chorus and Solo marks
  // arrive as windup cues and play Chorus (the conch raised and blown, the fan
  // folding in) and Solo (one arm raised,
  // the fan flung wide). Dying, the fan folds and she sinks into her pool,
  // leaving the conch glowing on the floor. Drawn 9.0 at her 1.15.
  temple_selthe: {
    url: `${CREATURES}/temple_selthe.glb`,
    height: 7.83,
    clips: {
      ...TEMPLE_CLIPS,
      castByAbility: {
        [SELTHE_SEA_SONG]: 'SeaSong',
        [SELTHE_MOONWATER_BOLT]: 'Bolt',
        [SELTHE_DROWNING_ARIA]: 'Beam',
        [SELTHE_MERE_SURGE]: 'Surge',
      },
      castTimeScaleByAbility: {
        [SELTHE_SEA_SONG]: 1,
        [SELTHE_MOONWATER_BOLT]: 1,
        [SELTHE_DROWNING_ARIA]: 1,
        [SELTHE_MERE_SURGE]: 1,
      },
      castPlayOut: ['Bolt', 'Surge'],
      attackByAbility: { [SELTHE_CHORUS_MARK]: 'Chorus', [SELTHE_SOLO_MARK]: 'Solo' },
      attackTimeScaleByAbility: { [SELTHE_CHORUS_MARK]: 1, [SELTHE_SOLO_MARK]: 1 },
    },
    attackTimeScale: 1,
    walkRef: 2.5,
    runRef: 7,
    // The bars land on their end; the aria's beam loops.
    castClipSync: [SELTHE_SEA_SONG, SELTHE_MOONWATER_BOLT, SELTHE_MERE_SURGE],
    castPlayOutHoldsAttacks: true,
    authoredAtlas: true,
    selfIllumination: 0.06,
  },
  // The Tideglass Colossus (tideglass_colossus; scripts/assets/
  // drowned_temple_creatures/colossus_tideglass/, recut in round two): a giant
  // of hard sea-glass, every block of it a cut gem (the builder's gem.py: flat
  // facets and sharp edges, each facet its own depth of teal, a bright rim on
  // every edge), the light inside it breaking out of the seams between the
  // blocks and along a few long fractures, pointed violet spires bursting from
  // its shoulders, spine, elbows and knees, a low scowling head with two
  // slanting slits of light under a crown of crystal horns, silver bands with
  // moons, and in its chest, in a nacre-lined socket held by a silver crescent
  // ringed with pearls, the prism: the cut gem of silver and violet that casts
  // the Reflections. It walks its foe down (Walk, Run). Prism Flare (2.0 s
  // bar) plays Flare: arms flung wide, the prism blazing on the bar's end.
  // Moonlight Lance (2.0 s bar) plays Lance: the prism levelled along its
  // pointing arm. Resonant Slam (1.5 s bar) plays Slam: both fists into the
  // floor and a ring of broken crystal. Heroic's Reflection swap arrives as a
  // windup cue: PrismPulse. Dying, it kneels, topples and breaks into crystal
  // over a pool of water. Its body keeps the old 15-unit scale under the
  // template's 2.2 (its long reach); the pointed spires now rise past it, so
  // the drawn bounds are 16.7. The env boost matches its Reflections' glass:
  // the temple's dim environment runs across its glossy facets.
  temple_colossus: {
    url: `${CREATURES}/temple_colossus.glb`,
    height: 16.7 / 2.2,
    clips: {
      ...TEMPLE_CLIPS,
      castByAbility: {
        [COLOSSUS_PRISM_FLARE]: 'Flare',
        [COLOSSUS_MOONLIGHT_LANCE]: 'Lance',
        [COLOSSUS_RESONANT_SLAM]: 'Slam',
      },
      castTimeScaleByAbility: {
        [COLOSSUS_PRISM_FLARE]: 1,
        [COLOSSUS_MOONLIGHT_LANCE]: 1,
        [COLOSSUS_RESONANT_SLAM]: 1,
      },
      attackByAbility: { [COLOSSUS_PRISM_FLARE]: 'PrismPulse' },
      attackTimeScaleByAbility: { [COLOSSUS_PRISM_FLARE]: 1 },
    },
    attackTimeScale: 1,
    walkRef: 1.4,
    runRef: 3.48,
    castClipSync: true,
    authoredAtlas: true,
    selfIllumination: 0.06,
    envMapIntensity: 2.2,
  },
  // The Moonspawn (moonspawn; scripts/assets/drowned_temple_creatures/
  // moonspawn_tide/): Ysolei's summoned add had no body of its own and drew
  // as the overworld murloc. Now a spirit of the Drowned Moon: a lizard of
  // living moonlit water, a crescent of nacre arched over its back and
  // another on its brow, glowing eyes and glassy teeth. It climbs out of the
  // flooded shore when it is called (Rise, its entrance: temple_fx offers the
  // gesture the moment it appears), runs low and fast, bites (Attack) and
  // rakes (Attack2), and dying pours back into a pool of water. Drawn 3.5
  // at its 0.9.
  temple_moonspawn: {
    url: `${CREATURES}/temple_moonspawn.glb`,
    height: 3.89,
    clips: { ...TEMPLE_CLIPS, entrance: 'Rise' },
    entranceGesture: TEMPLE_MOONSPAWN_RISE,
    walkRef: 3,
    runRef: 8,
    authoredAtlas: true,
    selfIllumination: 0.1,
  },
  // Ysolei, Avatar of the Drowned Moon: the colossal lunar sea-serpent built
  // in Blender by Codex (sources on the codex/ysolei branch; original work, no
  // donor assets), coiled on the Moon Altar. Native scale is kept: her raised
  // head stands about seven players tall. Her Idle measures 23.97 native units
  // (the halo's top to the coil's underside, 0.34 under her pivot), so at the
  // template's 2.5 scale the height is 23.97 / 2.5 and the hover sinks the
  // coil's underside back under the floor. Authored PBR materials (no atlas,
  // no tint). Each clip rides a real cast bar: Lunar_Tide (1.5 s charge, then
  // the wave), Undertow (the 3 s channel, jaws wide; the crash plays out),
  // Summon (Moonspawn Call), Enrage (Drowned Wrath); Bite and Tail_Sweep are
  // her swings, Rise her flourish on a reset, and she is stationary.
  temple_ysolei: {
    url: `${CREATURES}/temple_ysolei.glb`,
    height: 23.97 / 2.5,
    hover: -0.339 / 2.5,
    authoredAtlas: true,
    // The widest override the click-capsule guard allows (2x CLICK_RADIUS_CAP,
    // tests/nythraxis_bone_spike_model.test.ts): wider swallows the raid's clicks.
    clickRadius: 4.4,
    clips: {
      idle: 'Idle',
      walk: 'Idle',
      run: 'Idle',
      attack: ['Bite', 'Tail_Sweep'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Summon',
      flourish: 'Rise',
      castByAbility: {
        [YSOLEI_LUNAR_TIDE]: 'Lunar_Tide',
        [YSOLEI_UNDERTOW]: 'Undertow',
        [YSOLEI_CALL]: 'Summon',
        [YSOLEI_WRATH]: 'Enrage',
      },
      castTimeScaleByAbility: {
        [YSOLEI_LUNAR_TIDE]: 1,
        [YSOLEI_UNDERTOW]: 1,
        [YSOLEI_CALL]: 1,
        [YSOLEI_WRATH]: 1,
      },
      castPlayOut: ['Lunar_Tide', 'Undertow', 'Summon', 'Enrage'],
    },
    castPlayOutHoldsAttacks: true,
  },
  // The Mere Hydra's three heads: bodyless targets (the click capsule stays),
  // the one Hydra model drawn at the pool by drowned_temple/temple_hydra.ts.
  temple_hydra_head: {
    url: `${CREATURES}/mere_hydra.glb`,
    height: 14,
    clips: {
      idle: 'Idle',
      walk: 'Idle',
      run: 'Idle',
      attack: ['Snap'],
      hit: ['Hit'],
      death: 'Death',
    },
    bodyless: true,
    clickRadius: 2.6,
  },
  // A Tidewisp (tidewisp; scripts/assets/drowned_temple_creatures/
  // tidewisp_drop/): its own body now, no longer the overworld glimmerwisp.
  // A great drop of moon-water the siren's song lifts from her spout: clear
  // turquoise lit from inside, its point curled back like a flame, a silver
  // crescent in its face that turns faster as it rushes in, motes of water
  // circling it and a trail of falling drops. It reaches its mark and dies
  // there in Tidewisp Burst: Death is the burst (a swell, then a ring of
  // frost and a spray of drops). Drawn 2.2 with its trail at its 0.8.
  temple_tidewisp: {
    url: `${CREATURES}/temple_tidewisp.glb`,
    height: 2.75,
    hover: 0.45,
    clips: TEMPLE_CLIPS,
    walkRef: 2.5,
    runRef: 7,
    authoredAtlas: true,
    selfIllumination: 0.12,
  },

  // -- humanoid mobs (KayKit adventurers) ------------------------------------
  mob_bandit: {
    url: `${PLAYERS}/rogue_hooded.glb`,
    animUrls: [`${PLAYERS}/rogue_hooded_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Chop']),
    // v2 rogue_hooded ships the hood/mask/cape as its default look (no show
    // filter needed); the knives are attached dual-wield from the weapon files
    attach: [
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
    ],
    // fixed outlaw leather — entity tints (faction greens) read as friendly
    // villagers; the dark red-brown keeps the hooded silhouette hostile
    tint: 0x6b3a32,
    tintStrength: 0.3,
  },
  mob_dark_caster: {
    url: `${PLAYERS}/mage.glb`,
    animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.5,
  },
  mob_bruiser: {
    url: `${PLAYERS}/barbarian.glb`,
    animUrls: [`${PLAYERS}/barbarian_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Barbarian_BearHat'], // v2 barbarian: Hat→BearHat, no Cape, weapon now attached
    attach: [{ url: `${WEAPONS}/axe_2handed.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.3,
  },

  // -- NPCs ------------------------------------------------------------------
  npc_knight: {
    url: `${PLAYERS}/knight.glb`,
    animUrls: [`${PLAYERS}/knight_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: ['Knight_Helmet', 'Knight_Cape'],
    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_mage: {
    url: `${PLAYERS}/mage.glb`,
    animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 0xc9b98a,
    tintStrength: 0.3, // brown-robed brothers of the chapel
  },
  // Brother Aldric's pre-v0.7 model (the old chars/mage.glb, restored as
  // mage_classic.glb with the staff built into the mesh). He wears an authored
  // look on the priest's WOC body now (npc_looks.ts), so this is only his stock
  // rig: nothing in the world draws it, and its files are fetched on demand
  // rather than in every client's boot download (they are named by no other def).
  npc_aldric: {
    url: `${PLAYERS}/mage_classic.glb`,
    animUrls: [`${PLAYERS}/mage_classic_hit_variety_anims.glb`],
    lazyPreload: true,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff'],
    tint: 0xc9b98a,
    tintStrength: 0.3,
  },
  npc_smith: {
    url: `${PLAYERS}/barbarian.glb`,
    animUrls: [`${PLAYERS}/barbarian_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_scout: {
    url: `${PLAYERS}/rogue.glb`,
    animUrls: [`${PLAYERS}/rogue_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    show: ['Rogue_Cape'],
    attach: [{ url: `${WEAPONS}/crossbow_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_villager: {
    url: `${PLAYERS}/rogue.glb`,
    animUrls: [`${PLAYERS}/rogue_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Laverock, the Drowned Temple's lore guide (content/drowned_temple_cantor.ts):
  // the Blender-built old cantor (E:/woc/laverock-work/builder, adapted from the
  // Velkhar kit): bone-white habit, the stiff crescent stole, the nacre
  // medallion, the driftwood staff with its carved moon, the long beard and
  // hair. Built broad and rounded to sit beside the chibi player (wide
  // shoulders and a flared hem, a bigger head, big hands, a stout staff).
  // Normalized on the idle bounds (the staff's moon is the top) so his crown
  // stands about 2.97 yd, a head over the player. His gestures ride the
  // overhead emotes the guide sets as he speaks (point = Talk, cry = Startle,
  // kneel = Kneel) and the song is his channel cast (cantor_last_verse, the
  // Sing loop). The Walk's long gliding stride covers 1.25 yd/s at this
  // scale, so the guide's 3.2 yd/s follow walk plays it about 2.6x with the
  // feet planted; the 7 yd/s catch-up run caps lower and slides a little.
  npc_laverock: {
    url: `${CREATURES}/temple_laverock.glb`,
    height: 3.75,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Walk',
      attack: ['Talk'],
      death: 'Idle',
      cast: 'Sing',
      castByAbility: { cantor_last_verse: 'Sing' },
      emote: {
        point: { clips: ['Talk'] },
        cry: { clips: ['Startle'] },
        kneel: { clips: ['Kneel'] },
      },
    },
    walkRef: 1.25,
    runRef: 1.25,
    walkTimeScaleMax: 2.8,
    runTimeScaleMax: 3.6,
    authoredAtlas: true,
    selfIllumination: 0.06,
    clickRadius: 0.9,
  },
  npc_villager_robed: {
    url: `${PLAYERS}/mage.glb`,
    animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Bursar Fernando: the villager body with the likeness atlas (SKINS above)
  // carrying black shoulder-length hair and light brown skin. No entity tint:
  // the gold NpcDef color would wash the repaint back toward the villager look.
  npc_fernando: {
    url: `${PLAYERS}/rogue.glb`,
    animUrls: [`${PLAYERS}/rogue_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
  },
  // Brother Halven, the Reliquary Keeper: a devout male guardian tending the crypt
  // door. Uses the KayKit paladin, one of the newer full-pack adventurer models
  // (unused elsewhere), for a sturdier, holier silhouette than the old hooded
  // rogue. Ships its accessories (helm/cape/shield) by default (no show filter).
  // He wears an authored look on the paladin's WOC body now (npc_looks.ts), so
  // this is only his stock rig: fetched on demand, like npc_aldric above.
  npc_reliquary_keeper: {
    url: `${PLAYERS}/paladin.glb`,
    animUrls: [`${PLAYERS}/paladin_hit_variety_anims.glb`],
    lazyPreload: true,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
  },
  // Edda Reedhand (The Drowned Litany companion NPC, healer): the druid player
  // rig, staff in hand, backpack authored on the model (a traveling marsh
  // herbalist). The earlier Meshy mesh clashed with the KayKit proportions; a
  // player rig also gives her the full clip set, so her heals play the real
  // Spellcasting channel. Fixed staff (no weaponSlots: NPC gear never changes).
  npc_edda_reedhand: {
    url: `${PLAYERS}/druid.glb`,
    animUrls: [`${PLAYERS}/druid_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
  },
  // Balgath as a CYCLOPS: the second silhouette for the same Mirefen world boss, so
  // the concept can be judged in engine against the foreman below rather than off
  // concept art. Quarried granite rather than a barrow-buried body, one Loom-shard
  // eye, iron shackle bands.
  //
  // It carries the FOREMAN's ability donor, not one of its own. Its own donor library
  // has no overhead reach and no real crouch, so clips authored against it came back
  // mediocre and mutually indistinguishable; the two rigs share 41 identically named
  // joints, so the foreman's authored poses bind here directly and are strictly
  // better. See the BALGATH ClipMap comment for the binding proof.
  // The Straw Foreman (content/mirefen_muster.ts muster_effigy): the muster's training
  // effigy of Balgath, half his height, built of planks, straw and rope with a lantern for
  // an eye (Blender factory scripts/assets/muster_effigy/, pinned by
  // tests/muster_effigy_asset.test.ts). A clipless prop mob (STATIC_PROP, CLIPLESS_RIGS):
  // everything that moves is the effigy rig (effigy_rig.ts): the plank hide falling and
  // being hammered back per viewer, the flame, the smoke. The lantern's glow is the same
  // lit-eye pair Balgath wears, hung on the model's LanternFlame anchor.
  mob_muster_effigy: {
    url: `${CREATURES}/muster_effigy.glb`,
    height: MUSTER_EFFIGY_HEIGHT,
    clips: STATIC_PROP,
    effigy: true,
    eyeGlow: {
      bone: 'LanternFlame',
      offset: [0, 0, 0],
      color: 0xffa94d,
      radius: 0.13,
      pulseHz: 0.9,
    },
    clickRadius: 1.8,
    lazyPreload: true,
  },
  mob_balgath_cyclops: {
    url: `${CREATURES}/balgath_cyclops.glb`,
    authoredAtlas: true, // baked Blender atlas: low-tier floor rides the map
    height: 3.2,
    clips: BALGATH,
    // Played at its authored speed: the dust, rock chips and camera shake of his landing
    // fire BALGATH_DEATH_IMPACT_SEC after the death edge (balgath_death_fx_core.ts), which
    // is the clip's own impact frame only at 1x (the shared default is 1.15).
    deathTimeScale: 1,
    // The Barrowglass, always burning. The iris itself is real geometry now, lit by the
    // GLB's own `BalgathGlow` material (with the star-light veins in his barrowhide); these
    // shells are its halo, and `selfLitMaterial` hands that iris to the same brightness
    // curve so it gutters out with the halo when he dies instead of burning on the corpse.
    // The offset is MEASURED (scripts/assets/balgath_cyclops/measure_eye.mjs on the raw
    // export): the front of the iris, the eyeball's centre pushed one radius plus the iris
    // relief down the gaze, resolved into the Head bone's frame. Radius 0.2 bone-local is
    // a 0.19-yard core at his 0.96 normalize-and-scale chain: the iris carries the colour,
    // so the core only has to light the socket, and a bigger shell washed the slit pupil
    // out.
    eyeGlow: {
      bone: 'Head',
      offset: [0, 1.22, 1.74],
      color: 0x5fe8d2,
      radius: 0.2,
      pulseHz: 0.45,
      selfLitMaterial: 'BalgathGlow',
    },
    // Gait refs MEASURED, not guessed, at the scale this boss actually spawns at (see the
    // BALGATH_WALK_REF comment). Re-measure if BALGATH_SCALE moves.
    walkRef: BALGATH_WALK_REF,
    runRef: BALGATH_RUN_REF,
    // A whisper of the template colour only: the Blender bake carries the granite, the
    // moss and the mire mud itself.
    tint: 0xa8a496,
    tintStrength: 0.06,
  },
  npc_chronicler: {
    url: `${PLAYERS}/mage.glb`,
    animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`],
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [
      { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
      {
        url: `${WEAPONS}/spellbook_open.glb`,
        bone: 'handslot.l',
        gripRef: 'Spellbook_open',
      },
    ],
    tint: 'entity',
    tintStrength: 0.55,
  },
  // Reedbound Acolyte (The Drowned Litany trash mob): Stone Cantor model from
  // the Raid 02 asset batch. The earlier Meshy mesh (reedbound_acolyte.glb) was
  // realistically proportioned and clashed with the chunky KayKit-style rigs;
  // this one matches the game's proportions, so the standard humanoid height
  // applies (the old def ran at 3.4 only to compensate for the thin mesh).
  mob_reedbound_acolyte: {
    url: `${CREATURES}/stone_cantor.glb`,
    height: HUMANOID_H,
    clips: RAID_CASTER,
    // The 2.6s Cast clip doubles as the vial-throw one-shot; at the default
    // 1.3x it fills nearly the whole 2.6s attack cadence, which reads
    // sluggish AND leaves no gap for the Hit flinch (one-shots never
    // interrupt one-shots). 1.7x makes the throw snap and frees ~1.1s of
    // every cycle for reactions.
    attackTimeScale: 1.7,
    tint: 'entity',
    tintStrength: 0.2,
  },
  // Spider Egg-Sac (Sinkhole Baptistry finale trigger, The Drowned Litany):
  // Meshy-generated static prop, no rig/clips (it never moves; it dies to a
  // single hit). The visual/animation pipeline no-ops gracefully when a clip
  // name below has no match in the GLB, so it just renders static, which is
  // exactly right for a stationary egg-sac.
  mob_spider_egg_sac: {
    url: `${CREATURES}/spider_egg_sac.glb`,
    height: 1.8,
    clips: {
      idle: 'Idle',
      walk: 'Idle',
      run: 'Idle',
      attack: ['Idle'],
      death: 'Idle',
    },
  },
  // Buried Hoard Healing Tide Totem. The quest prop is already a curated,
  // chunky carved totem and ships without clips, so it uses the static prop lane.
  mob_healing_tide_totem: {
    url: 'models/quest/ogre_war_totem.glb',
    height: 2.5,
    clips: STATIC_PROP,
    authoredAtlas: true,
    tint: 'entity',
    tintStrength: 0.35,
    selfIllumination: 0.14,
  },
  // Nyxaris's Bound Pulsar (src/sim/rift/hoard_pulsars.ts): an unbound orb holding
  // its station in the room. This body is the NUCLEUS alone, hovering where the
  // players can reach it, so targeting, the nameplate and the health bar are the
  // ordinary ones; its armour, rings, links and beam are drawn round it by
  // src/render/hoard_pulsars.ts. Original Blender art (docs/design/pulsars/), no
  // clips, so it uses the static prop lane.
  mob_bound_pulsar: {
    url: 'models/creatures/hoard_pulsar_core.glb',
    height: 1.5,
    hover: 2.25,
    clips: STATIC_PROP,
    selfIllumination: 0.9,
    clickRadius: 2,
  },
  // The Abyssal Maw's tentacle (src/sim/rift/hoard_tentacles.ts). This body is
  // only the ROOT COLLAR it grows out of, so targeting, the nameplate and the
  // health bar are the ordinary ones; the living tentacle, bent every frame, is
  // drawn over it by src/render/hoard_tentacles.ts. Original Blender art
  // (docs/design/tentacles/), no clips, so it uses the static prop lane. The
  // click volume is the standing tentacle's, not the collar's.
  mob_abyssal_tentacle: {
    url: 'models/creatures/hoard_tentacle_trunk.glb',
    height: 1.5,
    clips: STATIC_PROP,
    selfIllumination: 0.12,
    clickRadius: 2.2,
  },
  // The Buried Hoard (and rift) bosses with a body of their own, generated with
  // the asset pipeline (scripts/asset_pipeline/, see CREDITS.md) instead of their
  // family's shared model. Each atlas is authored, so none takes the entity tint.
  // Their heights are a boss's: about a third over the family models they replace
  // (playtest), which is a look only, the templates' scale and reach are untouched.
  // The Abyssal Maw: a four-legged abyssal angler. Tripo's quadruped auto-rig
  // folded his head under his chest and ships one walk preset, so his skeleton
  // (with a jaw, a tail, chin tentacles and the lure) and every clip are authored
  // in Blender: scripts/assets/hoard_bosses/maw_rig.py. Cast is his roar.
  mob_hoard_abyssal_maw: {
    url: `${CREATURES}/hoard_abyssal_maw.glb`,
    height: 2.3,
    // The generated model faces +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Hoarfrost Warden: generated arms-down and far too top-heavy for the local
  // KayKit rig, so he rides Tripo's biped rig. Its presets are repaired in Blender
  // (rigid gauntlet weights, arms relaxed to his sides) and his Attack is an
  // authored two-fisted slam: see CREDITS.md.
  mob_hoard_hoarfrost_warden: {
    url: `${CREATURES}/hoard_hoarfrost_warden.glb`,
    height: 2.6,
    // The Tripo rig rests facing +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      jump: 'Jump',
      // Authored in Blender (scripts/assets/hoard_bosses/frost_fix.py). Ice Age is
      // his held channel for the whole cast bar; the blast and the Whiteout Gust
      // frontal are one-shots the cue clock starts (hoard_boss_gestures_core.ts),
      // played at their authored speed so the key frame meets the hit.
      castByAbility: { [HOARD_CAST_ICE_AGE]: 'IceAge' },
      castTimeScaleByAbility: { [HOARD_CAST_ICE_AGE]: 1 },
      attackByAbility: {
        [HOARD_GESTURE_FROST_GUST]: 'FrostFrontal',
        [HOARD_GESTURE_ICE_AGE_RELEASE]: 'IceAgeRelease',
      },
      attackTimeScaleByAbility: {
        [HOARD_GESTURE_FROST_GUST]: 1,
        [HOARD_GESTURE_ICE_AGE_RELEASE]: 1,
      },
    },
    authoredAtlas: true,
    selfIllumination: 0.2,
  },
  // Emberforge Tyrant, Archon Nyxaris and Tempest Vharok were generated in a
  // T-pose and rigged locally onto the KayKit skeleton (rig-manual), so they carry
  // the full KayKit clip vocabulary and real handslot bones.
  mob_hoard_emberforge_tyrant: {
    url: `${CREATURES}/hoard_emberforge_tyrant.glb`,
    height: 2.6,
    // (The locally rigged bodies carry the knight's clip library: one hit clip.)
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
      // Started off the cue clock (hoard_boss_gestures_core.ts): he thrusts the
      // maul at the sky to call the Hammer of the Forge (authored,
      // scripts/assets/hoard_bosses/build_boss_gestures.mjs), and brings it down
      // on his frontal.
      attackByAbility: {
        [HOARD_GESTURE_CALL_HAMMER]: 'CallHammer',
        [HOARD_GESTURE_EMBER_FRONTAL]: '2H_Melee_Attack_Chop',
      },
      attackTimeScaleByAbility: {
        [HOARD_GESTURE_CALL_HAMMER]: 1,
        [HOARD_GESTURE_EMBER_FRONTAL]: 1,
      },
    },
    // He carries the hammer he calls down: the held variant of the arena model
    // (scripts/assets/hoard_bosses/held_forge_maul.mjs).
    attach: [{ url: `${WEAPONS}/hoard_forge_maul.glb`, bone: 'handslot.r' }],
    authoredAtlas: true,
    selfIllumination: 0.45,
  },
  // He FLOATS (the generated legs were taken out from under the robe in Blender):
  // he hovers, and glides on his idle instead of running on legs he does not have.
  mob_hoard_archon_nyxaris: {
    url: `${CREATURES}/hoard_archon_nyxaris.glb`,
    height: 2.4,
    hover: 0.45,
    clips: {
      ...kaykit(['Spellcast_Shoot']),
      hit: ['Hit_A'],
      walk: 'Idle',
      run: 'Idle',
      walkBack: 'Idle',
      // The whole Pulsar Overload bar is one held, breathing channel (authored).
      castByAbility: { [HOARD_CAST_PULSAR_OVERLOAD]: 'PulsarChannel' },
      castTimeScaleByAbility: { [HOARD_CAST_PULSAR_OVERLOAD]: 1 },
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  mob_hoard_tempest_vharok: {
    url: `${CREATURES}/hoard_tempest_vharok.glb`,
    height: 2.5,
    clips: {
      // He fights bare-clawed: a two-handed weapon chop with empty hands read as a
      // broken swing, and the dual-wield chop CROSSES the arms, which his long
      // clawed arms turn into a tangle (both playtest). One arm at a time: a
      // diagonal rake, a level swipe, a punch.
      // The open-handed rakes rolled his whole body (playtest): the right-hand punch alone.
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
      // He throws both claws at the sky to call the orbital storm (authored).
      attackByAbility: { [HOARD_GESTURE_CALL_STORM]: 'CallStorm' },
      attackTimeScaleByAbility: { [HOARD_GESTURE_CALL_STORM]: 1 },
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The hoard rooms' own rank and file (docs/design/boss-rooms/README.md): Tripo
  // bodies on the shared KayKit rig, so they carry its whole clip vocabulary.
  // The Abyssal Maw's drowned thrall fights with his hands.
  mob_hoard_tide_thrall: {
    url: `${CREATURES}/hoard_tide_thrall.glb`,
    height: 4.6,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The Coinsack Scurrier (src/sim/rift/hoard_goblin.ts): a small goblin under a
  // huge sack of stolen gold, on the shared KayKit rig. The sack and the face
  // are made rigid by scripts/assets/hoard_mobs/rigid_pack.mjs. It never
  // fights; its escape bar keeps it running, so the bar plays the run clip.
  mob_hoard_coinsack_scurrier: {
    url: `${CREATURES}/hoard_coinsack_scurrier.glb`,
    height: 2.0,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
      castByAbility: { [HOARD_GOBLIN_ESCAPE_CAST]: 'Running_A' },
      castTimeScaleByAbility: { [HOARD_GOBLIN_ESCAPE_CAST]: 1 },
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The Mother of Mushrooms, the first cave boss of the common and rare hoards
  // (content/rift/cave_themes.ts). A Tripo body on the shared KayKit rig, but her
  // arms reach nearly twice as far as the knight's: she is rigged onto a copy of
  // the rig with longer arms (scripts/assets/hoard_mobs/stretch_arms.mjs), her cap
  // is made rigid on the head (rigid_pack.mjs) and every loose growth on one bone
  // (rigid_islands.mjs). She casts her spores with her arms raised.
  mob_hoard_boss_mushroom: {
    url: `${CREATURES}/hoard_boss_mushroom.glb`,
    height: 2.2,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
      cast: 'Spellcast_Raise',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Deeprake, the burrowing mole of the cave hoards (src/sim/rift/hoard_mole.ts):
  // rigged and animated in Blender (scripts/assets/hoard_mobs/quadruped_rig.py,
  // specs/hoard_boss_mole.json). His scripted casts play their own clips: the
  // rake is his claw Attack slowed so the strike lands as the telegraph ends, the
  // burrow digs in, the tunnel holds him wholly under the floor, the collapse is
  // his rear-up slam timed to the cast.
  mob_hoard_boss_mole: {
    url: `${CREATURES}/hoard_boss_mole.glb`,
    height: 1.4,
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [HOARD_CAST_MOLE_RAKE]: 'Attack',
        [HOARD_CAST_BURROW]: 'Burrow',
        [HOARD_CAST_TUNNEL]: 'Underground',
        [HOARD_CAST_EMERGE]: 'Emerge',
        [HOARD_CAST_COLLAPSE]: 'Cast',
      },
      castTimeScaleByAbility: {
        // The strike (40% into the 0.96 s clip) lands as the 1.8 s telegraph ends.
        [HOARD_CAST_MOLE_RAKE]: 0.21,
        [HOARD_CAST_BURROW]: 0.94,
        [HOARD_CAST_TUNNEL]: 1,
        [HOARD_CAST_EMERGE]: 1,
        [HOARD_CAST_COLLAPSE]: 0.72,
      },
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The Colossal Bat of the cave hoards (src/sim/rift/hoard_bat.ts): rigged and
  // animated in Blender (scripts/assets/hoard_mobs/bat_rig.py,
  // specs/hoard_boss_bat.json). It never lands: every clip is a flying pose and
  // `hover` lifts it (the spec's hoverFrac, 0.35 of its height, which its Death
  // clip is tuned to so the corpse drops onto the floor). It takes aim flying in
  // place, dives with its wings folded, and screeches reared back.
  mob_hoard_boss_bat: {
    url: `${CREATURES}/hoard_boss_bat.glb`,
    height: 1.5,
    hover: 0.525,
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [HOARD_CAST_BAT_DIVE_AIM]: 'Walk',
        [HOARD_CAST_BAT_DIVE]: 'Dive',
        [HOARD_CAST_SCREECH]: 'Cast',
      },
      castTimeScaleByAbility: {
        [HOARD_CAST_BAT_DIVE_AIM]: 1,
        [HOARD_CAST_BAT_DIVE]: 1,
        [HOARD_CAST_SCREECH]: 1,
      },
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Its swarm: the same body, small and dusky.
  mob_hoard_bat_swarmling: {
    url: `${CREATURES}/hoard_boss_bat.glb`,
    height: 1.5,
    hover: 0.525,
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.2,
    tint: 0x9a8a8a,
    tintStrength: 0.5,
  },
  // The Voracious Chest of the cave hoards (src/sim/rift/hoard_mimic.ts): rigged
  // and animated in Blender (scripts/assets/hoard_mobs/mimic_rig.py, which cuts
  // the lid free along the line of teeth and hinges it at the back). Its bite is
  // its Attack slowed so the lid snaps shut as the telegraph ends; its leap plays
  // the Leap clip over the whole crouch and flight (the sim carries it along the
  // arc); it spits its coins with the lid held open.
  mob_hoard_boss_mimic: {
    url: `${CREATURES}/hoard_boss_mimic.glb`,
    height: 1.6,
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      castByAbility: {
        [HOARD_CAST_MIMIC_BITE]: 'Attack',
        [HOARD_CAST_MIMIC_LEAP]: 'Leap',
        [HOARD_CAST_COIN_SPIT]: 'Cast',
      },
      castTimeScaleByAbility: {
        // The snap (55% into the 1.04 s clip) lands as the 1.6 s telegraph ends.
        [HOARD_CAST_MIMIC_BITE]: 0.36,
        [HOARD_CAST_MIMIC_LEAP]: 0.55,
        [HOARD_CAST_COIN_SPIT]: 1,
      },
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Her sporelings: little copies of her (the template scale shrinks them),
  // washed pale and sickly so they never read as a second Mother.
  mob_hoard_sporeling: {
    url: `${CREATURES}/hoard_boss_mushroom.glb`,
    height: 2.2,
    clips: { ...kaykit(['2H_Melee_Attack_Chop']), hit: ['Hit_A'] },
    authoredAtlas: true,
    selfIllumination: 0.25,
    tint: 0xd8e08a,
    tintStrength: 0.55,
  },
  // Her Bloated Cap (src/sim/rift/hoard_mushroom.ts): a Tripo text-to-model
  // mushroom, a stationary prop mob with no rig and no clips (registered in
  // CLIPLESS_RIGS, tests/character_clipmaps.test.ts). Its fuse ring is the
  // generic hoard cue; it swells toward the burst through its own entity scale
  // (the sim grows it on the fuse, hoard_mushroom_core.ts bloatSwell).
  mob_hoard_bloat_cap: {
    url: `${CREATURES}/hoard_bloat_cap.glb`,
    height: 2.0,
    yaw: 0,
    clips: STATIC_PROP,
    authoredAtlas: true,
    selfIllumination: 0.3,
    clickRadius: 1.4,
  },
  // The Maw's bottom-dweller: low, wide, all mouth. Its own Blender rig and clips
  // (scripts/assets/hoard_mobs/quadruped_rig.py).
  mob_hoard_deep_lurker: {
    url: `${CREATURES}/hoard_deep_lurker.glb`,
    // Height is the top of its lure; the body is about half of it.
    height: 2.0,
    // The generated model faces +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The Hoarfrost Warden's dead throne guard.
  mob_hoard_frost_revenant: {
    url: `${CREATURES}/hoard_frost_revenant.glb`,
    height: 3.6,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The forge imp: small, wiry, all claws.
  mob_hoard_ember_fiend: {
    url: `${CREATURES}/hoard_ember_fiend.glb`,
    height: 2.9,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The forge brute: a slab of volcanic rock that hits with its fists.
  mob_hoard_magma_brute: {
    url: `${CREATURES}/hoard_magma_brute.glb`,
    height: 4.1,
    clips: {
      // The punch wobbled his whole slab of a body (playtest); the chop alone.
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Nyxaris's astronomer cultist.
  mob_hoard_void_acolyte: {
    url: `${CREATURES}/hoard_void_acolyte.glb`,
    height: 4.2,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop', 'Spellcast_Shoot']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Vharok's storm shaman.
  mob_hoard_storm_caller: {
    url: `${CREATURES}/hoard_storm_caller.glb`,
    height: 4.4,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop', 'Spellcast_Shoot']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Xarreth's bone-armoured skeleton, shield on his arm.
  mob_hoard_boneclad_warrior: {
    url: `${CREATURES}/hoard_boneclad_warrior.glb`,
    height: 3.5,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      hit: ['Hit_A'],
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Nyxaris's eyeless void hound. Own Blender rig and clips (scripts/assets/hoard_mobs/).
  mob_hoard_dread_stalker: {
    url: `${CREATURES}/hoard_dread_stalker.glb`,
    height: 2.5,
    // The rig rests facing +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Vharok's young storm drake. Own Blender rig and clips (scripts/assets/hoard_mobs/).
  mob_hoard_stormscale_drake: {
    url: `${CREATURES}/hoard_stormscale_drake.glb`,
    height: 3.0,
    // The rig rests facing +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Vysska's web-spinner: eight found legs on the side-limb rig (scripts/assets/hoard_mobs/spider_spec.py).
  mob_hoard_venom_weaver: {
    url: `${CREATURES}/hoard_venom_weaver.glb`,
    height: 1.8,
    // The rig rests facing +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // Vysska's nest beast, a fan of thorns down its back. Own Blender rig and clips.
  mob_hoard_thornback_stalker: {
    url: `${CREATURES}/hoard_thornback_stalker.glb`,
    height: 3.4,
    // The rig rests facing +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.25,
  },
  // The Warden's frost elemental: it floats, and its arms are its only limbs. Tripo read the ice as
  // steel, so the shipped body is made matte (scripts/assets/hoard_mobs/matte.mjs) and leans on its
  // entity colour for the blue.
  mob_hoard_rime_elemental: {
    url: `${CREATURES}/hoard_rime_elemental.glb`,
    height: 3.9,
    // The rig rests facing +x; yaw swings it onto the game's facing.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
    },
    authoredAtlas: true,
    selfIllumination: 0.35,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Vysska's cocoons (src/sim/rift/hoard_cocoon.ts): the silk cocoon a wrapped
  // player stands inside, and the brood cocoon she spins for a lone player. Each
  // is the whole body of its attackable mob, so targeting, the nameplate and the
  // health bar are the ordinary ones; the web mark, the hanging strand, the
  // rescue ring and her feeding are drawn by src/render/hoard_cocoon.ts. Original
  // Blender art (docs/design/cocoon/), no clips, so they use the static prop lane.
  mob_silk_cocoon: {
    url: 'models/creatures/hoard_silk_cocoon.glb',
    height: 3.5,
    clips: STATIC_PROP,
    selfIllumination: 0.18,
    clickRadius: 1.6,
  },
  mob_brood_cocoon: {
    url: 'models/creatures/hoard_brood_cocoon.glb',
    height: 2.5,
    clips: STATIC_PROP,
    selfIllumination: 0.3,
    clickRadius: 1.7,
  },
  // Bone Spike (the Nythraxis raid, src/sim/nythraxis_bone_spike.ts): the
  // Tripo cluster of bone spikes erupting from cracked flagstones with violet
  // tips that pins an impaled raider until the raid shatters it. A stationary
  // prop mob: the GLB ships NO clips (registered in CLIPLESS_RIGS,
  // tests/character_clipmaps.test.ts), so STATIC_PROP parks every action on
  // the nominal 'Idle' and the mesh just stands. Authored upright and
  // front-facing (footprint radius 0.88); shown at 2.6 world units so the
  // spike reads as the thing pinning a raider from across the hall (owner
  // playtest 2026-09-04: 1.6 was too small). Recoloured ember orange with a
  // tinted lift (v0.42.2, owner playtest: the authored bone-and-flagstone
  // atlas read as the boss and the floor under the hall's violet torchlight);
  // the lift follows the tint (assets.ts buildTintedClone) so the spike glows
  // in the one hue no other Nythraxis surface uses. Pinned literally in
  // tests/nythraxis_hazard_palette.test.ts.
  mob_nythraxis_bone_spike: {
    url: `${PROPS}/nythraxis_bone_spike.glb`,
    height: 2.6,
    yaw: 0,
    clips: STATIC_PROP,
    tint: NYTHRAXIS_BONE_SPIKE_TINT,
    tintStrength: NYTHRAXIS_BONE_SPIKE_TINT_STRENGTH,
    selfIllumination: NYTHRAXIS_BONE_SPIKE_SELF_ILLUMINATION,
    clickRadius: NYTHRAXIS_BONE_SPIKE_CLICK_RADIUS,
  },
};

// ---------------------------------------------------------------------------
// Modular player bodies, one `player_<class>_modular` def per class, derived
// from the class def above it. The body is COMPOSED from the shared part
// library (modular.ts) instead of cloned from the class GLB, but everything
// else, clips, the ability→clip mapping, held-weapon layout, the swim/fall
// lane, is the class's own, so a composed rogue garrotes and a composed
// hunter draws its bow exactly like the fixed rigs do.
//
// The class GLB rides along as a pure CLIP source (first animUrl): the
// synthesized per-class attacks (Shield_Bash, Garrote_Choke, Kick_A, ...)
// exist only there, and every player body shares KayKit's Rig_Medium, so its
// clips bind onto the modular skeleton by node name, the swim/bow clip packs
// are the precedent. Which of these defs still preload at boot is decided where
// they are generated, below.
//
// Deliberately dropped from the class def:
//  - `show`: the composed body has no baked accessory meshes to allowlist;
//    hats/capes are armour-slot parts picked by the loadout instead.
//  - `tint`/`tintStrength`: the class tints (shaman blue, warlock violet) are
//    how classes SHARING a stock model stay tellable apart. A composed body's
//    colour belongs to the player's skin/hair wheels, and a tint over the
//    picked skin tone repaints exactly what the player chose.
// ---------------------------------------------------------------------------
// The retired fixed KayKit warrior rig (knight.glb), kept for NON-player
// consumers now that the playable warrior rides the WOC body:
//  - the modular library's own `player_warrior_modular` def below: a class on
//    a WOC body (WOC_BODY_CLASSES) never composes, so that def is unreachable
//    for its own players, but the library's fallback key (MODULAR_WARRIOR_KEY)
//    and the composed-body test bed still name it, and it must keep deriving
//    from a Rig_Medium rig (the WOC clips would bind onto the library's bones
//    by name against the wrong bind pose, and drag the WOC part manifest along).
export const KAYKIT_KNIGHT_WARRIOR: VisualDef = swims({
  url: `${PLAYERS}/knight.glb`,
  // Every clip knight.glb ships is already wired somewhere in this block
  // (idle/walk/attack/hit/emotes account for the full shipped library, no
  // spare donor pose), so Vaulting Charge (issue #2889 batch, verified against
  // the warrior's real kit in src/sim/content/classes.ts, not assumed) is
  // authored by pose-sample-and-blend (scripts/build_warrior_ability_anims.mjs)
  // instead of pointed at an unused clip.
  animUrls: [
    `${PLAYERS}/knight_hit_variety_anims.glb`,
    `${PLAYERS}/warrior_ability_anims.glb`,
    `${PLAYERS}/warrior_fury_anims.glb`,
    `${PLAYERS}/warrior_contact_anims.glb`,
  ],
  height: HUMANOID_H,
  clips: {
    ...kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attackByHand: {
      twohand: '2H_Melee_Attack_Chop',
      dualwield: 'Dualwield_Melee_Attack_Chop',
    },
    castByAbility: { bladestorm: 'Warrior_Bladestorm_Loop' },
    rush: 'Warrior_Rush_Loop',
    rushArrival: 'Warrior_Onrush_Arrival',
    castTimeScaleByAbility: { bladestorm: 1 },
    attackTimeScaleByAbility: { heroic_leap: 1 },
    attackByAbility: {
      charge: 'Warrior_Rush_Loop',
      intervene: 'Warrior_Rush_Loop',
      mortal_strike: 'Warrior_Maiming_Strike',
      execute: 'Warrior_Early_Grave',
      slam: 'Warrior_Brute_Swing',
      red_harvest: 'Fury_Red_Harvest',
      breachmaker: 'Warrior_Breachmaker',
      // Native shield drive with a planted lower body and a held contact.
      // scripts/build_warrior_contact_anims.mjs bakes foot locking offline.
      shield_slam: 'Warrior_Shieldcrack',
      raging_gale: 'Fury_Twinstrike',
      bloodthirst: 'Warrior_Bloodletting',
      battle_shout: 'Warrior_Iron_Bellow',
      demoralizing_shout: 'Warrior_Direhowl',
      emboldening_roar: 'Warrior_Emboldening_Roar',
      defiant_bellow: 'Warrior_Defiant_Bellow',
      rallying_cry: 'Warrior_Valor_Roar',
      intimidating_shout: 'Warrior_Intimidating_Shout',
      piercing_howl: 'Warrior_Piercing_Howl',
      // Reaping Arc turns through all surrounding enemies; Revenge is frontal.
      cleave: 'Warrior_Reaping_Arc',
      revenge: 'Warrior_Revenge',
      thunder_clap: 'Warrior_Quaking_Blow',
      faultline: 'Warrior_Faultline',
      heroic_strike: 'Warrior_Reaver_Strike',
      overpower: 'Warrior_Redhand',
      hamstring: 'Warrior_Hobbling_Cut',
      sunder_armor: 'Warrior_Armor_Shear',
      storm_bolt: 'Warrior_Storm_Bolt',
      sanguine_aura: 'Warrior_Sanguine_Aura',
      sweeping_strikes: 'Warrior_Widening_Arc',
      battle_stance: 'Warrior_Battle_Stance',
      defensive_stance: 'Warrior_Guarded_Stance',
      berserker_stance: 'Warrior_Berserker_Stance',
      raised_guard: 'Warrior_Raised_Guard',
      iron_resolve: 'Warrior_Iron_Resolve',
      // Jawcrack drives the held weapon's guard into the interrupt:
      // planted feet and a compact contact hold preserve both grips.
      pummel: 'Warrior_Jawcrack',
      // Vaulting Charge is a position-targeted jump, not a swing: the bespoke
      // pose-sample-and-blend clip (coil, airborne, driven two-hand slam on
      // landing). It carries no castFx and resolves no target entity, so it
      // completes through the renderer's generic 'selfCast' cue, which only
      // draws a body gesture via this exact attackByAbility entry
      // (CharacterVisual.hasAttackClipOverride, src/render/ability_vfx/
      // painter.ts's non-contact 'selfCast' branch); with no entry it plays
      // nothing at all on the body.
      heroic_leap: 'Warrior_Heroic_Leap',
      // A decisive cut followed by an upright, confident recovery.
      victory_rush: 'Warrior_Victory_Rush',
      // Native resource ceremonies: inward clench, outward pressure release,
      // and an aggressive opening of both arms. Each recovers inside a GCD.
      taunt: 'Warrior_Goad',
      furious_mending: 'Warrior_Furious_Mending',
      whirlwind: 'Warrior_Bladed_Gyre',
      bloodrage: 'Warrior_Blood_Toll',
      berserker_rage: 'Warrior_Seething_Fury',
      recklessness: 'Warrior_Recklessness',
      // The actual blade supplies its distinct defensive presentation.
      die_by_sword: 'Warrior_Sword_Guard',
      // A planted rise carries Avatar's physical transformation.
      avatar: 'Warrior_Avatar',
    },
  },
  show: ['Knight_Helmet', 'Knight_Cape'], // v2 knight dropped the built-in Badge_Shield mesh
  attach: [
    { url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/shield_round.glb`, bone: 'handslot.l' },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
});
// The KayKit paladin as it shipped before the WOC body took the class (the
// dedicated helmeted model, its donor clip GLBs and the two synthesized attack
// clips). Kept as the `player_paladin_modular` baseline the modular loop below
// derives from, so the creation turntable and every KayKit-composed path keep
// a fully bound clip map; it draws no player anymore.
export const KAYKIT_PALADIN: VisualDef = swims({
  url: `${PLAYERS}/paladin.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attackByHand: { twohand: '2H_Melee_Attack_Chop' },
    // Ability-specific clips: the composed union of the overhaul's
    // Dawnreaver entries (final_edict/sunward_disc/bastion_sweep) and the
    // #2889 follow-up batch mapped by the ability's EFFECT TYPE (groundAoE,
    // stun, absorb/defensive selfBuff, buffTarget/aura selfBuff, heal).
    // The batch's judgement row is dropped: the overhaul retired that id
    // (final_edict is its successor and carries the Verdict clip). Not
    // every ability is listed; unlisted ids keep the default chop.
    attackByAbility: {
      final_edict: 'Paladin_Templars_Verdict_1H',
      sunward_disc: 'Spellcast_Raise',
      bastion_sweep: 'Paladin_Bastion_Sweep',
      consecration: 'Cast_Consecrate',
      hammer_of_justice: 'Cast_HammerBash',
      divine_protection: 'Cast_Ward',
      sacred_bulwark: 'Cast_Ward',
      blessing_of_might: 'Cast_Blessing',
      devotion_aura: 'Cast_Blessing',
      retribution_aura: 'Cast_Blessing',
      righteous_fury: 'Cast_Blessing',
      holy_light: 'Cast_HolyMend',
      flash_of_light: 'Cast_HolyMend',
      lay_on_hands: 'Cast_HolyMend',
    },
    attackTimeScaleByAbility: { final_edict: 1, sunward_disc: 1.8, bastion_sweep: 1 },
  },
  // Ability-specific clips (scripts/build_paladin_ability_anims.mjs): a
  // mesh-free clip donor GLB baked off this rig's own poses.
  animUrls: [`${PLAYERS}/paladin_hit_variety_anims.glb`, `${PLAYERS}/paladin_ability_anims.glb`],
  // dedicated paladin model (helmeted variant): ships its own Cape + Helmet
  // meshes and texture, so no show-list/tint. Shield + paladin hammer arrive
  // in the weapons pass; the gripped axe holds the slot until then.
  attach: [
    { url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/shield_square.glb`, bone: 'handslot.l' },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
});

// The KayKit class rigs as they shipped before the WOC bodies took the seven
// remaining classes (2026-09-18 equipment sets): their donor clip GLBs and
// per-ability clip maps intact. Each is the `player_<class>_modular` baseline
// the modular loop below derives from, so the composed-body paths keep a fully
// bound clip map; none draws a player anymore.
export const KAYKIT_HUNTER: VisualDef = swims({
  url: `${PLAYERS}/ranger.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['2H_Ranged_Shoot']),
    // Ability-specific attacks (scripts/build_hunter_ability_anims.mjs,
    // issue #2889): the hunter had zero attackByAbility overrides across
    // its kit, so every ability played the same crossbow-shoulder shot.
    // The three melee abilities (range 0) get a bespoke swing each; the
    // ranged shots split into a quick snap (every instant no-cast-time
    // shot) versus the slow full draw Long Draw's own 3.0s cast time
    // names; Volley gets its own rapid-pulse barrage. The three aspect
    // toggles plus Fevered Draw are self-buffs with no swing to author, so
    // they point straight at ranger.glb's own already-baked
    // 'Spellcast_Raise' clip, the same no-bake pattern player_warrior's
    // sanguine_aura already uses. Not every ability in the kit is listed:
    // this batch's representative slice (tame_beast/dismiss_pet/revive_pet
    // are pet-command channels with no combat swing to author, matching
    // batch 1's own utility/summon exclusions for the mage).
    attackByAbility: {
      raptor_strike: 'Hunter_Melee_Gut',
      mongoose_bite: 'Hunter_Melee_Counter',
      wing_clip: 'Hunter_Melee_Clip',
      serpent_sting: 'Hunter_Shot_Snap',
      arcane_shot: 'Hunter_Shot_Snap',
      concussive_shot: 'Hunter_Shot_Snap',
      counter_shot: 'Hunter_Shot_Snap',
      aimed_shot: 'Hunter_Shot_LongDraw',
      volley: 'Hunter_Shot_Volley',
      aspect_of_the_hawk: 'Spellcast_Raise',
      aspect_of_the_monkey: 'Spellcast_Raise',
      aspect_of_the_cheetah: 'Spellcast_Raise',
      rapid_fire: 'Spellcast_Raise',
    },
  },
  // Bow-draw clips for the Season 1 bow skins (scripts/build_bow_anims.mjs):
  // with a bow displayed the shot plays a draw instead of the crossbow
  // shoulder-aim (visual.ts weaponSkinAttackClips). The cast-time hold pose
  // (bow_hold_anim.glb) and the ability-specific attack clips
  // (scripts/build_hunter_ability_anims.mjs) ride the same mesh-free donor
  // GLB mechanism, appended alongside: all GLBs' clips load together.
  animUrls: [
    `${PLAYERS}/bow_anims.glb`,
    `${PLAYERS}/bow_hold_anim.glb`,
    `${PLAYERS}/hunter_ability_anims.glb`,
    `${PLAYERS}/ranger_hit_variety_anims.glb`,
  ],
  // dedicated ranger model: the quiver is a built-in mesh, so it's no longer
  // a separate chest attachment
  attach: [{ url: `${WEAPONS}/crossbow_1handed.glb`, bone: 'handslot.r' }],
});
export const KAYKIT_ROGUE: VisualDef = swims({
  url: `${PLAYERS}/rogue.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['Dualwield_Melee_Attack_Chop']),
    attackByAbility: {
      // Throat Wire is a wire strangle, not a dagger swing: the synthesized
      // two-handed choke (scripts/_add_garrote_choke_anim.mjs) reaches to
      // neck height and yanks back to the chest with a brief hold.
      garrote: 'Garrote_Choke',
      // Boot is a kick, not a swing: the synthesized snap kick
      // (scripts/_add_boot_kick_anim.mjs) chambers the knee and fires the
      // leg forward at gut height.
      kick: 'Kick_A',
      // Dirt Toss throws dirt, not daggers: the synthesized crouch-scoop
      // and underhand fling (scripts/_add_dirt_throw_anim.mjs).
      blind: 'Dirt_Throw',
      // Rest of the kit (scripts/build_rogue_ability_anims.mjs, issue
      // #2889): pose-sample-and-blend clips off rogue.glb's own donor
      // poses. Wicked Slash is the combo-builder poke; Eye Jab and Sap
      // share its silhouette since both are instant single-target
      // debilitating strikes with no unique read of their own.
      sinister_strike: 'Rogue_Quick_Strike',
      gouge: 'Rogue_Quick_Strike',
      sap: 'Rogue_Quick_Strike',
      // Craven Thrust drives the dagger in from behind.
      backstab: 'Rogue_Backstab',
      // Lurker's Strike is the kit's biggest single hit (2.5x weapon,
      // stealth-gated): its own bigger, more telegraphed lunge.
      ambush: 'Rogue_Ambush',
      // Gut Punch and Low Blow both land at gut/kidney height.
      cheap_shot: 'Rogue_Low_Blow',
      kidney_shot: 'Rogue_Low_Blow',
      // Combo-spending finishers read as one decisive two-blade cut.
      eviscerate: 'Rogue_Finisher_Slash',
      rupture: 'Rogue_Finisher_Slash',
      expose_armor: 'Rogue_Finisher_Slash',
      // Ghostfoot is a defensive dodge buff: rogue.glb's own already-baked
      // 'Block' guard, no bake needed (the pattern player_warrior's
      // raised_guard already uses).
      evasion: 'Block',
      // Cutthroat Tempo, Smokefade, Quickened Blood, and Duskveil are all
      // self-buff/stealth toggles with no combat swing to author: rogue.
      // glb's own already-baked 'Spellcast_Raise', the pattern player_
      // warrior's sanguine_aura and the hunter batch's aspect toggles both
      // use. Adder's Bite and Festering Venom (the poison weapon imbues)
      // are excluded, the same call the mage batch made for its own
      // utility/summon abilities.
      slice_and_dice: 'Spellcast_Raise',
      vanish: 'Spellcast_Raise',
      adrenaline_rush: 'Spellcast_Raise',
      stealth: 'Spellcast_Raise',
    },
  },
  // Ability-specific attack clips (scripts/build_rogue_ability_anims.mjs).
  animUrls: [`${PLAYERS}/rogue_hit_variety_anims.glb`, `${PLAYERS}/rogue_ability_anims.glb`],
  show: ['Rogue_Cape'],
  attach: [
    { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
});
export const KAYKIT_PRIEST: VisualDef = swims({
  url: `${PLAYERS}/mage.glb`,
  animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`],
  height: HUMANOID_H,
  clips: {
    ...kaykit(['2H_Melee_Attack_Chop']),
    attackByAbility: {
      // Lingering Grace is a blessing, not a staff swing: the one-hand
      // raise (a stock mage.glb clip) reads as the priest offering the HoT.
      renew: 'Spellcast_Raise',
    },
  },
  // The priest's Light: a warm golden halo ring above the crown. The mage
  // model's pointed hat is canon here, and at the default lift the ring
  // plane crosses the hat cone where it is wide, clipping through it; +0.15
  // raises the plane to the cone tip, where the default-size ring clears it
  // on every side (tuned by screenshot against the current mage.glb; a hat
  // reshape in an asset update means re-tuning). Kept just below the hat's
  // bounding-box top so portrait/turntable framing is unchanged for priests.
  halo: 0xffd766,
  haloUpOffset: 1.45,
  // show is a no-op for the hat/cape: the current mage.glb rigs every
  // accessory as a SkinnedMesh, and the allowlist filter (assets.ts) only
  // hides non-skinned nodes, so the hat always renders. Sanctioned look.
  show: [],
  // The offhand slot renders ONLY an equipped, model-mapped offhand item
  // (the phase 06 inscription tomes are the first): offhandAttachDef skips
  // the slot entirely when the offhand is empty or unmapped, so the empty
  // hand look is unchanged. The base url never renders and is already in
  // the preload set via the warlock's fixed spellbook; swapOnly keeps it
  // out of the wiki figures too.
  attach: [
    { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', swapOnly: true },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
  // Faint warm lift only, to tell this apart from the mage/warlock models it
  // shares mage.glb with. The whole rig is ONE merged material/atlas (skin,
  // hair, and robe together), so this lerp multiplies the entire body, not
  // just the cloth. Measured: 0xf0e9d6 is near white, so even at 0.5 the old
  // strength only shifted the body by roughly (0.983, 0.980, 0.956), a
  // near-no-op (issue #2678); dropped to 0.12 anyway for consistency with
  // shaman/warlock, where the saturated tints DID flatten the face and
  // hands at their old strengths. Kept at the same faint-wash strength the
  // manifest already uses elsewhere (mob_troll) to differentiate a shared
  // model without hiding its base texture.
  tint: 0xf0e9d6,
  tintStrength: 0.12,
});
export const KAYKIT_SHAMAN: VisualDef = swims({
  url: `${PLAYERS}/barbarian.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attackByHand: { twohand: '2H_Melee_Attack_Chop' },
    // Ability-specific spellcasts (scripts/build_shaman_ability_anims.mjs,
    // issue #2889): the shaman had zero attackByAbility overrides across
    // its kit, so every spell played the same melee chop/slice. Mapped by
    // school (src/sim/content/classes.ts): Cast_Bolt is the class's
    // signature nature bolt (its longest cast, 1.5 to 3.0s); Earthen/
    // Cinder/Rime Jolt are all instant (0s cast) and differ only in damage
    // school, so they share Cast_Shock's snappy point-and-release;
    // Mending Waters and the Spiritcall signature Chain Heal share
    // Cast_Heal's sustained mending channel instead of a sharp release;
    // Earthquake borrows the two-hand chop's committed downswing energy
    // for Cast_Quake, the same "slam and radiate outward" read the mage's
    // Cast_Nova makes; Ancestral Strike (physical) gets its own charged
    // diagonal slice, Storm_Strike. The weapon imbues (Stonebound,
    // Pyrebrand, Rimebound Weapon) and the short self buffs (Shadewolf,
    // Primal Mastery) have no swing to author, so they read fine on the
    // rig's existing Spellcast_Raise gesture, the same no-bake call the
    // priest's renew and the warlock's sanguine_aura make; Thunder
    // Ward reads as a defensive ward instead, so it reuses Block, the
    // same call the warrior's raised_guard makes. This covers every
    // ability tagged class: 'shaman' in classes.ts.
    attackByAbility: {
      lightning_bolt: 'Cast_Bolt',
      earth_shock: 'Cast_Shock',
      flame_shock: 'Cast_Shock',
      frost_shock: 'Cast_Shock',
      healing_wave: 'Cast_Heal',
      chain_heal: 'Cast_Heal',
      earthquake: 'Cast_Quake',
      stormstrike: 'Storm_Strike',
      rockbiter_weapon: 'Spellcast_Raise',
      flametongue_weapon: 'Spellcast_Raise',
      frostbrand_weapon: 'Spellcast_Raise',
      ghost_wolf: 'Spellcast_Raise',
      elemental_mastery: 'Spellcast_Raise',
      lightning_shield: 'Block',
    },
  },
  // Ability-specific spellcast clips (scripts/build_shaman_ability_anims.mjs):
  // a mesh-free clip donor GLB baked off this rig's own spellcasting poses.
  // The hit-variety donor (scripts/build_hit_variety_anims.mjs, second
  // KayKit hit-reaction clip, issue #2889 area B) ships alongside it on the
  // same rig, so both donors are listed here.
  animUrls: [`${PLAYERS}/barbarian_hit_variety_anims.glb`, `${PLAYERS}/shaman_ability_anims.glb`],
  show: ['Barbarian_BearHat'], // v2 barbarian renamed Hat→BearHat and dropped the round shield mesh
  attach: [
    { url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/shield_round.glb`, bone: 'handslot.l' },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
  // Faint cool lift only: barbarian.glb is one merged material for the whole
  // body (skin, fur, and leather together), so this lerp hits the face and
  // hands as hard as the cloth. 0.4 (the class default strength) desaturated
  // the whole model into a blue-grey wash on character create (issue #2678);
  // dropped further to 0.12, the same faint-wash strength the manifest
  // already uses elsewhere (mob_troll) to differentiate a shared model
  // without hiding its base texture.
  tint: 0x6f8fc9,
  tintStrength: 0.12,
});
export const KAYKIT_MAGE: VisualDef = swims({
  url: `${PLAYERS}/mage.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['2H_Melee_Attack_Chop']),
    // Ability-specific spellcasts (scripts/build_mage_ability_anims.mjs,
    // issue #2889): the mage had zero attackByAbility overrides across its
    // kit, so every spell played the same melee chop. Mapped by school
    // (src/sim/content/classes.ts) to the school's signature spells;
    // Polymorph names its own clip (the one ability the clip is written
    // for by name), and the point-blank AoE bursts (Frost Nova, Arcane
    // Explosion, Dragon's Breath) share Cast_Nova's "slam and radiate
    // outward" read regardless of school. Not every ability in the kit is
    // listed: this is the first batch's representative slice, not
    // exhaustive coverage (utility/buff/summon abilities keep the default
    // chop until a later batch).
    attackByAbility: {
      fireball: 'Cast_Fire',
      scorch: 'Cast_Fire',
      fire_blast: 'Cast_Fire',
      pyroblast: 'Cast_Fire',
      combustion: 'Cast_Fire',
      meteor: 'Cast_Fire',
      flamestrike: 'Cast_Fire',
      fireball_form: 'Cast_Fire',
      frostbolt: 'Cast_Frost',
      ice_lance: 'Cast_Frost',
      frozen_orb: 'Cast_Frost',
      blizzard: 'Cast_Frost',
      glacial_spike: 'Cast_Frost',
      ice_barrier: 'Cast_Frost',
      arcane_missiles: 'Cast_Arcane',
      arcane_surge: 'Cast_Arcane',
      arcane_intellect: 'Cast_Arcane',
      temporal_barrier: 'Cast_Arcane',
      temporal_echo: 'Cast_Arcane',
      temporal_cascade: 'Cast_Arcane',
      frost_nova: 'Cast_Nova',
      arcane_explosion: 'Cast_Nova',
      dragons_breath: 'Cast_Nova',
      polymorph: 'Cast_Polymorph',
    },
  },
  // Ability-specific spellcast clips (scripts/build_mage_ability_anims.mjs):
  // a mesh-free clip donor GLB baked off this rig's own spellcasting poses.
  animUrls: [`${PLAYERS}/mage_ability_anims.glb`, `${PLAYERS}/mage_hit_variety_anims.glb`],
  // The hat and cape render regardless of this list: the current mage.glb
  // rigs every accessory as a SkinnedMesh, and the show allowlist
  // (assets.ts) only hides non-skinned nodes. The hatted silhouette is the
  // sanctioned mage look; listing Mage_Cape is inert but kept as intent.
  show: ['Mage_Cape'],
  // Offhand slot: renders only an equipped model-mapped offhand (the
  // inscription tomes); empty stays empty. See the priest note.
  attach: [
    { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', swapOnly: true },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
});
export const KAYKIT_WARLOCK: VisualDef = swims({
  url: `${PLAYERS}/mage.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['Spellcast_Shoot']), // wand zap reads better than a staff bonk
    // Ability-specific spellcasts (scripts/build_warlock_ability_anims.mjs,
    // issue #2889): the warlock had zero attackByAbility overrides across
    // its kit, so every spell played the same wand zap. Mapped by school
    // (src/sim/content/classes.ts): shadow curses get the decisive clawed
    // point (Warlock_Cast_Shadow), fire gets the scrappier ignite flick
    // (Warlock_Cast_Fire), the life-drain channel gets its own sustained
    // pull (Warlock_Cast_Drain), and every instant-cast (castTime 0)
    // ability, regardless of mechanic, shares one fast decisive gesture
    // (Warlock_Cast_Burst), the same call the mage batch made folding
    // three different AoE mechanics into one Cast_Nova. This maps the
    // whole non-pet kit: the seven summon_* pet abilities are channels
    // with no combat swing to author, excluded the same way the hunter
    // batch excluded tame_beast/dismiss_pet/revive_pet.
    attackByAbility: {
      shadow_bolt: 'Warlock_Cast_Shadow',
      corruption: 'Warlock_Cast_Shadow',
      curse_of_agony: 'Warlock_Cast_Shadow',
      immolate: 'Warlock_Cast_Fire',
      searing_pain: 'Warlock_Cast_Fire',
      rain_of_fire: 'Warlock_Cast_Fire',
      drain_life: 'Warlock_Cast_Drain',
      shadowburn: 'Warlock_Cast_Burst',
      fear: 'Warlock_Cast_Burst',
      life_tap: 'Warlock_Cast_Burst',
      demon_skin: 'Warlock_Cast_Burst',
      spell_lock: 'Warlock_Cast_Burst',
    },
  },
  // Ability-specific spellcast clips (scripts/build_warlock_ability_anims.mjs):
  // a mesh-free clip donor GLB baked off this same mage.glb rig's own
  // poses, but its OWN clip names and timing, not a reuse of the mage's
  // mage_ability_anims.glb (the two GLBs are wired onto different
  // VisualDefs and never load together).
  animUrls: [`${PLAYERS}/mage_hit_variety_anims.glb`, `${PLAYERS}/warlock_ability_anims.glb`],
  show: [],
  attach: [
    { url: `${WEAPONS}/wand.glb`, bone: 'handslot.r' },
    {
      url: `${WEAPONS}/spellbook_open.glb`,
      bone: 'handslot.l',
      gripRef: 'Spellbook_open',
    },
  ],
  weaponSlots: [0], // mainhand (wand) swaps; spellbook offhand stays
  // Faint violet lift only, to tell this apart from the mage/priest models
  // it shares mage.glb with (same one-material-per-rig caveat as those two:
  // this multiplies skin and hair along with the robe). 0.45 read as a
  // saturated full-body purple wash on character create (issue #2678);
  // dropped further to 0.12, the same faint-wash strength the manifest
  // already uses elsewhere (mob_troll) to differentiate a shared model
  // without hiding its base texture.
  tint: 0x8d5fd3,
  tintStrength: 0.12,
});
export const KAYKIT_DRUID: VisualDef = swims({
  url: `${PLAYERS}/druid.glb`,
  height: HUMANOID_H,
  clips: {
    ...kaykit(['2H_Melee_Attack_Chop']),
    // Ability-specific spellcasts (scripts/build_druid_ability_anims.mjs,
    // issue #2889): the druid's caster kit had zero attackByAbility
    // overrides, so every nature/arcane spell played the same staff chop.
    // Scope is the caster side only, bear/cat/travel forms already have
    // their own dedicated ClipMap constants and are untouched here. Mapped
    // primarily by school (src/sim/content/classes.ts), the same signal
    // batch 1 used for the mage; named exceptions cover heal, root/CC, and
    // channel roles, since the nature school alone spans very different
    // actions. Not every ability in the kit is listed: shapeshift and
    // melee-form abilities keep their own clips, and this is a
    // representative slice of the caster kit, not exhaustive coverage.
    attackByAbility: {
      wrath: 'Cast_Nature',
      faerie_fire: 'Cast_Nature',
      thorns: 'Cast_Nature',
      mark_of_the_wild: 'Cast_Nature',
      insect_swarm: 'Cast_Nature',
      moonfire: 'Cast_Starfall',
      starfire: 'Cast_Starfall',
      healing_touch: 'Cast_Nurture',
      regrowth: 'Cast_Nurture',
      rejuvenation: 'Cast_Nurture',
      entangling_roots: 'Cast_Roots',
      hibernate: 'Cast_Roots',
      hurricane: 'Cast_Storm',
    },
  },
  // Ability-specific spellcast clips (scripts/build_druid_ability_anims.mjs):
  // a mesh-free clip donor GLB baked off this rig's own spellcasting poses,
  // alongside the hit-variety donor.
  animUrls: [`${PLAYERS}/druid_hit_variety_anims.glb`, `${PLAYERS}/druid_ability_anims.glb`],
  // dedicated druid model (own texture, ships a Backpack mesh)
  // Offhand slot: renders only an equipped model-mapped offhand (the
  // inscription tomes); empty stays empty. See the priest note.
  attach: [
    { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', swapOnly: true },
  ],
  weaponSlots: [0],
  offhandSlot: 1,
});
/** The female fit of a WOC class def: the class def to the letter (the same clips,
 *  owner rules and hands) on the female base, its own armor manifest, and the
 *  female clips' own blade contacts. Chosen by playerVisualKey. */
function wocFemale(male: VisualDef, manifest: WocCharacterManifest): VisualDef {
  return {
    ...male,
    ...wocBody('female'),
    wocCharacter: manifest,
    clips: { ...male.clips, contacts: WOC_CONTACTS_FEMALE },
  };
}
VISUALS.player_warrior_female = wocFemale(VISUALS.player_warrior, WOC_WARRIOR_FEMALE_MANIFEST);
SKINS.player_warrior_female = [null, null, null, null, null, null];
VISUALS.player_paladin_female = wocFemale(VISUALS.player_paladin, WOC_PALADIN_FEMALE_MANIFEST);
SKINS.player_paladin_female = [null, null, null, null];
VISUALS.player_hunter_female = wocFemale(VISUALS.player_hunter, WOC_HUNTER_FEMALE_MANIFEST);
SKINS.player_hunter_female = [null, null, null, null, null, null];
VISUALS.player_rogue_female = wocFemale(VISUALS.player_rogue, WOC_ROGUE_FEMALE_MANIFEST);
SKINS.player_rogue_female = [null, null, null, null, null, null];
VISUALS.player_mage_female = wocFemale(VISUALS.player_mage, WOC_MAGE_FEMALE_MANIFEST);
SKINS.player_mage_female = [null, null, null, null, null, null];
VISUALS.player_priest_female = wocFemale(VISUALS.player_priest, WOC_PRIEST_FEMALE_MANIFEST);
SKINS.player_priest_female = [null, null, null, null, null, null];
VISUALS.player_warlock_female = wocFemale(VISUALS.player_warlock, WOC_WARLOCK_FEMALE_MANIFEST);
SKINS.player_warlock_female = [null, null, null, null, null, null];
VISUALS.player_druid_female = wocFemale(VISUALS.player_druid, WOC_DRUID_FEMALE_MANIFEST);
SKINS.player_druid_female = [null, null, null, null, null, null];
VISUALS.player_shaman_female = wocFemale(VISUALS.player_shaman, WOC_SHAMAN_FEMALE_MANIFEST);
SKINS.player_shaman_female = [null, null, null, null, null, null];

/** The KayKit def each WOC-bodied class derives its `_modular` fallback from. */
export const KAYKIT_BASELINES: Partial<Record<PlayerClass, VisualDef>> = {
  warrior: KAYKIT_KNIGHT_WARRIOR,
  paladin: KAYKIT_PALADIN,
  hunter: KAYKIT_HUNTER,
  rogue: KAYKIT_ROGUE,
  priest: KAYKIT_PRIEST,
  shaman: KAYKIT_SHAMAN,
  mage: KAYKIT_MAGE,
  warlock: KAYKIT_WARLOCK,
  druid: KAYKIT_DRUID,
};

// Driven by ALL_CLASSES rather than a local copy: a tenth class would otherwise
// get no modular def at all and fall back to the warrior's clips through
// modularKeyFor, silently, with no test able to see it.
//
// A class on a WOC body never composes (woc_parts_core.ts classBodyComposes: the
// look provider, the roster look, the creation turntable and the portrait chip
// all answer null for it), so nothing a player can reach builds its `_modular`
// def, and the def is `lazyPreload`: the KayKit class rig and donor clip GLBs
// only it names stay out of every client's boot download and are fetched if a
// build ever asks (assets.ts visualAssetsResident; the dev outfit audit rig,
// src/dev/outfit_audit.ts, is the one caller left). That holds for the warrior's
// too, the library's own fallback key (MODULAR_WARRIOR_KEY): it stayed in the
// boot gate while every world NPC composed from the same part library, and no
// NPC does any more (each rides a WOC class body, npc_looks.ts), so the library
// file itself is on demand with the rest.
for (const cls of ALL_CLASSES) {
  const classDef = VISUALS[`player_${cls}`];
  const {
    show: _show,
    tint: _tint,
    tintStrength: _tintStrength,
    ...base
  } = classDef.wocCharacter ? (KAYKIT_BASELINES[cls] ?? KAYKIT_KNIGHT_WARRIOR) : classDef;
  VISUALS[`player_${cls}_modular`] = {
    ...base,
    url: `${MODULAR}/warrior_modular.glb`,
    modular: true,
    animUrls: [base.url, ...(base.animUrls ?? [])],
    ...(classDef.wocCharacter ? { lazyPreload: true } : {}),
  };
}

// The Tideglass Colossus's Reflections (sim/content/drowned_temple.ts): one
// glass copy of each class's own body, silvered and lit from within, a head
// taller than the player it mirrors (the owner's look rides the template id,
// `tideglass_reflection_<class>`, so no wire field is needed).
// The copy is of the class's WOC body, the one its player wears, with that body's own
// clip map and default kit; a mob hands it no look, so it wears the type's default face.
for (const cls of ALL_CLASSES) {
  const base = VISUALS[`player_${cls}`];
  VISUALS[`temple_reflection_${cls}`] = {
    ...base,
    height: base.height * 1.15,
    // A tint multiplies, so near-white read as the plain class look: a cold
    // tideglass blue with a strong inner light makes the copy read as glass.
    tint: 0x7fb2ff,
    tintStrength: 0.88,
    selfIllumination: 0.62,
    envMapIntensity: 2.2,
  };
}

// The Wildheart Basin's placeholder creatures (wildheart_creature_looks.ts).
Object.assign(VISUALS, wildheartPlaceholderLooks(VISUALS));
// The Gravewyrm Sanctum's creatures: the Sledge Tusker's Blender body and the
// trash's own bodies (sanctum_creature_looks.ts, sanctum_trash_looks.ts).
Object.assign(VISUALS, sanctumCreatureLooks(VISUALS));
// The Gravewyrm Sanctum's three bosses (sanctum_boss_looks.ts).
Object.assign(VISUALS, SANCTUM_BOSS_LOOKS);

/** The composed-body variant of a class visual (every class has one). */
export function modularVisualKey(cls: PlayerClass): string {
  return `player_${cls}_modular`;
}

// ---------------------------------------------------------------------------
// NPC held props: one fixed attach list per prop set (npc_looks.ts authors
// WHICH set each NPC carries; this table owns the geometry). An NPC rides a
// player class's WOC def (visualKeyFor) and NPC gear never changes, so its
// props replace that def's hands outright: a fixed attach list with no weapon
// slot (npcHeldProps), or the body would hold the class's own default weapons.
// Keyed by NpcPropSet, so a new prop set in npc_looks.ts cannot ship without
// its row.
// ---------------------------------------------------------------------------
export const NPC_PROP_ATTACH: Readonly<Record<NpcPropSet, readonly AttachDef[]>> = {
  none: [],
  // The generic weapons an NPC holds are the rare set's (one finish per prop set: which
  // one is a matter of looks only), so no world NPC carries a kit weapon. The named
  // props below them (walking staff, oak stave, wood axe, knife) are their own models.
  staff: [{ url: `${WEAPONS}/staff_rare_a_teal.glb`, bone: 'handslot.r' }],
  walking_staff: [{ url: `${WEAPONS}/brasscrown_walking_staff.glb`, bone: 'handslot.r' }],
  oak_stave: [{ url: `${WEAPONS}/knotted_oak_stave.glb`, bone: 'handslot.r' }],
  // the open book is the starter one, turned to open toward its reader like the warlock's
  tome: [
    { url: `${WEAPONS}/staff_rare_b_violet.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/spellbook_starter.glb`, bone: 'handslot.l', rotationY: Math.PI },
  ],
  // no rare crossbow exists: the starter one
  crossbow: [{ url: `${WEAPONS}/crossbow_starter.glb`, bone: 'handslot.r' }],
  // the war maul, at the one-hand length its family clamp gives it
  hammer: [{ url: `${WEAPONS}/hammer_rare_b_ember.glb`, bone: 'handslot.r' }],
  woodaxe: [{ url: `${WEAPONS}/notched_woodaxe.glb`, bone: 'handslot.r' }],
  sword_shield: [
    { url: `${WEAPONS}/sword_rare_a_teal.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/shield_rare_a_teal.glb`, bone: 'handslot.l' },
  ],
  sword: [{ url: `${WEAPONS}/sword_rare_b_teal.glb`, bone: 'handslot.r' }],
  // the glaive stands in for the scythe
  scythe: [{ url: `${WEAPONS}/spear_rare_a_teal.glb`, bone: 'handslot.r' }],
  knife: [{ url: `${WEAPONS}/whittler_s_knife.glb`, bone: 'handslot.r' }],
  spear: [{ url: `${WEAPONS}/spear_rare_b_ember.glb`, bone: 'handslot.r' }],
  // The Mirefen muster's arms, on the ember finish of its red: the footman's spear and the
  // chaplain's hammer each with the ember shield, and the drillmaster's own mallet.
  spear_shield: [
    { url: `${WEAPONS}/spear_rare_b_ember.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/shield_rare_b_ember.glb`, bone: 'handslot.l' },
  ],
  hammer_shield: [
    { url: `${WEAPONS}/hammer_rare_b_ember.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/shield_rare_b_ember.glb`, bone: 'handslot.l' },
  ],
  mallet: [{ url: `${WEAPONS}/muster_mallet.glb`, bone: 'handslot.r' }],
  // The humanoid enemies' arms (npc_looks.ts, the enemy rows): the outlaws' paired
  // starter daggers, the brutes' axe, and the shadow cults' violet staff and wand.
  daggers: [
    { url: `${WEAPONS}/dagger_starter.glb`, bone: 'handslot.r' },
    { url: `${WEAPONS}/dagger_starter.glb`, bone: 'handslot.l' },
  ],
  axe: [{ url: `${WEAPONS}/axe_rare_a_ember.glb`, bone: 'handslot.r' }],
  dark_staff: [{ url: `${WEAPONS}/staff_rare_a_violet.glb`, bone: 'handslot.r' }],
  wand: [{ url: `${WEAPONS}/wand_rare_b_violet.glb`, bone: 'handslot.r' }],
};

// One layout object per prop set, minted once: a stable identity for every
// body that holds the set.
const NPC_HELD_PROPS = Object.fromEntries(
  NPC_PROP_SET_IDS.map((propSet): [NpcPropSet, WeaponLayoutOverride] => [
    propSet,
    { attach: [...NPC_PROP_ATTACH[propSet]], weaponSlots: undefined, offhandSlot: undefined },
  ]),
) as Record<NpcPropSet, WeaponLayoutOverride>;

/** The hands of an NPC that carries `propSet`: its fixed props in place of the
 *  class def's own weapons, with no swap slot (an NPC equips nothing). */
export function npcHeldProps(propSet: NpcPropSet): WeaponLayoutOverride {
  return NPC_HELD_PROPS[propSet];
}

// ---------------------------------------------------------------------------
// Dispatch: entity -> visual key (mirrors the old buildRigFor selection:
// e.kind + e.templateId + MOBS[id].family)
// ---------------------------------------------------------------------------

const MOB_KEYS: Record<string, string> = {
  // WIP forge mech enemy (crawl/standup/die placeholder rig).
  derelict_mech: 'mob_mech',
  [IGNIVAR_BOSS_ID]: 'mob_ignivar',
  ignivar_heart_of_the_end: 'mob_ignivar_heart_of_the_end',
  [IGNIVAR_CRUCIBLE_WARDEN_ID]: 'mob_ignivar_crucible_warden',
  [IGNIVAR_EMBER_SENTINEL_ID]: 'mob_ignivar_ember_sentinel',
  [IGNIVAR_CINDER_ARTIFICER_ID]: 'mob_ignivar_cinder_artificer',
  [VARKHUL_BOSS_ID]: 'mob_varkhul_forgefather',
  wildheart_stalker: 'mob_wildheart_stalker',
  wildheart_ravager: 'mob_wildheart_ravager',
  wildheart_hexcaller: 'mob_wildheart_hexcaller',
  wildheart_beastmaster: 'mob_wildheart_beastmaster',
  wildheart_high_priest: 'mob_wildheart_high_priest',
  // The Drakelands dragonkin brood (v0.35): per-template overrides so the
  // rework replaces every dragon model IN THE DRAKELANDS (Cindraleth
  // included, re-tinted gold by her template color) while the dragonkin
  // family fallback (the floating dragonevolved wyrm) stays for the sanctum,
  // temple, rift, and Galecrest dragonkin.
  // The Mirefen boss, in both candidate bodies. Nothing spawns either in ordinary play
  // (no camp entry, no world-boss registration); they exist so the two silhouettes can
  // be compared in motion via ?boss=foreman|cyclops (src/game/boss_test_drive.ts).
  balgath_cyclops: 'mob_balgath_cyclops',
  drakemaw_broodlord: 'mob_dragonkin_broodlord',
  cindraleth_maw_matriarch: 'mob_dragonkin_matriarch',
  dragonkin_broodguard: 'mob_dragonkin_broodguard',
  dragonkin_whelp: 'mob_dragonkin_whelp',
  dragonkin_egg: 'mob_dragon_egg',
  // Grubjaw the Glutton: his own body now, not the shared troll stand-in.
  grubjaw: 'mob_grubjaw',
  // Eastbrook Vale's kobolds: the authored rat body, not the goblin stand-in
  // the `burrower` family still falls back to. Scoped to the two zone-1
  // templates on purpose (see mob_kobold_digger): the family also carries the
  // hedge gnome and the willow/fen/harvest sprites, and repointing the family
  // would turn all of them into rats. Zone 3's deeprock_kobold and the Ironvein
  // pair are the natural next adopters, but they are a separate call.
  tunnel_rat: 'mob_kobold_digger',
  // Grix has his own body now (mob_grix), so he no longer shares the Diggers'.
  grix_the_tunnelking: 'mob_grix',
  // Ambient Highwatch stable horse: the Valorsteed mount model (mob_stable_horse
  // above) so it renders as an animated horse, not a humanoid.
  stable_horse: 'mob_stable_horse',
  // Protect Yumi objective cat: the dedicated Meshy familiar
  // (docs/prd/protect-yumi-assets.md item 1, delivered).
  yumi_cat: 'mob_yumi_cat',
  // The Highwatch practice row (sim/content/practice_dummies.ts) is four
  // dummies on one body: same GLB, told apart by the entity tint the visual
  // already applies (tint: 'entity'), so a boss dummy reads as a dummy rather
  // than as a 3.1-scale dragon standing two yards from the training post.
  training_dummy: 'mob_training_dummy',
  friendly_player_dummy: 'mob_training_dummy',
  normal_boss_dummy: 'mob_training_dummy',
  heroic_boss_dummy: 'mob_training_dummy',
  // The Eastbrook hub's two level-5 practice targets (sim/content/
  // practice_dummies.ts): the same shared body again, told apart the same
  // way as the row above (tint: 'entity' on mob_training_dummy). The healing
  // dummy carries a friendly ally color from its template, exactly like
  // friendly_player_dummy above; nothing here decides friend or foe, that is
  // the template's `hostile`/`friendlyPracticeTarget` fields.
  hub_training_dummy: 'mob_training_dummy',
  hub_healing_dummy: 'mob_training_dummy',
  healing_dummy_tank: 'mob_training_dummy',
  healing_dummy_soldier: 'mob_training_dummy',
  healing_dummy_scout: 'mob_training_dummy',
  healing_dummy_caster: 'mob_training_dummy',
  healing_dummy_ranger: 'mob_training_dummy',
  emberkin: 'mob_emberkin',
  gloomshade: 'mob_gloomshade',
  pyre_colossus: 'mob_pyre_colossus',
  water_elemental: 'mob_water_elemental',
  warlock_imp: 'mob_demon_flying',
  warlock_voidwalker: 'mob_demonalt',
  guardian_tithefiend: 'mob_demonalt',
  // Active cosmetic buddy followers.
  buddy_horse: 'buddy_horse',
  buddy_crystal_lich: 'buddy_crystal_lich',
  buddy_forgemaw: 'buddy_forgemaw',
  // Packlord Stampede guardians are transient local templates, not MOBS rows.
  // Give the three summoned beasts distinct existing bodies instead of the
  // generic humanoid bandit fallback.
  guardian_stampede_0: 'greyjaw',
  guardian_stampede_1: 'mob_boar',
  guardian_stampede_2: 'mob_raptor',
  // The Fanglord's Whistle's spirit jaguar (a transient trinket guardian):
  // the jade spirit cat of wildheart_creature_looks.ts.
  guardian_fanglords_spirit_jaguar: 'wildheart_spirit_jaguar',
  wild_boar: 'mob_boar',
  // beasts that would otherwise fall back to the wolf model (FAMILY_KEYS.beast)
  old_cragmaw: 'mob_bear',
  bog_bloat: 'mob_murloc',
  // Old Greyjaw: the named rare wolf gets his own custom model (the pack
  // wolves keep the light mob_wolf)
  old_greyjaw: 'greyjaw',
  // The Drowned Litany (Mirefen Marsh): give marsh enemies the right silhouette
  // instead of the family fallback (beast -> wolf, undead -> skeleton minion).
  mirefen_widowling: 'mob_spider',
  spider_egg_sac: 'mob_spider_egg_sac',
  hoard_brood_egg: 'mob_spider_egg_sac',
  hoard_healing_tide_totem: 'mob_healing_tide_totem',
  hoard_bound_pulsar: 'mob_bound_pulsar',
  hoard_abyssal_tentacle: 'mob_abyssal_tentacle',
  hoard_silk_cocoon: 'mob_silk_cocoon',
  hoard_brood_cocoon: 'mob_brood_cocoon',
  hoard_coinsack_scurrier: 'mob_hoard_coinsack_scurrier',
  // The Mother of Mushrooms and her brood.
  hoard_boss_mushroom: 'mob_hoard_boss_mushroom',
  hoard_sporeling: 'mob_hoard_sporeling',
  hoard_boss_mole: 'mob_hoard_boss_mole',
  hoard_boss_bat: 'mob_hoard_boss_bat',
  hoard_bat_swarmling: 'mob_hoard_bat_swarmling',
  hoard_boss_mimic: 'mob_hoard_boss_mimic',
  hoard_bloat_cap: 'mob_hoard_bloat_cap',
  // Broodmother clutch (q_broodmother): the destructible eggs reuse the egg-sac
  // model (not a live spider), and the hatchling is a small spider.
  spider_egg: 'mob_spider_egg_sac',
  widow_hatchling: 'mob_spider',
  sump_troll_devourer: 'mob_troll',
  grave_silt_bulwark: 'mob_ogre',
  // The ogre family's quest boss gets his own body instead of the family's
  // mob_ogre fallback (visualKeyFor checks MOB_KEYS first).
  warlord_drogmar: 'mob_drogmar',
  deepfen_spearjaw: 'mob_spearjaw',
  choir_thrall: 'mob_choir_thrall',
  tolling_bell: 'mob_tolling_bell',
  reedbound_acolyte: 'mob_reedbound_acolyte',
  vael_the_mistcaller: 'bastion_vael',
  vael_fog_shade: 'bastion_vael',
  grand_necromancer_velkhar: 'mob_dark_caster',
  // undead variants by role
  boneclad_revenant: 'skel_warrior',
  marrowlord_varkas: 'skel_warrior',
  bastion_revenant: 'bastion_drowned_revenant',
  tidebound_acolyte: 'bastion_acolyte',
  knight_commander_olen: 'bastion_olen',
  nythraxis_scourge_of_thornpeak: 'skel_golem',
  nythraxis_skeleton_warrior: 'skel_warrior',
  nythraxis_heroic_warrior_add: 'skel_warrior',
  nythraxis_heroic_priest_add: 'skel_necromancer',
  nythraxis_heroic_rogue_add: 'skel_rogue',
  [NYTHRAXIS_BONE_SPIKE_ID]: 'mob_nythraxis_bone_spike',
  graveguard: 'skel_warrior',
  necromancy_skeletal_warrior: 'skel_minion',
  necromancy_bone_mage: 'skel_mage',
  necromancy_gravewing: 'mob_gravewing',
  hollow_acolyte: 'skel_mage',
  sexton_marrow: 'crypt_skel_sexton',
  morthen: 'crypt_morthen_lich',
  cantor_ilvane: 'crypt_skel_cantor',
  hollow_chorister: 'crypt_skel_chorister',
  rimeweb: 'crypt_lady_bonechill',
  crypt_shambler: 'skel_rogue',
  // The Hollow Crypt trash (sim/content/hollow_crypt_trash.ts).
  crypt_ossuary_warrior: 'crypt_skel_warrior',
  crypt_bone_pile: 'crypt_skel_bone_pile',
  crypt_remembrance_candle: 'crypt_rite_candle_body',
  crypt_gravecaller_adept: 'crypt_skel_adept',
  crypt_ossuary_cutthroat: 'crypt_skel_cutthroat',
  crypt_gravecaller_necromancer: 'crypt_skel_necromancer',
  crypt_bone_minion: 'crypt_skel_minion',
  crypt_bone_brute: 'crypt_skel_brute',
  crypt_chapel_gargoyle: 'mob_crypt_gargoyle',
  crypt_carrion_crow: 'mob_crypt_crow',
  crypt_ossuary_drake: 'mob_crypt_drake',
  crypt_knellwyrm: 'mob_crypt_knellwyrm',
  // The Sunken Bastion trash (sim/content/sunken_bastion.ts).
  drowned_watchman: 'bastion_skel_watchman',
  fogbound_arbalest: 'bastion_skel_arbalest',
  barnacle_crawler: 'bastion_crawler',
  bastion_warhound: 'bastion_warhound',
  mistweaver: 'bastion_mistweaver',
  drowned_sergeant: 'bastion_skel_sergeant',
  shackled_prisoner: 'bastion_prisoner',
  gaol_turnkey: 'bastion_turnkey',
  bastion_gaol_cage: 'bastion_gaol_cage',
  bastion_drowned_anchor: 'bastion_drowned_anchor',
  turretback_hermit: 'mob_turretback',
  gaoler_ossick: 'bastion_ossick',
  // The Drowned Temple (sim/content/drowned_temple.ts, temple.ts).
  drowned_templeguard: 'temple_templeguard',
  drowned_pilgrim: 'temple_pilgrim',
  pale_choir_acolyte: 'temple_acolyte',
  moonlit_siren: 'temple_siren',
  ice_wraith: 'temple_ice_wraith',
  lagoon_snapper: 'temple_snapper',
  pearlguard_sentinel: 'temple_sentinel',
  glimmerscale_lurker: 'temple_lurker',
  tidewisp: 'temple_tidewisp',
  moonspawn: 'temple_moonspawn',
  choirmother_selthe: 'temple_selthe',
  tideglass_colossus: 'temple_colossus',
  ysolei: 'temple_ysolei',
  mere_hydra_head_left: 'temple_hydra_head',
  mere_hydra_head_center: 'temple_hydra_head',
  mere_hydra_head_right: 'temple_hydra_head',
  tideglass_reflection: 'temple_reflection_warrior',
  ...WILDHEART_MOB_KEYS,
  ...SANCTUM_MOB_KEYS,
  ...SANCTUM_BOSS_MOB_KEYS,
  ...Object.fromEntries(
    ALL_CLASSES.map((cls) => [`tideglass_reflection_${cls}`, `temple_reflection_${cls}`]),
  ),
  // delve enemies
  reliquary_ledger_wraith: 'delve_skel_wraith',
  reliquary_funeral_ringer: 'delve_skel_ringer',
  reliquary_saintless_effigy: 'delve_skel_effigy',
  deacon_varric: 'delve_skel_varric',
  fallen_captain_aldren: 'skel_warrior',
  corrupted_priest_malric: 'skel_necromancer',
  deathstalker_voss: 'skel_rogue',
  // The Nythraxis phase-2 heroic court is Aldren / Malric / Voss risen again, so
  // the "Spirit of X" adds reuse each character's crypt visual above. Without these
  // the ids fall through to FAMILY_KEYS.undead (skel_minion) and the whole court
  // renders as identical generic skeletons. See spawnNythraxisHeroicAdds.
  // The Mirefen muster's Straw Foreman. Its soldiers wear WOC class bodies
  // (npc_looks.ts MOB_LOOK_IDS), so only the effigy keeps a mob visual here.
  muster_effigy: 'mob_muster_effigy',
  // The court's three visions ride the WOC class bodies of the classes they were.
  vision_aldren_warrior: 'player_warrior',
  vision_malric_mage: 'player_mage',
  vision_deathstalker_voss: 'player_rogue',
  // the Veiled Hollow: stags use the real stag rig instead of the beast-family
  // wolf; the court guardians borrow the golem rig as stone constructs; the
  // spirits, mushroom folk, and treants get realm-only rigs (ghost, glub,
  // yeti) that appear nowhere in the outer three zones
  veiled_stag: 'mob_veiled_stag',
  veiled_doe: 'mob_veiled_doe',
  gleamstag: 'mob_gleamstag',
  gilded_stag: 'mob_stag',
  gloam_fox: 'mob_fox',
  orchard_treant: 'mob_treant',
  lily_wisp: 'mob_ghost',
  ancient_guardian: 'skel_golem',
  waking_warden: 'skel_golem',
  glimmerwisp: 'mob_glimmerwisp',
  duskwisp: 'mob_duskwisp',
  ice_wisp: 'mob_ghost',
  frostmane_yeti: 'mob_yeti',
  sporeling_gatherer: 'mob_glub',
  corrupted_sporeling: 'mob_glub',
  mushroom_pixie: 'mob_mushroom_pixie',
  treant_elder: 'mob_treant',
  old_marrowshell: 'mob_crab',
  aurelhorn: 'mob_aurelhorn',
  // the Nightbloom: silver herds, night-running raptors, hovering star folk;
  // the Barrow King borrows the armored skeleton the other revenants wear
  moonfleece_grazer: 'mob_alpaca',
  gloam_strider: 'mob_raptor',
  nightkin_stargazer: 'mob_nightkin',
  barrow_king: 'skel_warrior',
  // the Wraithwood: drifting wraiths on the ghost rig, walking haunted
  // trees on the treant's, and the hooded Huntsman on the crypt rogue's
  // (the widowsilk spinners take the spider family default)
  wood_wraith: 'mob_ghost',
  gravenbark_shambler: 'mob_treant',
  pale_huntsman: 'skel_rogue',
  // the Palmreach: coral crabs, jungle boars, and the carved-stone guardian
  // (the canopy weavers take the spider family default)
  tide_scuttler: 'mob_crab',
  // the Proving Shore (tutorial island): the strand crab and the straw
  // practice target reuse the shipped crab and training-dummy rigs, and the
  // tide-pool king is the same crab rig grown into his template scale
  shore_scuttler: 'mob_crab',
  mister_crabs: 'mob_crab',
  training_effigy: 'mob_training_dummy',
  thicket_boar: 'mob_boar',
  idol_guardian: 'skel_golem',
  topiary_stag: 'mob_stag',
  the_topiary_bull: 'mob_bull',
  moor_ram: 'mob_alpaca',
  shoal_scuttler: 'mob_crab',
  // The Infernal Citadel: the pact cult's acolytes wear WOC looks (npc_looks.ts
  // MOB_LOOK_IDS); its demons keep the family fallback (mob_demonalt), re-tinted
  // deep red by the templates.
  rift_boss_ritualist: 'rift_ritualist',
  rift_boss_tide: 'mob_hoard_abyssal_maw',
  rift_boss_frost: 'mob_hoard_hoarfrost_warden',
  rift_boss_ember: 'mob_hoard_emberforge_tyrant',
  rift_boss_arcane: 'mob_hoard_archon_nyxaris',
  rift_boss_storm: 'mob_hoard_tempest_vharok',
  rift_tide_thrall: 'mob_hoard_tide_thrall',
  rift_deep_lurker: 'mob_hoard_deep_lurker',
  rift_venom_weaver: 'mob_hoard_venom_weaver',
  rift_thornback: 'mob_hoard_thornback_stalker',
  rift_rime_elemental: 'mob_hoard_rime_elemental',
  rift_frost_revenant: 'mob_hoard_frost_revenant',
  rift_ember_fiend: 'mob_hoard_ember_fiend',
  rift_magma_brute: 'mob_hoard_magma_brute',
  rift_void_acolyte: 'mob_hoard_void_acolyte',
  rift_dread_stalker: 'mob_hoard_dread_stalker',
  rift_storm_caller: 'mob_hoard_storm_caller',
  rift_stormscale: 'mob_hoard_stormscale_drake',
  rift_boneclad: 'mob_hoard_boneclad_warrior',
  rift_marrow_golem: 'skel_golem',
};

const FAMILY_KEYS: Record<string, string> = {
  beast: 'mob_wolf',
  // a humanoid with no look of its own (npc_looks.ts MOB_LOOK_IDS) draws as a
  // person too: the rogue's WOC body, never the KayKit outlaw
  humanoid: 'player_rogue',
  mudfin: 'mob_murloc',
  spider: 'mob_spider',
  burrower: 'mob_kobold',
  undead: 'skel_minion',
  troll: 'mob_troll',
  ogre: 'mob_ogre',
  elemental: 'mob_elemental',
  dragonkin: 'mob_dragonkin',
  demon: 'mob_demonalt',
  // deepfen_spearjaw already has an explicit MOB_KEYS override to mob_spearjaw
  // (visualKeyFor checks MOB_KEYS first), so this default stays unreachable
  // for it even after its family retag. It only matters for a future reptile
  // mob with no override of its own; reuse the same model so that fallback
  // is sane too.
  reptile: 'mob_spearjaw',
};

// Fallback only: the stock rig of an NPC with NO row in npc_looks.ts (none ships),
// so the rows and their comments name the old bodies, not what the world draws.
const NPC_KEYS: Record<string, string> = {
  infiltrator_captain: 'npc_knight',
  infiltrator_nella: 'npc_knight',
  infiltrator_orin: 'npc_knight',
  infiltrator_bram: 'npc_knight',
  infiltrator_tessa: 'npc_knight',
  calligraphy_instructor: 'npc_villager_robed',
  cantor_laverock: 'npc_laverock',
  calligraphy_apprentice_1: 'npc_villager',
  calligraphy_apprentice_2: 'npc_villager',
  bursar_fernando: 'npc_fernando',
  card_master: 'npc_villager_robed',
  marshal_redbrook: 'npc_knight',
  warden_fenwick: 'npc_knight',
  captain_thessaly: 'npc_knight',
  // The two WARFARE quartermasters (one stock, two placements). Both sell the
  // game's most prestigious armor and both fell through to the tinted villager
  // body before this, which read as a townsperson selling epics; the armored
  // knight silhouette (helmet, cape, sword) is the same reuse captain_thessaly
  // makes and needs no new asset.
  warmarshal_draven_kole: 'npc_knight',
  fury: 'npc_knight',
  loremaster_caddis: 'npc_mage',
  smith_haldren: 'npc_smith',
  armorer_hode: 'npc_smith',
  foreman_odell: 'npc_smith',
  scout_maren: 'npc_scout',
  scout_maren_highwatch: 'npc_scout',
  apothecary_lin: 'npc_villager_robed',
  herbalist_yara: 'npc_villager_robed',
  trader_wilkes: 'npc_villager',
  fisherman_brandt: 'npc_villager',
  provisioner_hale: 'npc_villager',
  quartermaster_bree: 'npc_villager',
  brother_halven: 'npc_reliquary_keeper',
  brother_halven_marsh: 'npc_reliquary_keeper',
  chronicler_saul: 'npc_chronicler',
  chronicler_osric_fenn: 'npc_chronicler',
  chronicler_edda_hartwell: 'npc_chronicler',
  // The graveyard angel: a robed figure, rendered translucent (ethereal) with a
  // holy shimmer by the renderer (see the spirit_healer branches there).
  spirit_healer: 'npc_villager_robed',
  // Eldershine, the Veiled Hollow
  keeper_saelwyn: 'npc_mage',
  loremother_bryn: 'npc_villager_robed',
  provisioner_fenna: 'npc_villager',
  wardsmith_orun: 'npc_smith',
  archivist_tullo: 'npc_villager_robed',
  archivist_maelin_emberward: 'npc_villager_robed',
  // Professions 2.0 station masters: existing looks only (no new GLBs). The
  // forge and toolworks masters wear the smith's work apron; the weaver and
  // alchemist match the robed apothecary/herbalist look; the cook and tanner
  // read as working townsfolk.
  forgemistress_darva: 'npc_smith',
  tinker_gizzel: 'npc_smith',
  weaver_ottilie: 'npc_villager_robed',
  alchemist_verane: 'npc_villager_robed',
  cook_marlow: 'npc_villager',
  tanner_hesk: 'npc_villager',
  huntsman_deral: 'npc_scout',
};

/** The fixed-rig visual key of a player of `cls` with the creation pick
 *  `appearance` (the Body tab's male/female segment rides
 *  ModularAppearance.gender). A WOC-bodied class that ships a female body def
 *  (`player_<cls>_female`, a wocCharacter def) uses it for a female pick;
 *  every other case is the class def, and an unknown class the warrior's. The
 *  ONE rule the world, the creation turntable, the sheet, the inspect stage
 *  and the Armory try-on all resolve through. */
export type BodyPick = { readonly gender?: unknown } | null | undefined;

export function playerVisualKey(cls: string, appearance: BodyPick): string {
  const base = `player_${cls}`;
  if (!VISUALS[base]) return 'player_warrior';
  if (appearance?.gender === 'female' && VISUALS[`${base}_female`]?.wocCharacter) {
    return `${base}_female`;
  }
  return base;
}

// The renderer asks for every NPC view's key every frame (its base-visual diff),
// so the key of a look is minted once and read back by the look's own identity.
const npcBodyKeys = new WeakMap<NpcLook, string>();
function npcBodyKey(look: NpcLook): string {
  let key = npcBodyKeys.get(look);
  if (key === undefined) {
    key = playerVisualKey(look.cls, look.app);
    npcBodyKeys.set(look, key);
  }
  return key;
}

/** What a unit frame's portrait draws for a character with an authored look: the
 *  class body the look names and the face it wears on it, the two things the live
 *  headshot lane keys on (portrait.ts visualPortraitDataUrl). */
export interface NpcPortraitSource {
  readonly visualKey: string;
  readonly head: NpcLook['app'];
}

const npcPortraitSources = new WeakMap<NpcLook, NpcPortraitSource>();
/** The portrait source for the template and entity kind a frame holds, null for one
 *  with no authored look (it keeps its crest, or its committed art). One object per
 *  look, so a frame that asks on every repaint allocates nothing. */
export function npcPortraitSourceFor(
  templateId: string,
  kind: Entity['kind'],
): NpcPortraitSource | null {
  const look = npcLookFor(templateId, kind);
  if (!look) return null;
  let source = npcPortraitSources.get(look);
  if (!source) {
    source = { visualKey: npcBodyKey(look), head: look.app };
    npcPortraitSources.set(look, source);
  }
  return source;
}

/** The rig a mob TEMPLATE renders through: its per-template override, else its
 *  family's shared body, else the humanoid fallback. Split out of visualKeyFor
 *  so a caller holding a template id but no live entity (the Collections
 *  window's idle preview) resolves the same key the world draws, instead of
 *  guessing at VISUALS directly and missing every family-keyed mob. */
export function mobVisualKey(templateId: string): string {
  // Quest escortees retain the same authored WOC body in previews and in-world.
  const look = npcLookFor(templateId, 'mob');
  if (look) return npcBodyKey(look);
  const override = MOB_KEYS[templateId];
  if (override) return override;
  const family = MOBS[templateId]?.family;
  return (family && FAMILY_KEYS[family]) || 'mob_bandit';
}

export function visualKeyFor(e: Entity): string {
  if (e.kind === 'player') {
    if (isMechWearer(e)) return 'player_mech';
    return playerVisualKey(e.templateId, e.modularAppearance);
  }
  if (e.kind === 'mob') return mobVisualKey(e.templateId);
  // An NPC wears an authored look on the WOC body of its class and body type
  // (npc_looks.ts), the very def a player of that class draws. One with no
  // authored look (none ships: tests/npc_looks.test.ts) falls back to a stock rig.
  const look = npcLookFor(e.templateId, e.kind);
  if (look) return npcBodyKey(look);
  if (e.templateId.startsWith('brother_aldric')) return 'npc_aldric';
  return NPC_KEYS[e.templateId] ?? 'npc_villager';
}

/** Held-weapon layout override for the class-agnostic Combat Mech body. The mech
 *  keeps its own model and clips but adopts the WEARER class's hand layout, so a
 *  dual-wield class (the rogue) shows the equipped weapon in BOTH hands on the mech
 *  (it shares the KayKit handslot.r/.l bones). Non-dual classes return null and keep
 *  the mech's own single-mainhand default. Host-agnostic: the wearer's class arrives
 *  as a player entity's templateId, so this applies the same offline and online. */
export function mechHeldWeaponOverride(cls: PlayerClass): WeaponLayoutOverride | null {
  const classDef = VISUALS[`player_${cls}`];
  if (!classDef || ((classDef.weaponSlots?.length ?? 0) < 2 && classDef.offhandSlot === undefined))
    return null;
  return {
    attach: classDef.attach,
    weaponSlots: classDef.weaponSlots,
    offhandSlot: classDef.offhandSlot,
  };
}

/** Every glb the manifest can reference (for preloading). */
export function manifestUrls(): string[] {
  const urls = new Set<string>();
  for (const def of Object.values(VISUALS)) {
    // A WOC body streams its base and library, never the weapons it holds: a held prop
    // attaches synchronously at build, so those stay in the boot gate in their own right
    // (the warlock's wand is held by no other boot def).
    if (def.wocCharacter) for (const a of def.attach ?? []) urls.add(a.url);
    if (def.lazyPreload) continue; // fetched on demand, not at boot
    urls.add(def.url);
    for (const url of def.animUrls ?? []) urls.add(url);
    for (const a of def.attach ?? []) urls.add(a.url);
  }
  // The props an NPC holds ride no def of their own (npcHeldProps), so they are
  // named here for the boot gate. One is also an Armory weapon-skin model (the
  // brasscrown walking staff), which assets.ts streams on demand like every skin:
  // the first NPC that holds it builds fail-soft once it lands, as before.
  for (const attach of Object.values(NPC_PROP_ATTACH)) for (const a of attach) urls.add(a.url);
  // Equipped-weapon models a player may swap to at runtime (any nearby player's
  // gear), so they are resolved-and-ready when setWeapon attaches them.
  for (const url of itemWeaponModelUrls()) urls.add(url);
  for (const url of itemOffhandModelUrls()) urls.add(url);
  // Season 1 Armory weapon-skin models: also attachable on any nearby player at
  // any moment (account-wide cosmetics), so they preload with the same sweep.
  for (const url of weaponSkinModelUrls()) urls.add(url);
  return [...urls];
}

export function visualAssetUrlForGraphics(url: string, standardMaterials: boolean): string {
  return standardMaterials ? url : (LOW_URL_ALIAS[url] ?? url);
}

export function manifestUrlsForGraphics(standardMaterials: boolean): string[] {
  return [
    ...new Set(manifestUrls().map((url) => visualAssetUrlForGraphics(url, standardMaterials))),
  ];
}

/**
 * The character/weapon GLB URLs to PRELOAD, given the graphics tier guessed when
 * assets.ts was first imported. This MUST be tier-INDEPENDENT (a superset of every
 * tier's placement set).
 *
 * Character placement resolves asset URLs against the LIVE GFX tier through
 * assetUrl()/visualAssetUrlForGraphics, and resolvedGltf() throws "character asset not
 * preloaded" synchronously when the resolved URL was never loaded. The live tier is
 * set by initGfxTier() inside the Renderer constructor, AFTER assets.ts froze its
 * import-time GFX best-guess. On low gfx, LOW_URL_ALIAS swaps one body GLB
 * (rogue_hooded.glb -> rogue.glb), so manifestUrlsForGraphics(false) is a STRICT
 * subset of manifestUrlsForGraphics(true). If the import-time guess is low but the
 * renderer resolves medium+, the very common mob_bandit body (rogue_hooded.glb, the
 * humanoid-family default AND the global mob fallback) is placed yet was never
 * preloaded, crashing world entry: the character-side twin of the v0.16.0 props P0.
 * So preload the UNION across both tiers, exactly as foliage.ts is immune by sourcing
 * one frozen list for both preload and placement.
 *
 * The arg is retained to document the invariant and to let the guard test assert it at
 * the lowest (most dangerous) import tier; the result intentionally ignores it.
 */
export function characterPreloadUrls(_importTierStandardMaterials: boolean): string[] {
  return [...new Set([...manifestUrlsForGraphics(true), ...manifestUrlsForGraphics(false)])];
}

export function visibleAttachmentsForGraphics(
  def: Pick<VisualDef, 'attach'>,
): readonly AttachDef[] {
  return def.attach ?? [];
}
