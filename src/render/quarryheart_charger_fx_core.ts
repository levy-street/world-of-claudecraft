// Host-agnostic decisions for the Quarryheart Charger's body rig (quarryheart_charger_fx.ts): the
// heart's beat, the arrival timeline (plates flying in round the core, the core igniting, the
// wind waking), the ambient emission rates for each gait, which tier and reduced-motion setting
// keeps what, and the hoof-strike edge that leaves an ember or frost print. No Three, no DOM, no
// clock: the caller passes times and heights, and tests/quarryheart_charger_fx_core.test.ts pins
// the numbers.
//
// Cosmetic only. Nothing here hides or delays anything a player reacts to: the charger's rider,
// nameplate and cast bar are drawn by their own systems whatever this decides, and every rate is
// a ceiling the particle cloud then scales by its own quality (vfx.ts particleRate).

/** The heart's centre in the GLB's bind space (glTF Y up, Z forward, model units): the Blender
 *  build's CORE (0, -0.5, 2.02), Z up and -Y forward, carried into glTF. Pinned against the
 *  build script by the test. */
export const QUARRYHEART_CORE_BIND = [0, 2.02, 0.5] as const;

/** The plate centroids are stored divided by this (charger_body.py CEN_SCALE), so a normalized
 *  quantized attribute carries them. */
export const QUARRYHEART_CEN_SCALE = 6;

/** Seconds between heartbeats: a slow, heavy beat, about fifty a minute. */
export const QUARRYHEART_BEAT_PERIOD = 1.2;

/** How long the arrival takes from the first frame the body draws. */
export const QUARRYHEART_ASSEMBLE_SECONDS = 1.35;

/** A summon edge older than this when the body first draws (a slow lazy GLB, a rider walking
 *  into view already mounted) shows the charger whole instead of replaying an arrival nobody
 *  saw begin. */
export const QUARRYHEART_SUMMON_GRACE_SECONDS = 2.5;

/** When, inside the 1.5 s Rear clip (charger_rig.py rear_ctl), the forehooves strike the ground. */
export const QUARRYHEART_REAR_STRIKE_SECONDS = 1.03;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/**
 * The heartbeat, 0 at rest and 1 at the peak of the first beat: a lub (the full beat) and a
 * softer dub a fifth of a period after it, each a quick rise and a longer fall, then quiet.
 * Under reduced motion the beat becomes a slow breath that never spikes.
 */
export function quarryheartBeat(time: number, reducedMotion: boolean): number {
  const p = (((time / QUARRYHEART_BEAT_PERIOD) % 1) + 1) % 1;
  if (reducedMotion) return 0.5 + 0.5 * Math.sin(p * Math.PI * 2);
  const pulse = (x: number, at: number, width: number): number => {
    const d = (x - at) / width;
    return d < 0 ? Math.exp(-d * d * 9) : Math.exp(-d * d * 2.2);
  };
  return Math.min(1, pulse(p, 0.06, 0.08) + 0.62 * pulse(p, 0.26, 0.08));
}

/** One frame of the arrival, every channel 0..1. */
export interface QuarryheartArrival {
  /** The plates' flight home: 0 scattered round the beast, 1 seated on it. Each plate starts
   *  its own flight off this by its distance from the core (the shader's stagger). */
  assemble: number;
  /** The fire body and the heart: 0 dark, 1 burning. The core catches first, then the fire
   *  spreads out through the gaps as the plates close over it. */
  ignite: number;
  /** The wind mane and tail fading in once the body is whole. */
  wind: number;
  /** The core's ignition flash, a quick spike at the start. */
  flash: number;
  /** True once the arrival is finished (the rig stops asking). */
  done: boolean;
}

/** The arrival at `age` seconds after the body first drew. Reduced motion skips the flight:
 *  the plates are home from the first frame and only the fire fades up, softly. */
export function quarryheartArrival(
  age: number,
  reducedMotion: boolean,
  out: QuarryheartArrival,
): QuarryheartArrival {
  const t = age / QUARRYHEART_ASSEMBLE_SECONDS;
  if (reducedMotion) {
    out.assemble = 1;
    out.ignite = smooth(age / 0.6);
    out.wind = smooth(age / 0.6);
    out.flash = 0;
    out.done = age >= 0.6;
    return out;
  }
  out.assemble = clamp01(t);
  out.ignite = 0.35 * smooth(age / 0.18) + 0.65 * smooth((t - 0.15) / 0.7);
  out.wind = smooth((t - 0.75) / 0.35);
  out.flash = age < 0 ? 0 : Math.exp(-age * 7) * smooth(age / 0.05);
  out.done = t >= 1.1;
  return out;
}

/** A finished arrival: the charger whole and burning. */
export function quarryheartWhole(out: QuarryheartArrival): QuarryheartArrival {
  out.assemble = 1;
  out.ignite = 1;
  out.wind = 1;
  out.flash = 0;
  out.done = true;
  return out;
}

/** Whether a body first drawn `sinceSummon` seconds after the summon edge plays the arrival.
 *  `null`: no summon was seen (the rider was mounted before this client saw him). */
export function quarryheartPlaysArrival(sinceSummon: number | null): boolean {
  return (
    sinceSummon !== null && sinceSummon >= 0 && sinceSummon <= QUARRYHEART_SUMMON_GRACE_SECONDS
  );
}

/** Particles per second, before the cloud's quality scaling. */
export interface QuarryheartRates {
  /** Lightning sparks crackling off the mane and tail. */
  sparks: number;
  /** Embers drifting up out of the gaps between the plates. */
  embers: number;
  /** Frost motes falling from the horns. */
  frost: number;
  /** The running trail: wind streaks, embers and frost flecks thrown off behind. */
  trail: number;
}

/** What each gait sheds. Standing it smoulders; a walk lets a little more go; the gallop throws
 *  the trail behind it. Reduced motion keeps the slow embers and frost and drops the crackle and
 *  the streaking trail (sudden flashes and fast streaks are what that setting asks us to calm). */
export function quarryheartRates(
  moving: boolean,
  running: boolean,
  reducedMotion: boolean,
  out: QuarryheartRates,
): QuarryheartRates {
  if (moving && running) {
    out.sparks = 9;
    out.embers = 16;
    out.frost = 7;
    out.trail = 46;
  } else if (moving) {
    out.sparks = 5;
    out.embers = 9;
    out.frost = 4;
    out.trail = 10;
  } else {
    out.sparks = 3.5;
    out.embers = 6;
    out.frost = 3;
    out.trail = 0;
  }
  if (reducedMotion) {
    out.sparks = 0;
    out.trail = 0;
  }
  return out;
}

/** The shader's motion levers for this frame. */
export interface QuarryheartMotion {
  /** The plates' float amplitude in model units (0 holds them still). */
  float: number;
  /** The wind ribbons' wave amplitude (0 holds them still). */
  wave: number;
  /** How hard the lightning flickers in the ribbons (0 steady). */
  crackle: number;
  /** How fast the streaks race down the wind (1 full, a slow drift under reduced motion). */
  flow: number;
}

/** Reduced motion stills the float and the crackle, slows the streaks and keeps a slow, shallow
 *  wave; every tier keeps the same motion (it costs the same vertex work at any setting). */
export function quarryheartMotion(
  reducedMotion: boolean,
  out: QuarryheartMotion,
): QuarryheartMotion {
  out.float = reducedMotion ? 0 : 0.045;
  out.wave = reducedMotion ? 0.25 : 1;
  out.crackle = reducedMotion ? 0 : 1;
  out.flow = reducedMotion ? 0.3 : 1;
  return out;
}

/** The heart's halo sprite is an optional effect: it draws from the Medium effects tier up (the
 *  static presentation tier, gfx.ts effectsTier), never on Low. */
export function quarryheartKeepsHalo(
  effectsTier: 'low' | 'medium' | 'high' | 'ultra' | 'insane',
): boolean {
  return effectsTier !== 'low';
}

/** What a one-shot burst may throw. Reduced motion keeps the slow glow of a print, the arrival's
 *  soft bloom and the rear's settle; never a flash, a ground ring, a spark spray or a thrown
 *  cloud. */
export interface QuarryheartBurstPolicy {
  /** The core's white flash at ignition and the rear's ground ring. */
  flash: boolean;
  /** The sparks and frost kicked off a hoof print, and every burst's thrown particles. */
  spray: boolean;
}

export function quarryheartBurstPolicy(
  reducedMotion: boolean,
  out: QuarryheartBurstPolicy,
): QuarryheartBurstPolicy {
  out.flash = !reducedMotion;
  out.spray = !reducedMotion;
  return out;
}

/** A hoof's contact latch for the strike edge. */
export interface QuarryheartHoofState {
  down: boolean;
  seeded: boolean;
}

export function createQuarryheartHoofState(): QuarryheartHoofState {
  return { down: false, seeded: false };
}

/** Height (model units over the ground, at the fetlock bone's head) under which a hoof counts as
 *  planted, and over which it counts as lifted again: a gap between the two, so a hoof skimming
 *  the threshold does not strike twice. The fetlock rests 0.32 over the ground. */
export const QUARRYHEART_HOOF_DOWN = 0.4;
export const QUARRYHEART_HOOF_UP = 0.52;

/** True on the one frame a hoof comes down (the frame to leave a print). The first frame only
 *  seeds the latch, so a hoof first seen planted never strikes. */
export function quarryheartHoofStrike(state: QuarryheartHoofState, heightModel: number): boolean {
  if (!state.seeded) {
    state.seeded = true;
    state.down = heightModel <= QUARRYHEART_HOOF_DOWN;
    return false;
  }
  if (state.down) {
    if (heightModel > QUARRYHEART_HOOF_UP) state.down = false;
    return false;
  }
  if (heightModel <= QUARRYHEART_HOOF_DOWN) {
    state.down = true;
    return true;
  }
  return false;
}

/** Which print a hoof leaves: the forehooves burn (ember), the hind hooves freeze (frost). */
export function quarryheartPrintKind(hoofIndex: number): 'ember' | 'frost' {
  return hoofIndex < 2 ? 'ember' : 'frost';
}

/** The bone names the rig reads (charger_rig.py, with GLTFLoader's '.' stripped from names). */
export const QUARRYHEART_HOOF_BONES = ['hoofFL', 'hoofFR', 'hoofHL', 'hoofHR'] as const;
export const QUARRYHEART_CORE_BONE = 'spine';
export const QUARRYHEART_MANE_BONES = ['neck1', 'neck2', 'head'] as const;
export const QUARRYHEART_TAIL_BONE = 'tail3';
export const QUARRYHEART_HORN_BONE = 'head';
export const QUARRYHEART_STONE_MATERIAL = 'QuarryheartStone';
export const QUARRYHEART_WIND_MATERIAL = 'QuarryheartWind';
