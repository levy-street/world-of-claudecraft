// What the boss LOOKS like he is doing, derived from what he is actually doing.
//
// A fight this long needs to answer three questions from across the arena without anyone
// reading a buff bar: which phase is he in, is he currently taking or refusing damage, and
// is something about to land. The mechanics already answer all three in sim state; this is
// the layer that turns that state into a palette and an emission rate, so the presentation
// cannot drift from the fight.
//
// Three/DOM/i18n-free and deterministic, so a Vitest drives it directly and the
// RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers it.

/** Everything the presentation needs to know, read off one entity. */
export interface BossVfxState {
  /** Warpath phase, or null for a boss standing outside the circuit entirely. */
  phase: 'focus' | 'travel' | 'wreck' | null;
  /** Barrowhide is up: he is shrugging off damage. */
  shielded: boolean;
  /** Below his enrage threshold. */
  enraged: boolean;
  /** Clawing health back because nobody is hurting him. */
  mending: boolean;
  /** Channelling the scry. */
  casting: boolean;
  /**
   * His ward is pried open: for the next few seconds everyone's damage lands in full.
   *
   * The single most actionable state in the encounter, and until now the ONLY cue for it was
   * a debuff row on his frame plus a chat line the wielder got. The aura is what makes it
   * readable from wherever a player happens to be standing.
   */
  blinded: boolean;
  /** 0..1, for effects that should intensify as he is worn down. */
  wounded: number;
}

/** The look for one frame: a ground aura plus what it is throwing off. */
export interface BossAuraPlan {
  /** Ground disc colour and how strongly it reads. */
  color: number;
  radius: number;
  alpha: number;
  /** Cycles per second of the aura's breath. */
  pulseHz: number;
  /** Motes per second, and their tint. */
  moteRate: number;
  moteColor: number;
  /**
   * Where the motes go: 'rise' drifts them up off the ground, 'inward' pulls them into his
   * chest. Inward is reserved for things he is TAKING IN (healing, hardening), which is the
   * one visual grammar players read instinctively without being taught it.
   */
  moteFlow: 'rise' | 'inward';
}

const EMBER = 0xb8763a; // banked heat: he is planted and fighting
const LOOMSHARD = 0x76e0d8; // his eye's own colour: he is moving with purpose
const KINDLED = 0xffd9a0; // white-hot: something is about to land
const MEND = 0x7fd06a;
const STONE = 0xc9c2b5;
const WRATH = 0xd8412a;
// The blind window's own colour, matched to the `eye_ward_blinded` badge so the aura and the
// picture over his head are unmistakably about the same thing.
const RUPTURED = 0x8bf06a;

/** Read the presentation state off a live entity. */
export function readBossVfxState(e: {
  warpathPhase?: 'focus' | 'travel' | 'wreck';
  auras?: { kind?: string; id?: string }[];
  enraged?: boolean;
  castingAbility?: string | null;
  hp?: number;
  maxHp?: number;
  warpathUnharried?: number;
}): BossVfxState {
  const auras = e.auras ?? [];
  const hp = e.hp ?? 1;
  const maxHp = e.maxHp ?? 1;
  return {
    phase: e.warpathPhase ?? null,
    shielded: auras.some((a) => a.kind === 'absorb'),
    enraged: e.enraged === true,
    // The regen only ever runs while he travels unpunished, and the sim already tracks the
    // clock; reading the same field means the glow cannot claim he is healing when he is
    // not, which is the one thing this cue must never do.
    mending: (e.warpathUnharried ?? 0) >= 3 && hp < maxHp && e.warpathPhase === 'travel',
    casting: !!e.castingAbility,
    // Read by AURA KIND, not by a hardcoded id, exactly as the shield is: the ward mirrors
    // its two timestamps into auras (src/sim/mob/eye_ward.ts) and this is the down one.
    blinded: auras.some((a) => a.id === 'eye_ward_blinded'),
    wounded: Math.min(1, Math.max(0, 1 - hp / Math.max(1, maxHp))),
  };
}

/**
 * The aura for this frame.
 *
 * Priority is deliberate and is about what a player must not miss. Mending outranks the
 * phase colour, because a boss healing is the single most actionable thing on the field;
 * enrage outranks everything, because it changes how long you have left. The phase tint is
 * the resting state underneath both.
 */
export function bossAuraPlan(state: BossVfxState): BossAuraPlan {
  const base: BossAuraPlan = {
    color: EMBER,
    radius: 9,
    alpha: 0.16,
    pulseHz: 0.35,
    moteRate: 5,
    moteColor: EMBER,
    moteFlow: 'rise',
  };
  if (state.phase === 'travel') {
    base.color = LOOMSHARD;
    base.moteColor = LOOMSHARD;
    base.radius = 7.5;
    base.alpha = 0.2;
    base.pulseHz = 0.9;
    base.moteRate = 12;
  }
  if (state.phase === 'wreck') {
    // Winding up: the aura tightens and brightens, and the motes are drawn IN, which is the
    // read that something is being gathered rather than spent.
    base.color = KINDLED;
    base.moteColor = KINDLED;
    base.radius = 12;
    base.alpha = 0.34;
    base.pulseHz = 2.6;
    base.moteRate = 34;
    base.moteFlow = 'inward';
  }
  if (state.casting) {
    base.pulseHz = Math.max(base.pulseHz, 1.6);
    base.moteRate += 10;
    base.moteFlow = 'inward';
  }
  if (state.shielded) {
    base.moteColor = STONE;
    base.moteRate = Math.max(base.moteRate, 16);
    base.moteFlow = 'inward';
  }
  if (state.mending) {
    base.color = MEND;
    base.moteColor = MEND;
    base.alpha = Math.max(base.alpha, 0.26);
    base.moteRate = Math.max(base.moteRate, 26);
    base.moteFlow = 'inward';
  }
  // The blind window outranks the phase AND the mending cue, and sits just under enrage: it
  // is the one state that changes what every other player in the fight should be doing right
  // now, and it lasts seconds rather than minutes.
  if (state.blinded) {
    base.color = RUPTURED;
    base.moteColor = RUPTURED;
    base.alpha = Math.max(base.alpha, 0.4);
    base.pulseHz = Math.max(base.pulseHz, 3.1);
    base.moteRate = Math.max(base.moteRate, 44);
    base.moteFlow = 'rise';
  }
  if (state.enraged) {
    base.color = WRATH;
    base.moteColor = WRATH;
    base.alpha = Math.max(base.alpha, 0.3);
    base.pulseHz = Math.max(base.pulseHz, 2.2);
    base.moteRate = Math.max(base.moteRate, 22);
  }
  // Worn down, he smoulders harder whatever else is true.
  base.alpha = Math.min(0.55, base.alpha * (1 + 0.5 * state.wounded));
  return base;
}

/** Aura opacity at `clock`, breathing at the plan's own rate. */
export function auraAlphaAt(plan: BossAuraPlan, clock: number, reducedMotion = false): number {
  if (reducedMotion) return plan.alpha;
  return plan.alpha * (0.72 + 0.28 * Math.sin(clock * plan.pulseHz * Math.PI * 2));
}

/** How many motes to emit this frame, carrying the fractional remainder forward. */
export function moteBudget(plan: BossAuraPlan, dt: number, carry: number): [number, number] {
  const want = carry + plan.moteRate * dt;
  const n = Math.floor(want);
  return [n, want - n];
}
