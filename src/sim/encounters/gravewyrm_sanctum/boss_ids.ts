// The Gravewyrm Sanctum bosses' contract (phase B), a dependency-free leaf
// re-exported by ids.ts: the ids shared by the sim (korgath.ts, velkhar.ts,
// korzul.ts), the renderer (render/gravewyrm_sanctum_bosses/ and the boss
// looks' clip maps), the HUD alerts, the i18n catalog and the tests. Add,
// never rename. Every number is NORMAL and LANDED on a level-20 cloth wearer
// of about 950 health (docs/design/dungeon-rework/gravewyrm_sanctum.md
// section 6); heroic scales the damage through the claim's mechanicDamageMult.

// ---- Korgath the Bound (design 6.1): the four chains -------------------------

/** The four seal pillars' tools, in SEAL_PILLARS order (NW, NE, SE, SW). */
export type SealTool = 'hammer' | 'tongs' | 'anvil' | 'bellows';
export const SEAL_TOOLS: readonly SealTool[] = ['hammer', 'tongs', 'anvil', 'bellows'];

/** The Seal Shackles: one attackable stationary part per pillar (a mob
 *  template each, so its nameplate names its chain), pinned at the pillar's
 *  `shackle` spot. Its death breaks that chain. */
export const SEAL_SHACKLE_IDS: Readonly<Record<SealTool, string>> = {
  hammer: 'sanctum_shackle_hammer',
  tongs: 'sanctum_shackle_tongs',
  anvil: 'sanctum_shackle_anvil',
  bellows: 'sanctum_shackle_bellows',
};

/** Lockbound: on Korgath while any chain holds (`buff_dr`, value = 0.2 per
 *  intact chain). */
export const KORGATH_LOCKBOUND = 'sanctum_korgath_lockbound';
/** Maul Arc (Hammer chain freed): a bar, then a frontal 180 degree cleave. */
export const KORGATH_MAUL_ARC = 'sanctum_korgath_maul_arc';
/** Chain Flail (Tongs chain freed): a bar painting a lane at a player
 *  (`castTargetId`, facing locked), then the whip down it. */
export const KORGATH_CHAIN_FLAIL = 'sanctum_korgath_chain_flail';
/** Threshold Charge (Anvil chain freed): a bar painting a lane at the farthest
 *  player (`castTargetId`, facing locked), then the charge with a knockback. */
export const KORGATH_THRESHOLD_CHARGE = 'sanctum_korgath_threshold_charge';
/** Foreman's Bellow (Bellows chain freed): a bar, then a hit on everyone and a
 *  shove away from him. */
export const KORGATH_BELLOW = 'sanctum_korgath_foremans_bellow';
/** Strain: a bar while he hauls on every chain he still wears; then a ring
 *  round each INTACT pillar. */
export const KORGATH_STRAIN = 'sanctum_korgath_strain';
/** Shuddering Stomp (kept, now telegraphed): a bar, then a ring round him. */
export const KORGATH_STOMP = 'sanctum_korgath_stomp';
/** His enrage under 30 percent (a damage-done aura). */
export const KORGATH_ENRAGE = 'sanctum_korgath_enrage';
/** A chain breaks: a `nova` spellfx (source and target = the chain object). */
export const KORGATH_CHAIN_BREAK = 'sanctum_korgath_chain_break';
/** Heroic Re-rivet: the Goadsmith's channel bar at a broken pillar
 *  (`castTargetId` = that pillar's chain object). */
export const GOADSMITH_RERIVET = 'sanctum_goadsmith_rerivet';
/** A Re-rivet completes: a `nova` spellfx on the chain object. */
export const KORGATH_RERIVETED = 'sanctum_korgath_reriveted';

/** The chain state objects: one per pillar for the fight (at the shackle
 *  spot); the renderer draws the chain from Korgath's harness anchor
 *  (Anchor_Hammer, Anchor_Tongs, Anchor_Anvil, Anchor_Bellows) to it. */
export type SealChainState = 'intact' | 'broken';
export const SANCTUM_CHAIN_PREFIX = 'sanctum_chain_';
export function sealChainTemplate(tool: SealTool, state: SealChainState): string {
  return `${SANCTUM_CHAIN_PREFIX}${tool}_${state}`;
}
export function sealChainOf(templateId: string): { tool: SealTool; state: SealChainState } | null {
  if (!templateId.startsWith(SANCTUM_CHAIN_PREFIX)) return null;
  const [tool, state] = templateId.slice(SANCTUM_CHAIN_PREFIX.length).split('_');
  if (!SEAL_TOOLS.includes(tool as SealTool)) return null;
  if (state !== 'intact' && state !== 'broken') return null;
  return { tool: tool as SealTool, state };
}
export const SEAL_CHAIN_TEMPLATES: readonly string[] = SEAL_TOOLS.flatMap((t) => [
  sealChainTemplate(t, 'intact'),
  sealChainTemplate(t, 'broken'),
]);

export const KORGATH_TUNING = {
  /** Damage taken cut per intact chain. */
  lockboundPerChain: 0.2,
  /** Seal Shackle health (normal, before the dungeon's tuning). */
  shackleHp: 1500,
  /** Until the Anvil chain breaks he cannot leave this many yards of KORGATH_SPOT. */
  leashRadius: 10,
  maulEvery: 10,
  maulFirst: 4,
  /** The frontal cleave's bar: long enough to read the half-circle and walk
   *  out of it (a playtest found 1.2 s too short to react to). */
  maulCast: 1.6,
  maulRange: 8,
  maulArcDeg: 180,
  /** Maul Arc lands this many times his melee swing. */
  maulMeleeMult: 1.3,
  flailEvery: 14,
  flailFirst: 6,
  flailCast: 2,
  flailLength: 25,
  flailHalfWidth: 2,
  flailMin: 200,
  flailMax: 240,
  chargeEvery: 18,
  chargeFirst: 8,
  chargeCast: 2,
  chargeLength: 30,
  chargeHalfWidth: 2.5,
  chargeRun: 0.8,
  chargeMin: 180,
  chargeMax: 220,
  chargeKnockback: 10,
  bellowEvery: 20,
  bellowFirst: 10,
  bellowCast: 2,
  bellowMin: 100,
  bellowMax: 120,
  bellowShove: 6,
  strainEvery: 20,
  strainFirst: 12,
  /** Heroic Last Link: Strain every 10 s while exactly one chain remains. */
  strainEveryLastLink: 10,
  strainCast: 2,
  strainRadius: 8,
  strainMin: 180,
  strainMax: 220,
  strainKnockback: 8,
  stompEvery: 12,
  stompFirst: 7,
  stompCast: 1.5,
  stompRadius: 10,
  stompMin: 190,
  stompMax: 285,
  enrageAtHpPct: 0.3,
  /** Heroic Re-rivet: a Goadsmith runs out this long after a chain breaks and
   *  channels this long at its pillar. */
  rerivetDelay: 25,
  rerivetChannel: 6,
  /** After any of his strikes lands (a bar's end, or the charge's run) he
   *  takes this long before the next bar starts: no frontal ever chains
   *  straight into another. */
  barGap: 1,
} as const;

/** Korgath's drawn body radius: every strike of his reaches from his edge. */
export const KORGATH_BODY = 2.5;

/** How far each of Korgath's floor strikes truly reaches from his centre
 *  (yards): what the sim hits and what the floor telegraph draws, so the
 *  shape on the floor is the whole danger from the bar's first frame. */
export const KORGATH_REACH = {
  maul: KORGATH_TUNING.maulRange + KORGATH_BODY,
  stomp: KORGATH_TUNING.stompRadius + KORGATH_BODY,
  flail: KORGATH_TUNING.flailLength + KORGATH_BODY,
  charge: KORGATH_TUNING.chargeLength + KORGATH_BODY,
} as const;

// ---- Grand Necromancer Velkhar (design 6.2): where the dead fall ----------------

/** Waking Thaw: a pyre flares (`nova` spellfx on the flare object) and two
 *  Bonewalkers climb out of its pool. */
export const VELKHAR_WAKING_THAW = 'sanctum_velkhar_waking_thaw';
/** Soulfire Trench: a bar painting a lane at a player (`castTargetId`, facing
 *  locked); the lane then stays as a meltwater strip. */
export const VELKHAR_SOULFIRE_TRENCH = 'sanctum_velkhar_soulfire_trench';
/** Shadow Volley: a bar, then a hit on everyone. */
export const VELKHAR_SHADOW_VOLLEY = 'sanctum_velkhar_shadow_volley';
/** The tithe returned: a `nova` spellfx on Velkhar each time a Bonewalker
 *  rises again (he heals). */
export const VELKHAR_TITHE = 'sanctum_velkhar_tithe';
/** Grasp of the Thawed: on a Bonewalker standing in meltwater (damage done). */
export const VELKHAR_GRASP = 'sanctum_velkhar_grasp_of_the_thawed';
/** Heroic Twice-Woken: on a Bonewalker that rose again (damage done). */
export const VELKHAR_TWICE_WOKEN = 'sanctum_velkhar_twice_woken';
/** A Bonewalker Held on cold ice: a `nova` spellfx on its statue object. */
export const VELKHAR_HELD = 'sanctum_velkhar_held';
/** A Bonewalker Unquenched in meltwater: a `nova` spellfx on its ring object. */
export const VELKHAR_UNQUENCHED = 'sanctum_velkhar_unquenched';

/** The pyre about to flare: an object at its pool's centre for the beat before
 *  and the flare itself (scale = the pool's radius). */
export const SANCTUM_PYRE_FLARE = 'sanctum_pyre_flare';
/** A Soulfire Trench's lane, then its meltwater strip: an object at the lane's
 *  START (world), `facing` = its yaw, `scale` = its length; width
 *  VELKHAR_TUNING.trenchWidth. Painted (the 2 s warning) then melted. */
export const SANCTUM_TRENCH_LANE = 'sanctum_trench_lane';
export const SANCTUM_MELT_STRIP = 'sanctum_melt_strip';
/** A Held Bonewalker's rimed statue, where it fell (stays for the fight). */
export const SANCTUM_HELD_STATUE = 'sanctum_held_statue';
/** An Unquenched death: the ring of bubbles counting down its rise (scale =
 *  1). */
export const SANCTUM_UNQUENCHED_RING = 'sanctum_unquenched_ring';
/** Heroic Warm Hands: a puddle melted under a Bonewalker (scale = radius). */
export const SANCTUM_WARM_PUDDLE = 'sanctum_warm_puddle';

export const VELKHAR_TUNING = {
  thawEvery: 30,
  thawFirst: 15,
  /** Seconds the pyre roars before the Bonewalkers climb out. */
  thawWarn: 1.5,
  thawCount: 2,
  /** The kept 66 and 33 percent waves: one from each pool. */
  waveAtHpPct: [0.66, 0.33] as readonly number[],
  /** An Unquenched Bonewalker rises again this long after it sank, at this
   *  share of its health (heroic Twice-Woken: full, and this much more damage). */
  riseDelay: 4,
  riseHpShare: 0.6,
  twiceWokenDamage: 0.25,
  /** Velkhar heals this share of his health each time one rises again. */
  titheHeal: 0.02,
  graspDamage: 0.3,
  trenchEvery: 18,
  trenchFirst: 8,
  trenchCast: 2,
  trenchLength: 38,
  trenchWidth: 4,
  trenchSeconds: 20,
  trenchMin: 200,
  trenchMax: 240,
  volleyEvery: 12,
  volleyFirst: 5,
  volleyCast: 1.5,
  volleyMin: 90,
  volleyMax: 110,
  /** Heroic Warm Hands: a Bonewalker still for this long melts a puddle. */
  warmStill: 3,
  warmRadius: 3,
  warmSeconds: 8,
} as const;

// ---- Korzul the Gravewyrm (design 6.3): fire against a floor -------------------

/** Grave Breath: a bar along the tank's line (facing locked), then a 60 degree
 *  cone; cracks every plate it covers. */
export const KORZUL_GRAVE_BREATH = 'sanctum_korzul_grave_breath';
/** Tail Sweep: a bar, then a rear 120 degree cone with a knockback. */
export const KORZUL_TAIL_SWEEP = 'sanctum_korzul_tail_sweep';
/** Grave Inferno (kept): the stationary channel with four escalating pulses
 *  (a channel bar; a `nova` spellfx per pulse). */
export const KORZUL_GRAVE_INFERNO = 'sanctum_korzul_grave_inferno';
/** Doused: his plate broke under him mid-Inferno (aura on him; `nova` spellfx). */
export const KORZUL_DOUSED = 'sanctum_korzul_doused';
/** Wing Gale: a bar, then everyone pushed away from him. */
export const KORZUL_WING_GALE = 'sanctum_korzul_wing_gale';
/** Airborne: on him for the whole flight (not attackable, off the threat table). */
export const KORZUL_AIRBORNE = 'sanctum_korzul_airborne';
/** Wyrm's Eye: the mark over a player's head (4 s); its plate burns at the end. */
export const KORZUL_WYRMS_EYE = 'sanctum_korzul_wyrms_eye';
/** Plunging Fire: a bar on him (`castTargetId` = the plate's fire object), then
 *  a `nova` spellfx on the fire object. */
export const KORZUL_PLUNGING_FIRE = 'sanctum_korzul_plunging_fire';
/** Brood from Below: a `nova` spellfx on a Scaleguard as it climbs out. */
export const KORZUL_BROOD = 'sanctum_korzul_brood_from_below';
/** Crashing Descent: a bar while his shadow grows, then a `nova` on landing. */
export const KORZUL_CRASHING_DESCENT = 'sanctum_korzul_crashing_descent';
/** His pull: he bursts out of the ice (Break Free's bar, a `nova` spellfx). */
export const KORZUL_BREAK_FREE = 'sanctum_korzul_break_free';
/** Break Free's end: he lands on the arena centre (a `nova` spellfx; no damage). */
export const KORZUL_TOUCHDOWN = 'sanctum_korzul_touchdown';
/** The last phase: the shard flares (aura on him). */
export const KORZUL_SHARD_FLARE = 'sanctum_korzul_shard_flare';
export const KORZUL_ENRAGE = 'sanctum_korzul_enrage';
/** In a broken plate's water: slowed, and burned (aura on the player). */
export const SANCTUM_QUENCH_WATER = 'sanctum_quench_water';

/** The plate floor: one object per LAKE_PLATES entry, at its centre (scale =
 *  its radius). Its template carries its state; a cracked plate also carries
 *  its refreeze clock in tenths (10 just cracked, 0 refreezing now), or
 *  `deep` when it will never refreeze (heroic Deep Quench). */
export type PlateState = 'sound' | 'cracked' | 'broken';
export const SANCTUM_PLATE_PREFIX = 'sanctum_plate_';
export function plateTemplate(state: PlateState, refreezeTenths: number | 'deep' = 10): string {
  if (state !== 'cracked') return `${SANCTUM_PLATE_PREFIX}${state}`;
  const t =
    refreezeTenths === 'deep'
      ? 'deep'
      : String(Math.max(0, Math.min(10, Math.ceil(refreezeTenths))));
  return `${SANCTUM_PLATE_PREFIX}cracked_${t}`;
}
export function plateOf(templateId: string): { state: PlateState; refreeze: number | null } | null {
  if (!templateId.startsWith(SANCTUM_PLATE_PREFIX)) return null;
  const rest = templateId.slice(SANCTUM_PLATE_PREFIX.length);
  if (rest === 'sound' || rest === 'broken') return { state: rest, refreeze: null };
  if (!rest.startsWith('cracked_')) return null;
  const t = rest.slice('cracked_'.length);
  if (t === 'deep') return { state: 'cracked', refreeze: null };
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? { state: 'cracked', refreeze: n / 10 } : null;
}
export const PLATE_TEMPLATES: readonly string[] = [
  plateTemplate('sound'),
  plateTemplate('broken'),
  plateTemplate('cracked', 'deep'),
  ...Array.from({ length: 11 }, (_, i) => plateTemplate('cracked', i)),
];
/** Plunging Fire's whole-plate warning: an object at the plate's centre for
 *  the 3 s warning (scale = the plate's radius). */
export const SANCTUM_PLUNGING_FIRE = 'sanctum_plunging_fire';
/** Crashing Descent's landing shadow: an object at the landing plate's centre
 *  for the 3 s warning (scale = the hit radius). */
export const SANCTUM_LANDING_SHADOW = 'sanctum_landing_shadow';

export const KORZUL_TUNING = {
  breathEvery: 15,
  breathEveryLast: 12,
  breathFirst: 6,
  breathCast: 2,
  breathRange: 30,
  breathArcDeg: 60,
  breathMin: 250,
  breathMax: 300,
  /** A breath cracks at most this many plates (the nearest first). */
  breathPlates: 3,
  tailEvery: 12,
  tailFirst: 9,
  tailCast: 1.2,
  tailRange: 12,
  tailArcDeg: 120,
  tailMin: 200,
  tailMax: 240,
  tailKnockback: 10,
  infernoEvery: 30,
  infernoFirst: 20,
  infernoAtHpPct: [0.5] as readonly number[],
  infernoDuration: 8,
  infernoPulses: 4,
  infernoRadius: 14,
  /** Pulse n (1 to 4) lands n times this (landed). */
  infernoMin: 70,
  infernoMax: 90,
  /** Pulse 2 cracks his plate, pulse 4 breaks it. */
  infernoCrackPulse: 2,
  infernoBreakPulse: 4,
  dousedSeconds: 3,
  /** A Cracked plate left alone refreezes to Sound after this long (normal). */
  refreezeSeconds: 30,
  quenchSlow: 0.5,
  quenchPerSecond: 60,
  quenchPerSecondHeroic: 150,
  /** The flights, at these shares of his health. */
  flightAtHpPct: [0.7, 0.4] as readonly number[],
  flightSeconds: 24,
  galeCast: 1.5,
  galePush: 8,
  galeEveryLast: 20,
  /** Wyrm's Eye marks per flight (first, second). */
  eyesPerFlight: [2, 3] as readonly number[],
  eyeSeconds: 4,
  plungeWarn: 3,
  plungeMin: 300,
  plungeMax: 350,
  broodMax: 3,
  descentWarn: 3,
  descentRadius: 12,
  descentMin: 250,
  descentMax: 300,
  descentKnockback: 10,
  /** The height he hovers at over the lake (yards). */
  flightAltitude: 14,
  enrageAtHpPct: 0.3,
} as const;

/** Korzul's drawn body radius (the template's bodyRadius): his cones reach
 *  from its edge. */
export const KORZUL_BODY_RADIUS = 5;

/** How far his cones truly reach from his centre (yards): what the sim hits
 *  and what the floor telegraph draws. */
export const KORZUL_REACH = {
  breath: KORZUL_TUNING.breathRange + KORZUL_BODY_RADIUS,
  tail: KORZUL_TUNING.tailRange + KORZUL_BODY_RADIUS,
} as const;

/** Every boss-fight object template the Sanctum draws itself. */
export const SANCTUM_BOSS_OBJECT_TEMPLATES: readonly string[] = [
  ...SEAL_CHAIN_TEMPLATES,
  SANCTUM_PYRE_FLARE,
  SANCTUM_TRENCH_LANE,
  SANCTUM_MELT_STRIP,
  SANCTUM_HELD_STATUE,
  SANCTUM_UNQUENCHED_RING,
  SANCTUM_WARM_PUDDLE,
  ...PLATE_TEMPLATES,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_LANDING_SHADOW,
];

/** The new deeds (design section 10), granted by the boss modules through
 *  grantClaimDeed; the records live in content/deeds.ts. */
export const SANCTUM_DEED_IDS = {
  korgathAllChains: 'dgn_korgath_all_chains',
  korgathStillBound: 'dgn_korgath_still_bound',
  velkharCold: 'dgn_velkhar_cold',
  korzulThinIce: 'dgn_korzul_thin_ice',
  sledgeTusker: 'dgn_sledge_tusker',
} as const;
