// The Gravewyrm Sanctum's encounter ids and tuning, as a dependency-free leaf:
// the content (gravewyrm_sanctum.ts), the encounter modules, the trash kit's
// toss rings (mob/trash_kit/sanctum_kit.ts), the dev helpers, the renderer's
// telegraphs and the Calving Face, and the tests all key on these.
//
// docs/design/dungeon-rework/gravewyrm_sanctum.md sections 3, 5 and 6.

import { SANCTUM_BOSS_OBJECT_TEMPLATES } from './boss_ids';

export * from './boss_ids';

export const SANCTUM_DUNGEON = 'gravewyrm_sanctum';

/** The three bosses, in route order (their cores are phase B). */
export const KORGATH_ID = 'korgath_the_bound';
export const VELKHAR_ID = 'grand_necromancer_velkhar';
export const KORZUL_ID = 'korzul_the_gravewyrm';
/** The showpiece patrol of the Sledge Road. */
export const SLEDGE_TUSKER_ID = 'sledge_tusker';
/** The trash (the Boneguard, the Scaleguard and the Bonewalker are shipped). */
export const BONEGUARD_ID = 'sanctum_boneguard';
export const SCALEGUARD_ID = 'sanctum_drakonid';
export const BONEWALKER_ID = 'raised_bonewalker';
export const THAWCALLER_ID = 'broodsworn_thawcaller';
export const GOADSMITH_ID = 'broodsworn_goadsmith';
export const PYRE_TENDER_ID = 'broodsworn_pyre_tender';
export const SOUL_BRAZIER_ID = 'soul_brazier';
export const RIME_WHELP_ID = 'rime_whelp';
export const SLEDGE_HAULER_ID = 'ogre_sledge_hauler';
export const GLACIER_SPLINTER_ID = 'glacier_splinter';

// ---- the Sledge Tusker (section 5.3) -------------------------------------------

/** Tusk Sweep: a sweep of its tusks through a frontal cone, with a knockback. */
export const TUSKER_TUSK_SWEEP = 'sanctum_tusker_tusk_sweep';
/** Trample: a lane painted to the farthest player, then the charge down it. */
export const TUSKER_TRAMPLE = 'sanctum_tusker_trample';
/** The knockdown a Trample leaves (a short stun). */
export const TUSKER_KNOCKDOWN = 'sanctum_tusker_knockdown';
/** Spilled Braziers: the sledge tips at half health (a `nova` spellfx on the
 *  Tusker); three soulfire patches burn on the road. */
export const TUSKER_SPILLED_BRAZIERS = 'sanctum_tusker_spilled_braziers';
/** The damage a burning soulfire patch deals each second (its ability name). */
export const TUSKER_SOULFIRE = 'sanctum_tusker_soulfire';
/** The Tusker's Enrage under a fifth of its health (a damage-done aura). */
export const TUSKER_ENRAGE = 'sanctum_tusker_enrage';
/** Stuck in the Ice: a Trample baited into an ice outcrop buries its tusks in
 *  it. The stun that holds it there (its own, so its control immunity lets it
 *  in) and its twin, the damage window (a `vulnerability` aura for the same
 *  seconds: the renderer frosts the beast and the HUD says "burn it" off it). */
export const TUSKER_STUCK = 'sanctum_tusker_stuck';
export const TUSKER_STUCK_EXPOSED = 'sanctum_tusker_stuck_exposed';
/** The tusks slam into the outcrop (a `nova` spellfx on the Tusker, its target
 *  the outcrop), and the beast wrenching free as the outcrop bursts (a `nova`
 *  spellfx on the outcrop, its source the Tusker). */
export const TUSKER_TUSKS_STICK = 'sanctum_tusker_tusks_stick';
export const TUSKER_BREAKS_FREE = 'sanctum_tusker_breaks_free';
/** A soulfire trail's clock, carried on the trail object as a cast bar (the
 *  replicated presentation clock of an encounter object): `castTotal` the
 *  seconds a trail burns, `castRemaining` what is left. An outcrop the tusks
 *  are buried in carries the stuck seconds the same way. */
export const SANCTUM_TRAIL_BURN = 'sanctum_soulfire_trail_burn';
export const SANCTUM_OUTCROP_HELD = 'sanctum_ice_outcrop_held';

/**
 * The Tusker's numbers (normal; heroic scales the damage through the claim's
 * mechanicDamageMult). Damage is stated LANDED on a level-20 cloth wearer of
 * about 950 health (README section 7): Tusk Sweep about 21 percent, Trample
 * about 19, both avoidable; soulfire (a patch or a trail) about 4 percent a
 * second.
 *
 * The bait rework (2026-10-14, the owner's approved design) adds one source of
 * damage, the soulfire trail, and pays for it out of the Trample:
 *   - A trampled player lies knocked down for 1 s in the lane, and while the
 *     sledge is hitched that lane is burning by then: the trail's first tick
 *     lands on them as they get up. So the Trample itself drops from 200 to
 *     240 to 160 to 200, and with that one tick (36 to 44) a trampled player
 *     takes 196 to 244: what a Trample cost before, to within 4.
 *   - Past that one tick the trail is ground a player chooses to stand on, at
 *     the rate the spilled patches already burn at.
 *   - A baited Trample hits nobody past the outcrop, and a stuck Tusker swings
 *     at nobody for 4 s (about 1.4 of its swings each time).
 * Health, level, loot and the enrage are untouched.
 */
export const TUSKER_TUNING = {
  /** Tusk Sweep: every 12 s a 1.5 s bar, then a frontal 120 degree cone 10 yd
   *  deep from its body's edge (its tusk tips reach 11 yd ahead of its centre). */
  sweepEvery: 12,
  sweepFirst: 5,
  sweepCast: 1.5,
  sweepRange: 10,
  sweepArcDeg: 120,
  sweepMin: 180,
  sweepMax: 220,
  /** Yards the Tusk Sweep throws a player. */
  sweepKnockback: 8,
  /** Trample: every 16 s a 3 s bar painting a lane to the farthest player,
   *  then the charge down it (30 yd, 5 yd wide). The lane FOLLOWS its target
   *  through the bar (the readability pass, 2026-10-15: the owner's call), so
   *  the target can lead the charge into an ice outcrop, and locks
   *  `trampleLock` seconds before the charge so they can step out of it.
   *  The bar was 2 s; it is 3 s so the aim leaves 2.1 s to steer (about
   *  15 yd at a run, enough to put an outcrop between you and the beast) and
   *  the lock keeps the old bar's last 0.9 s. Its damage is untouched; the
   *  beast swings at nobody through the extra second of the bar. */
  trampleEvery: 16,
  trampleFirst: 9,
  trampleCast: 3,
  /** Seconds before the charge the lane stops following its target. The
   *  target stands on the lane's line at the lock: 2.5 yd to its edge is
   *  0.36 s at a run, plus a quarter second to see the lock and a latency
   *  margin, with room to spare inside 0.9 s. Longer and the aim is too
   *  short to steer; shorter and the dodge is a coin toss online. */
  trampleLock: 0.9,
  trampleLength: 30,
  trampleHalfWidth: 2.5,
  /** Seconds the charge takes to run the lane. */
  trampleRun: 0.8,
  /** 160 to 200 (it was 200 to 240): the budget note above. */
  trampleMin: 160,
  trampleMax: 200,
  /** The knockdown (a stun) on everyone the charge runs over. */
  knockdown: 1,
  /** Spilled Braziers: once, at half health: three soulfire patches. */
  spillAtHpPct: 0.5,
  patchRadius: 4,
  patchSeconds: 10,
  patchTick: 1,
  patchMin: 36,
  patchMax: 44,
  /** Where the three patches land in the Tusker's own frame (yards to its
   *  left, yards forward): where its sledge's Tip clip throws the three soul
   *  braziers (the sledge hangs 10.5 yd behind it; E:/woc/entregas/santuario/
   *  tusker NOTAS.md). */
  patchSpots: [
    { left: 5.2, fwd: -8.1 },
    { left: 6.0, fwd: -11.1 },
    { left: 4.8, fwd: -13.7 },
  ],
  /** Enrage under a fifth of its health: 30 percent more damage. */
  enrageAtHpPct: 0.2,
  enrageDamage: 0.3,

  // ---- the ice outcrops (the bait) -------------------------------------------
  /** An outcrop's body: a Trample lane whose strip touches this circle runs
   *  into it (the strip's half width plus this: 4.5 yd off the lane's line). */
  outcropRadius: 2,
  /** The outcrops rise the first time a living player comes this near one
   *  (the Gate Landing stands 68 yd from the nearest; every yard of the
   *  Tusker's road is nearer): never at the claim's own tick, only on the
   *  first tick a living player stands within reach. A party that walks in
   *  through the Gate Landing therefore mints the five (and every later id of
   *  the claim moves up by five, the same on every host); a run that is
   *  staged elsewhere and never comes near mints none, which is what keeps
   *  the heroic five-man parity golden (staged onto Korzul) where it was. */
  outcropWake: 90,
  /** How far ahead of its centre the tusk tips reach (the model's 6.13 at its
   *  drawn size, render/gravewyrm_sanctum_fx/tusker_model_core.ts): it stops
   *  with them buried in the ice. */
  tuskReach: 6,
  /** The run-up it needs: an outcrop whose face stands nearer than this past
   *  its tusk tips is beside its head, not ahead of it, and the lane ignores
   *  it (a beast parked against an outcrop is no bait). */
  baitMinRun: 3,
  /** Stuck in the Ice: 4 s held fast, taking 25 percent more damage for those
   *  4 s. Sized like Zulgar's Sunstruck (25 percent for 3 s), the game's other
   *  short window earned by play each time; the long 10 s windows (Olen's
   *  Breached, Selthe's Broken Voice) are 20. Five baits at most, 20 s in
   *  all: 5 s of the group's damage over a 60 s plan, and no pool moves. */
  stuckSeconds: 4,
  stuckVuln: 0.25,
  /** After it wrenches free neither strike opens for this long: it turns back
   *  on its target first (a sweep at the cliff would be no sweep). */
  stuckRecover: 1.5,

  // ---- the soulfire trail ------------------------------------------------------
  /** While the sledge is still hitched (above half health) every charge drags
   *  it down the lane and its braziers slop soulfire along it: the lane the
   *  beast ran burns, this far either side of its line (the sledge's runners
   *  stand 1.68 either side), at the patches' own 36 to 44 a second. */
  trailHalfWidth: 2,
  /** A trail burns 30 s. Tramples open 16 s apart, so the road carries the
   *  last trail whole and the one before it for its last 14 s: two at most,
   *  never three, and none is laid once the sledge has tipped. A lane is
   *  30 yd by 4 at the longest: two cover 240 square yards of a road of about
   *  1,300 (tests/gravewyrm_sanctum_tusker_bait.test.ts walks a solo player
   *  and a group of four through a whole pull on it). */
  trailSeconds: 30,
  /** The timing above keeps it to two; this is the hard cap, so a dev
   *  trigger or a retune can never stack a third (the oldest goes out). */
  trailMax: 2,
  trailTick: 1,
  /** A charge shorter than this leaves no trail (a lunge spills nothing). */
  trailMinLength: 3,
} as const;

/**
 * The five ice outcrops of the Sledge Road (instance-local yards): fangs of
 * the Quench standing on the road's rim, alternating sides, about 15 yd apart
 * along both legs. Encounter objects raised with the claim (never layout
 * props: nothing collides with them and no layout pin moves); each takes ONE
 * Trample and bursts as the beast wrenches free, so a pull has five baits. A
 * reset pull stands them all up again.
 */
export const TUSKER_OUTCROPS: readonly { x: number; z: number }[] = [
  // The upper leg (the court's foot to the upper bend).
  { x: -12, z: -156.5 },
  { x: -28.8, z: -158.9 },
  // The middle leg (the upper bend to the lower bend).
  { x: -20.8, z: -128.4 },
  { x: -1.9, z: -132.2 },
  { x: 5.9, z: -114.6 },
];

/** The Tusker's chat line when its sledge tips (re-localized by src/ui/sim_i18n.ts). */
export const TUSKER_SPILL_LOG =
  'The sledge tips over! Burning soul braziers spill across the Sledge Road.';
/** The emote as its tusks jam in an outcrop (re-localized by src/ui/sim_i18n.ts). */
export const TUSKER_STUCK_LOG = 'The Sledge Tusker buries its tusks in the ice. It is stuck!';

// ---- encounter objects: their template id carries their look -----------------

/** A burning soulfire patch on the road (scale = radius). */
export const SANCTUM_SOULFIRE_PATCH = 'sanctum_soulfire_patch';
/** A soulfire trail down a charged lane: an object at the lane's START
 *  (world), `facing` = its yaw, `scale` = its length; TUSKER_TUNING.
 *  trailHalfWidth either side. Its cast bar (SANCTUM_TRAIL_BURN) is its clock. */
export const SANCTUM_SOULFIRE_TRAIL = 'sanctum_soulfire_trail';
/** An ice outcrop of the Sledge Road (scale = radius): whole, struck (the
 *  Tusker's tusks are buried in it; its cast bar SANCTUM_OUTCROP_HELD counts
 *  the seconds it holds), and broken (a stump: no more charges this pull). */
export const SANCTUM_ICE_OUTCROP = 'sanctum_ice_outcrop';
export const SANCTUM_ICE_OUTCROP_STRUCK = 'sanctum_ice_outcrop_struck';
export const SANCTUM_ICE_OUTCROP_BROKEN = 'sanctum_ice_outcrop_broken';

/** Is this template an ice outcrop, in any state? */
export function isIceOutcrop(templateId: string): boolean {
  return (
    templateId === SANCTUM_ICE_OUTCROP ||
    templateId === SANCTUM_ICE_OUTCROP_STRUCK ||
    templateId === SANCTUM_ICE_OUTCROP_BROKEN
  );
}
/** An Ice Block Toss's ring where the block will land (scale = radius). */
export const SANCTUM_TOSS_RING = 'sanctum_toss_ring';

// ---- the Calving Face's crack steps (section 3) ----------------------------------

/**
 * The story markers' template ids: the Calving Face's crack step, driven by the
 * run's encounter state (never a timer). Step 0 arrival; 1 the Sledge Tusker is
 * dead; 2 to 5 one to four of Korgath's chains broken (phase B; his death fills
 * them all); 6 Korgath is dead; 7 Velkhar is dead; 8 Korzul is pulled (he tears
 * free and the face collapses). Monotonic for the life of the claim.
 */
export const SANCTUM_STORY_STEPS = 8;
export const SANCTUM_STORY_PREFIX = 'sanctum_story_';

export function sanctumStoryTemplate(step: number): string {
  const s = Math.max(0, Math.min(SANCTUM_STORY_STEPS, Math.floor(step)));
  return `${SANCTUM_STORY_PREFIX}${s}`;
}

/** The crack step a story marker's template id carries, or null for any other
 *  template. */
export function sanctumStoryStepOf(templateId: string): number | null {
  if (!templateId.startsWith(SANCTUM_STORY_PREFIX)) return null;
  const n = Number(templateId.slice(SANCTUM_STORY_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n <= SANCTUM_STORY_STEPS ? n : null;
}

/** The Calving Face's five render stages (design section 3) from a crack step:
 *  0 the hairline crack; 1 the first plate falls; 2 the chains (with
 *  `chains` broken); 3 the lock open; 4 the face calved, the head bare; 5 the
 *  wyrm torn free. */
export function sanctumFaceStage(step: number): { stage: number; chains: number } {
  if (step >= 8) return { stage: 5, chains: 4 };
  if (step >= 7) return { stage: 4, chains: 4 };
  if (step >= 6) return { stage: 3, chains: 4 };
  if (step >= 2) return { stage: 2, chains: step - 1 };
  return { stage: step >= 1 ? 1 : 0, chains: 0 };
}

/** Every template the Sanctum draws itself (the renderer gives each an empty
 *  anchor, render/gate_objects.ts). */
export const SANCTUM_OBJECT_TEMPLATES: ReadonlySet<string> = new Set<string>([
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_SOULFIRE_TRAIL,
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_STRUCK,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_TOSS_RING,
  ...Array.from({ length: SANCTUM_STORY_STEPS + 1 }, (_, i) => sanctumStoryTemplate(i)),
  ...SANCTUM_BOSS_OBJECT_TEMPLATES,
]);
