/** Final Edict: the verdict is carried high and driven down. The Paladin raises
 * the weapon, draws it back over the right shoulder and lunges, cutting down
 * across the body (the WoC rig's Woc_Special_1H). Light gathers on the rising
 * weapon, a blade of light follows it down its true path, and as it lands the
 * edict's seal (a ring about a planted sword) is stamped on the ground beneath
 * the victim. Under Ascension the blow also releases the Holy
 * explosion: a shockwave from the Paladin's feet out to its true reach, held
 * there as a ring, and the seal stamped under every enemy it strikes.
 * Units are world yards and seconds after the confirmed combat outcome. */

/** The lunging cut lands this long after the strike resolves: Woc_Special_1H
 * carries the weapon across the victim at 0.35 s (FINAL_EDICT_CLIP_CONTACT).
 * The light, the jolt and the flinch wait for it, so the blow is seen to do
 * the damage. */
export const FINAL_EDICT_LAND = 0.35;
/** The attack clip Final Edict plays on the WoC rig, and when it connects. */
export const FINAL_EDICT_CLIP = 'Woc_Special_1H';
export const FINAL_EDICT_CLIP_CONTACT = 0.35;
/** The light plays out over this long once the blow lands. */
export const FINAL_EDICT_AFTER = 0.75;
export const FINAL_EDICT_DURATION = FINAL_EDICT_LAND + FINAL_EDICT_AFTER;
export const FINAL_EDICT_CAPACITY = 8;
export type EdictOutcome = 'damage' | 'absorb' | 'none';

export function finalEdictOutcome(kind: string, amount: number, absorbed = 0): EdictOutcome {
  if (kind !== 'hit' && kind !== 'block') return 'none';
  if (amount > 0) return 'damage';
  return absorbed > 0 ? 'absorb' : 'none';
}

interface EdictContact {
  source: number;
  target: number;
  outcome: EdictOutcome;
  critical: boolean;
  area: boolean;
}

/** Damage precedes the companion in one delivered simulation event batch.
 * Ascension brackets its separately resolved area hits with nova/impact cues.
 * End-of-frame expiry prevents an unmatched event from authorizing a later hit. */
export class FinalEdictContacts {
  private readonly slots: EdictContact[] = Array.from({ length: 32 }, () => ({
    source: -1,
    target: -1,
    outcome: 'none',
    critical: false,
    area: false,
  }));
  private cursor = 0;

  private slot(source: number): EdictContact {
    const existing = this.slots.find((slot) => slot.source === source);
    if (existing) return existing;
    const slot = this.slots[this.cursor++ % this.slots.length];
    slot.source = source;
    slot.target = -1;
    slot.outcome = 'none';
    slot.critical = false;
    slot.area = false;
    return slot;
  }

  record(source: number, target: number, outcome: EdictOutcome, critical: boolean): void {
    const slot = this.slot(source);
    if (slot.area) return;
    slot.target = target;
    slot.outcome = outcome;
    slot.critical = critical;
  }

  area(source: number, active: boolean): void {
    const slot = this.slot(source);
    slot.target = -1;
    slot.outcome = 'none';
    slot.area = active;
  }

  /** Between Ascension's nova and impact cues: the explosion's hits are landing. */
  inArea(source: number): boolean {
    return this.slots.some((slot) => slot.source === source && slot.area);
  }

  take(source: number, target: number): EdictContact | null {
    const slot = this.slots.find((slot) => slot.source === source);
    if (!slot) return null;
    const matched = slot.target === target && !slot.area;
    slot.source = -1;
    slot.target = -1;
    return matched ? slot : null;
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.source = -1;
      slot.target = -1;
      slot.outcome = 'none';
      slot.area = false;
    }
    this.cursor = 0;
  }
}

/** Shared Paladin swatches (sRGB). Dawnfall borrows these as well. */
export const FINAL_EDICT_PALETTE = {
  ivory: 0xfff1cc,
  gold: 0xe8bb76,
  bronze: 0x947047,
  charcoal: 0x302c29,
  peach: 0xd99e8b,
} as const;

/** The recipient is tracked until the blow lands and this long after; the
 * light then stays where it struck. */
export const FINAL_EDICT_FOLLOW = 0.085;
export const FINAL_EDICT_SLASH_SEGMENTS = 24;
export const FINAL_EDICT_SPARKS = 12;
/** The chop, contact flare, the empowered weapon, the seal, then sparks. */
export const FINAL_EDICT_QUADS_PER_CAST = FINAL_EDICT_SLASH_SEGMENTS + 3 + FINAL_EDICT_SPARKS;
export const FINAL_EDICT_VERTICES_PER_CAST = FINAL_EDICT_QUADS_PER_CAST * 6;
/** An absorbed verdict only pings: the weapon's light, a small flare and a
 * shield ring. No blade and no seal: nothing was sentenced. */
export const FINAL_EDICT_ABSORB_VERTICES = 3 * 6;
/** The seal stamped under the victim, in yards. */
export const EDICT_SEAL_RADIUS = 1.05;

/** The Ascension explosion (the sim's radius rides the cue; this is its default). */
export const FINAL_EDICT_WAVE_RADIUS = 6;
export const FINAL_EDICT_WAVE_CAPACITY = 4;
export const EDICT_WAVE_EDGE_SEGMENTS = 64;
export const EDICT_WAVE_SHOCK_SEGMENTS = 48;
export const EDICT_WAVE_SPOKES = 12;
export const FINAL_EDICT_WAVE_VERTICES =
  (EDICT_WAVE_EDGE_SEGMENTS + EDICT_WAVE_SHOCK_SEGMENTS + EDICT_WAVE_SPOKES) * 6;
/** Shockwave travel to the edge, how long the edge then holds the reach, and
 * its fade; seconds after the blow lands. */
export const EDICT_WAVE = { grow: 0.22, hold: 0.7, fade: 0.25 } as const;
export const FINAL_EDICT_WAVE_DURATION = EDICT_WAVE.hold + EDICT_WAVE.fade;
/** Each enemy the explosion strikes: its seal and a flare. */
export const FINAL_EDICT_STAMP_CAPACITY = 16;
export const FINAL_EDICT_STAMP_VERTICES = 2 * 6;
export const EDICT_STAMP_DURATION = 0.6;
export const EDICT_STAMP_SCALE = 0.6;

/** The cut when the weapon cannot be followed: an arc from high over the
 * Paladin's right shoulder down through the victim to low on their left, the
 * clip's diagonal (`lean`, radians the plane leans right of upright). */
export const EDICT_SLASH = {
  radius: 1.5,
  from: 2.2,
  to: -0.75,
  width: 0.62,
  lift: 0.2,
  lean: 0.7,
} as const;
/** The blade of light that follows the weapon's tip through its swing: it
 * starts `lead` seconds before the blow lands (the raise as well as the
 * downswing), keeps `points` samples of the path, and each part of it burns
 * out `life` seconds after the weapon passes. */
export const EDICT_TRAIL = { lead: 0.3, hold: 0.04, life: 0.22, points: 28 } as const;
/** Slash reveal and retreat. `head` sweeps the arc; `tail` then consumes it. */
export const EDICT_SLASH_SWEEP = 0.07;
export const EDICT_SLASH_TAIL = { delay: 0.05, span: 0.24 } as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
function smooth(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export interface EdictSlashWindow {
  head: number;
  tail: number;
}
/** Visible span of the chop arc as fractions from its start (`age` after landing). */
export function edictSlashWindow(age: number, reducedMotion: boolean, out: EdictSlashWindow): void {
  out.head = reducedMotion ? 1 : clamp01(age / EDICT_SLASH_SWEEP);
  out.tail = clamp01((age - EDICT_SLASH_TAIL.delay) / EDICT_SLASH_TAIL.span);
}

export type EdictPart = 'weapon' | 'slash' | 'flare' | 'ring' | 'seal' | 'spark';
/** Per-part brightness envelopes, `age` in seconds after the blow lands.
 * Only the weapon is lit before it (gathering light through the raise); every
 * part is zero at and after FINAL_EDICT_AFTER. */
export function edictAlpha(part: EdictPart, age: number, critical: boolean): number {
  if (age >= FINAL_EDICT_AFTER || age < -FINAL_EDICT_LAND) return 0;
  const boost = critical ? 1.2 : 1;
  if (age < 0) return part === 'weapon' ? 0.3 + 0.7 * smooth(1 + age / FINAL_EDICT_LAND) : 0;
  switch (part) {
    case 'weapon':
      return 1.3 * boost * (1 - smooth((age - 0.04) / 0.24));
    case 'slash':
      return 1.4 * boost * (1 - smooth((age - 0.22) / 0.07));
    case 'flare':
      return 1.15 * boost * Math.exp(-age * 13);
    case 'ring':
      return 1.0 * (1 - clamp01(age / 0.3)) ** 1.5;
    case 'seal':
      return 0.85 * boost * (1 + 0.9 * Math.exp(-age * 16)) * (1 - smooth((age - 0.3) / 0.4));
    case 'spark':
      return 1.1 * boost;
  }
}

/** The seal's stamp: it lands a little large and settles to size. */
export function edictSealScale(age: number): number {
  return 1 + 0.3 * (1 - smooth(age / 0.08));
}

export interface EdictWavePose {
  /** Shockwave front, in yards from the Paladin. */
  front: number;
  shock: number;
  edge: number;
  spokes: number;
}
/** The Ascension explosion `age` seconds after the blow lands. */
export function edictWavePose(
  age: number,
  radius: number,
  reducedMotion: boolean,
  out: EdictWavePose,
): void {
  const grow = clamp01(age / EDICT_WAVE.grow);
  const ease = reducedMotion ? 1 : 1 - (1 - grow) ** 3;
  out.front = radius * (0.1 + 0.9 * ease);
  const live = age >= 0 && age < FINAL_EDICT_WAVE_DURATION;
  out.shock = live && !reducedMotion ? 1.1 * (1 - smooth((grow - 0.55) / 0.45)) : 0;
  // The reach is drawn as the front arrives, flares, then holds steady.
  const arrived = reducedMotion ? 1 : smooth((grow - 0.75) / 0.25);
  const fade = 1 - smooth((age - EDICT_WAVE.hold) / EDICT_WAVE.fade);
  out.edge = live
    ? arrived * (0.75 + 0.7 * Math.exp(-Math.max(0, age - EDICT_WAVE.grow) * 9)) * fade
    : 0;
  out.spokes = live && !reducedMotion ? 0.8 * (1 - smooth((age - 0.08) / 0.3)) : 0;
}

/** When the shockwave reaches `distance` yards out, in seconds after landing. */
export function edictWaveArrival(distance: number, radius: number): number {
  const f = clamp01((distance / Math.max(radius, 0.001) - 0.1) / 0.9);
  return EDICT_WAVE.grow * (1 - Math.cbrt(1 - f));
}

/** An enemy struck by the explosion: its seal and flare (`age` after the wave reaches it). */
export function edictStampAlpha(age: number): number {
  if (age < 0 || age >= EDICT_STAMP_DURATION) return 0;
  return (0.8 + 0.8 * Math.exp(-age * 14)) * (1 - smooth((age - 0.2) / 0.4));
}

export interface EdictSpark {
  /** Offset from the contact point, in the strike basis (forward, up, side). */
  forward: number;
  up: number;
  side: number;
  /** Velocity in the same basis, for streak orientation. */
  vForward: number;
  vUp: number;
  vSide: number;
  alpha: number;
}
const GRAVITY = 9;
/** Deterministic spray thrown onward through the victim, falling under gravity
 * (`age` after the blow lands). */
export function sampleEdictSpark(
  index: number,
  age: number,
  reducedMotion: boolean,
  critical: boolean,
  out: EdictSpark,
): void {
  const spread = index * 2.399963;
  const speed = (critical ? 1.25 : 1) * (reducedMotion ? 0.2 : 1);
  const delay = (index % 4) * 0.012;
  const life = 0.28 + (index % 5) * 0.05;
  const t = age - delay;
  const u = t / life;
  out.vForward = (1.4 + (index % 4) * 0.6) * speed;
  out.vSide = Math.sin(spread) * 2.2 * speed;
  out.vUp = (2.4 + (index % 5) * 0.7) * speed;
  const time = Math.max(0, t);
  const fall = reducedMotion ? 0 : GRAVITY;
  out.forward = out.vForward * time;
  out.side = out.vSide * time;
  out.up = out.vUp * time - 0.5 * fall * time * time;
  out.vUp -= fall * time;
  out.alpha = t < 0 || u >= 1 || age >= FINAL_EDICT_AFTER ? 0 : (1 - u) ** 1.2;
}
