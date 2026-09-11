// The bell's voice: procedural audio for deepball at the Deepglass.
//
// Same approach as dragon_audio.ts and water_elemental_audio.ts, pure math,
// no clip files, no generator run, because the arena shipped SILENT. A sport
// played at 26 yd/s with no sound for the strike, the burners or the whistle
// reads as a physics demo rather than a match, and every cue it needs is a
// short percussive transient that synthesis is good at.
//
// One idea runs through all of them: **everything here happens underwater.**
// That is not decoration, it is the whole recipe, and it is what stops these
// sounding like a dry sports pack:
//
//   MUFFLED   no cue carries much above ~2.5 kHz. Water eats the top end, and a
//             bright transient is the single loudest tell that a sound was
//             recorded in air.
//   SLOW      attacks are a few milliseconds rather than instant. A dense medium
//             takes time to move.
//   BUBBLED   most cues carry a short tail of small pitched blips (see
//             {@link bubbles}), cavitation off a fast body or a struck ball.
//             It is the cheapest "this is submerged" signal there is.
//   WEIGHTED  a sub layer under the transient. Water couples to the body; you
//             feel a deepball hit as much as hear it.
//
// Every cue is mono on purpose: the SFX engine pans these through a positional
// panner (game/sfx.ts playAt), and a stereo source would be downmixed anyway.
// Everything is deterministic, a seeded generator per cue, so no two cues are
// correlated noise but each one is identical every session.

export type DeepglassCue =
  | 'strike'
  | 'bump'
  | 'dash'
  | 'brake'
  | 'ignite'
  | 'vent'
  | 'powerup'
  | 'whistle'
  | 'goal'
  | 'wall'
  | 'bounce_soft'
  | 'bounce'
  | 'bounce_hard'
  | 'crowd_roar';

/** The two SUSTAINED sounds, which are a different kind of thing from the cues
 *  above: they are seamless beds the engine loops for as long as the state
 *  holds, so they are rendered by their own path ({@link deepglassLoopSamples})
 *  with no fade at either end, a fade on a loop is a gap once a second. */
export type DeepglassLoop = 'ambient' | 'boost' | 'crowd';

/** The SFX key each cue is staged under. The engine bakes these into buffers at
 *  startup (sfx.ts installProceduralBuffers) and the renderer plays them by key
 *  through the ordinary positional path. */
export const DEEPGLASS_SFX_KEYS: Readonly<Record<string, DeepglassCue>> = {
  dg_strike: 'strike',
  dg_bump: 'bump',
  dg_dash: 'dash',
  dg_brake: 'brake',
  dg_ignite: 'ignite',
  dg_vent: 'vent',
  dg_powerup: 'powerup',
  dg_whistle: 'whistle',
  dg_goal: 'goal',
  dg_wall: 'wall',
  dg_bounce_soft: 'bounce_soft',
  dg_bounce: 'bounce',
  dg_bounce_hard: 'bounce_hard',
  dg_crowd_roar: 'crowd_roar',
};

/** The looping beds, staged the same way but installed through the loop path. */
export const DEEPGLASS_LOOP_SFX_KEYS: Readonly<Record<string, DeepglassLoop>> = {
  dg_ambient: 'ambient',
  dg_boost: 'boost',
  dg_crowd: 'crowd',
};

const CUE_SECONDS: Record<DeepglassCue, number> = {
  strike: 0.62,
  bump: 0.34,
  dash: 0.46,
  brake: 0.58,
  ignite: 0.7,
  vent: 0.5,
  powerup: 0.95,
  whistle: 1.15,
  goal: 2.5,
  wall: 0.44,
  bounce_soft: 0.3,
  bounce: 0.46,
  bounce_hard: 0.64,
  // The roar outlasts every other cue here by a factor of six, and that is the
  // point: a crowd does not stop, it subsides.
  crowd_roar: 4.6,
};

/** Bed lengths. The ambient one is long enough that the ear cannot hold the
 *  whole pattern (a short bed is heard as a pattern, and a pattern heard twice
 *  stops being a room), the boost one short enough to start and stop tight on
 *  the throttle. */
const LOOP_SECONDS: Record<DeepglassLoop, number> = {
  ambient: 9,
  boost: 1.7,
  // Longer than the room tone, for the same reason and more so: a crowd has
  // recognisable EVENTS in it (the surges below), and a surge heard twice a
  // minute is a tape rather than a stadium.
  crowd: 14,
};

/** How much extra each bed renders past its end, to be folded back over its
 *  head (see foldWrap). Long enough to hide the join in slow material, short
 *  enough not to double the render. */
const LOOP_WRAP_SECONDS: Record<DeepglassLoop, number> = {
  ambient: 0.6,
  boost: 0.18,
  crowd: 0.9,
};

/** A bed sits UNDER the match, so both are well below the cues' 0.9. */
const LOOP_PEAK: Record<DeepglassLoop, number> = {
  ambient: 0.5,
  boost: 0.8,
  crowd: 0.55,
};

// Distinct per cue so two firing together (a bump under a strike) are not
// correlated noise, which would read as one doubled sound.
const CUE_SEEDS: Record<DeepglassCue, number> = {
  strike: 0x2f6ab1,
  bump: 0x7c1d59,
  dash: 0x14e7a3,
  brake: 0x9b3f22,
  ignite: 0x5d8c74,
  vent: 0x3a91e6,
  powerup: 0x62d4af,
  whistle: 0x8e2b17,
  goal: 0xc45e93,
  wall: 0x1b7fd2,
  bounce_soft: 0x4a83c1,
  bounce: 0xd12e6b,
  bounce_hard: 0x27b95f,
  crowd_roar: 0x3ec1a7,
};

const LOOP_SEEDS: Record<DeepglassLoop, number> = {
  ambient: 0xa3f70d,
  boost: 0x6c25b8,
  crowd: 0xd48e51,
};

/** Headroom under full scale. The engine multiplies by SAMPLE_GAIN and the
 *  per-play gain on top, so leaving room keeps a point-blank strike off the
 *  master's ceiling. */
const PEAK = 0.9;

function seededNoise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/** Two-pole state-variable filter, stepped one sample at a time, cheap enough
 *  to sweep per sample, which every moving-water cue here needs. Guarded below
 *  Nyquist: an unclamped sweep goes unstable and renders a buffer of NaN, which
 *  plays as silence with no error anywhere. */
interface Svf {
  lp: number;
  bp: number;
}

function svfStep(s: Svf, input: number, cutoffHz: number, q: number, sampleRate: number): void {
  const f = 2 * Math.sin((Math.PI * Math.min(cutoffHz, sampleRate * 0.45)) / sampleRate);
  s.lp += f * s.bp;
  const hp = input - s.lp - q * s.bp;
  s.bp += f * hp;
}

function saturate(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/**
 * Fade the first sample or two up from zero.
 *
 * Every cue here starts on a transient, and a buffer whose FIRST sample is
 * already at 0.36 is a DC step, heard as a tick in front of the sound, which is
 * the one artefact that makes synthesised audio read as synthesised. A ramp this
 * short (about a millisecond and a half) is still an instant attack to the ear
 * and it removes the step completely.
 */
function fadeIn(out: Float32Array, sampleRate: number, seconds = 0.0015): void {
  const n = Math.min(out.length, Math.floor(seconds * sampleRate));
  for (let i = 0; i < n; i++) out[i] *= i / n;
}

/** Fade the last few milliseconds to zero: a buffer that stops mid-cycle
 *  clicks on playback. */
function fadeOut(out: Float32Array, sampleRate: number, seconds = 0.012): void {
  const n = Math.min(out.length, Math.floor(seconds * sampleRate));
  for (let i = 0; i < n; i++) out[out.length - n + i] *= 1 - i / n;
}

function normalize(out: Float32Array, peak = PEAK): void {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max <= 1e-6) return;
  const scale = peak / max;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
}

/** A grain envelope centred at `at` seconds, `width` seconds wide. */
function grain(t: number, at: number, width: number): number {
  const d = (t - at) / width;
  return Math.exp(-d * d);
}

/**
 * Cavitation: a scatter of tiny pitched blips over the cue's tail.
 *
 * Each bubble is a fast upward chirp under a short decay, that RISE is the
 * whole illusion, because a bubble shrinks as it rises and its resonance climbs
 * with it. A flat blip sounds like a synth click; a chirped one sounds wet.
 */
function bubbles(
  out: Float32Array,
  sampleRate: number,
  random: () => number,
  opts: { from: number; to: number; count: number; level: number },
): void {
  for (let b = 0; b < opts.count; b++) {
    const at = opts.from + (opts.to - opts.from) * ((random() + 1) / 2);
    const base = 320 + 900 * ((random() + 1) / 2);
    const life = 0.02 + 0.05 * ((random() + 1) / 2);
    const amp = opts.level * (0.35 + 0.65 * ((random() + 1) / 2));
    const start = Math.floor(at * sampleRate);
    const len = Math.floor(life * sampleRate);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= out.length) continue;
      const p = i / len;
      // Rising pitch and a fast decay.
      phase += (Math.PI * 2 * (base * (1 + p * 1.6))) / sampleRate;
      out[idx] += Math.sin(phase) * amp * (1 - p) * (1 - p);
    }
  }
}

// ---------------------------------------------------------------------------
// THE STRIKE. The sound of the sport: a heavy body of water shoved out of the
// way by a ball leaving at speed. Three layers, and the order matters, the
// low THUMP is what carries across the bell, the mid BODY is what makes it
// sound like a ball rather than a drum, and the bubbles are what put it under
// water.
// ---------------------------------------------------------------------------
function renderStrike(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const body: Svf = { lp: 0, bp: 0 };
  let thumpPhase = 0;
  let ringPhase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    // Sub thump: a pitch that drops fast, the classic struck-membrane arc.
    const f0 = 108 * Math.exp(-t * 11) + 44;
    thumpPhase += (Math.PI * 2 * f0) / sampleRate;
    const thump = Math.sin(thumpPhase) * Math.exp(-t * 13);

    // Body: band-passed noise around a mid resonance that falls with the
    // thump, so the two read as one object rather than two sounds.
    svfStep(body, random(), 240 + 520 * Math.exp(-t * 16), 0.9, sampleRate);
    const smack = body.bp * Math.exp(-t * 26) * 0.8;

    // A short ring of the shell itself, muffled hard by the water.
    ringPhase += (Math.PI * 2 * 186) / sampleRate;
    const ring = Math.sin(ringPhase) * Math.exp(-t * 9) * 0.16;

    out[i] = saturate(thump * 1.1 + smack + ring, 1.5);
  }
  bubbles(out, sampleRate, random, { from: 0.03, to: 0.4, count: 14, level: 0.16 });
  normalize(out);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE BUMP. Two bodies meeting. Duller and softer than the strike, flesh and
// harness rather than a struck shell, and with no ring at all.
// ---------------------------------------------------------------------------
function renderBump(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const cloth: Svf = { lp: 0, bp: 0 };
  let phase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const f0 = 74 * Math.exp(-t * 9) + 38;
    phase += (Math.PI * 2 * f0) / sampleRate;
    const thud = Math.sin(phase) * Math.exp(-t * 16);
    svfStep(cloth, random(), 180 + 300 * Math.exp(-t * 20), 1.3, sampleRate);
    out[i] = saturate(thud * 0.9 + cloth.bp * Math.exp(-t * 30) * 0.5, 1.2);
  }
  bubbles(out, sampleRate, random, { from: 0.02, to: 0.22, count: 7, level: 0.1 });
  normalize(out, 0.72);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE DASH. A body thrown sideways: a fast shove of water, heard as a
// band-passed swell that opens and shuts inside a fifth of a second.
// ---------------------------------------------------------------------------
function renderDash(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const wash: Svf = { lp: 0, bp: 0 };
  let subPhase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const p = i / Math.max(1, out.length - 1);
    // The cutoff opens fast and closes slow: a shove, then the water settling.
    const cutoff = 300 + 1500 * Math.exp(-t * 7) * (t < 0.03 ? t / 0.03 : 1);
    svfStep(wash, random(), cutoff, 0.7, sampleRate);
    const env = Math.min(1, t / 0.012) * Math.exp(-t * 7.5);
    // A sub shove under it, so the dash has weight and not just hiss.
    subPhase += (Math.PI * 2 * (96 - 40 * p)) / sampleRate;
    out[i] = saturate(wash.bp * env * 1.3 + Math.sin(subPhase) * env * 0.45, 1.3);
  }
  bubbles(out, sampleRate, random, { from: 0.02, to: 0.34, count: 18, level: 0.14 });
  normalize(out, 0.82);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE BRAKE. The pack thrown into reverse: a low cavitating rumble that grinds
// rather than whooshes, because the water is being pushed back the way it came.
// ---------------------------------------------------------------------------
function renderBrake(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const grind: Svf = { lp: 0, bp: 0 };
  let phase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.03) * Math.exp(-t * 4.4);
    // Amplitude modulation in the rattle band: below ~40 Hz the ear hears a
    // grind rather than a pitch, which is what makes this read as churn.
    phase += (Math.PI * 2 * 27) / sampleRate;
    const rattle = 0.62 + 0.38 * Math.sin(phase);
    svfStep(grind, random(), 190 + 260 * Math.exp(-t * 3), 1.1, sampleRate);
    out[i] = saturate(grind.bp * env * rattle * 1.5 + grind.lp * env * 0.9, 1.6);
  }
  bubbles(out, sampleRate, random, { from: 0.02, to: 0.5, count: 22, level: 0.13 });
  normalize(out, 0.78);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE IGNITION. Burners lighting: a muffled whoomph that blooms open, with the
// steady hiss of the plume behind it.
// ---------------------------------------------------------------------------
function renderIgnite(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const jet: Svf = { lp: 0, bp: 0 };
  let boom = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    // The bloom: a short swell rather than a transient, because water resists.
    const env = (1 - Math.exp(-t * 26)) * Math.exp(-t * 3.6);
    boom += (Math.PI * 2 * (58 + 34 * Math.exp(-t * 5))) / sampleRate;
    svfStep(jet, random(), 420 + 900 * (1 - Math.exp(-t * 9)), 0.75, sampleRate);
    out[i] = saturate(Math.sin(boom) * env * 0.85 + jet.bp * env * 1.1 + jet.lp * env * 0.5, 1.7);
  }
  bubbles(out, sampleRate, random, { from: 0.01, to: 0.6, count: 26, level: 0.15 });
  normalize(out, 0.86);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE VENT. Charge taken off a lit vent: a bright rising bubble-rush with a
// pitched confirmation on top, so it reads as a PICKUP and not as an impact.
// ---------------------------------------------------------------------------
function renderVent(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const rush: Svf = { lp: 0, bp: 0 };
  let tone = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const p = i / Math.max(1, out.length - 1);
    svfStep(rush, random(), 500 + 1400 * p, 0.8, sampleRate);
    const hiss = rush.bp * Math.min(1, t / 0.02) * Math.exp(-t * 5) * 0.7;
    // Two notes up a fifth: the shortest phrase that reads as "granted".
    const f = t < 0.14 ? 523 : 784;
    tone += (Math.PI * 2 * f) / sampleRate;
    const chime = Math.sin(tone) * (grain(t, 0.06, 0.05) + grain(t, 0.2, 0.07)) * 0.5;
    out[i] = hiss + chime;
  }
  bubbles(out, sampleRate, random, { from: 0.0, to: 0.3, count: 16, level: 0.12 });
  normalize(out, 0.7);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE POWERUP. The orb taken: a longer shimmer that climbs, deliberately more
// ceremonial than a vent, you left the play to fetch this.
// ---------------------------------------------------------------------------
function renderPowerup(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const partials = [392, 523, 659, 784, 1046];
  const phases = new Float32Array(partials.length);

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (let k = 0; k < partials.length; k++) {
      // Each partial enters later than the last: an arpeggio heard as a swell.
      const at = 0.05 + k * 0.075;
      phases[k] += (Math.PI * 2 * partials[k] * (1 + 0.04 * Math.sin(t * 5))) / sampleRate;
      sample += Math.sin(phases[k]) * grain(t, at, 0.13) * (0.42 - k * 0.045);
    }
    out[i] = sample * Math.min(1, t / 0.02);
  }
  bubbles(out, sampleRate, random, { from: 0.05, to: 0.7, count: 20, level: 0.09 });
  normalize(out, 0.68);
  fadeOut(out, sampleRate, 0.05);
}

// ---------------------------------------------------------------------------
// THE WHISTLE. Not a whistle: this arena is a BELL, and a bell is what starts
// the bout. A struck partial stack with an inharmonic hum note under it, which
// is what separates a bell from an organ.
// ---------------------------------------------------------------------------
function renderWhistle(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  // Hum, prime, tierce, quint, nominal: the classic bell ratios, detuned a
  // little so the partials beat against each other instead of fusing.
  const partials = [
    { f: 174, a: 0.5, d: 2.4 },
    { f: 349, a: 0.62, d: 3.1 },
    { f: 416, a: 0.34, d: 4.2 },
    { f: 523, a: 0.22, d: 5.0 },
    { f: 698, a: 0.18, d: 6.4 },
  ];
  const phases = new Float32Array(partials.length);

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (let k = 0; k < partials.length; k++) {
      phases[k] += (Math.PI * 2 * partials[k].f) / sampleRate;
      sample += Math.sin(phases[k]) * partials[k].a * Math.exp(-t * partials[k].d);
    }
    // The strike transient: a click of the clapper, gone in 20 ms.
    const hit = random() * Math.exp(-t * 90) * 0.35;
    out[i] = saturate(sample + hit, 1.2);
  }
  normalize(out, 0.8);
  fadeOut(out, sampleRate, 0.06);
}

// ---------------------------------------------------------------------------
// THE GOAL. The same bell, struck harder and rung twice, over a swell of water.
// The crowd is a separate layer the renderer plays alongside (crowd_roar just
// below), so this stays the ARENA's voice rather than trying to be the whole
// moment.
// ---------------------------------------------------------------------------
function renderGoal(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const partials = [
    { f: 131, a: 0.55, d: 1.1 },
    { f: 262, a: 0.66, d: 1.5 },
    { f: 311, a: 0.38, d: 2.0 },
    { f: 392, a: 0.26, d: 2.6 },
    { f: 523, a: 0.2, d: 3.4 },
  ];
  const phases = new Float32Array(partials.length);
  const swell: Svf = { lp: 0, bp: 0 };
  const second = 0.62; // the second strike, seconds in

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (let k = 0; k < partials.length; k++) {
      phases[k] += (Math.PI * 2 * partials[k].f) / sampleRate;
      const first = Math.exp(-t * partials[k].d);
      const again = t > second ? Math.exp(-(t - second) * partials[k].d) * 0.8 : 0;
      sample += Math.sin(phases[k]) * partials[k].a * (first + again);
    }
    const hit =
      random() * (Math.exp(-t * 70) + (t > second ? Math.exp(-(t - second) * 70) : 0)) * 0.3;
    // A low wash of moving water under the whole thing.
    svfStep(swell, random(), 150 + 120 * Math.sin(t * 2.2), 1.2, sampleRate);
    out[i] = saturate(sample + hit + swell.lp * 0.5 * Math.exp(-t * 1.1), 1.3);
  }
  bubbles(out, sampleRate, random, { from: 0.0, to: 2.0, count: 40, level: 0.08 });
  normalize(out, 0.9);
  fadeOut(out, sampleRate, 0.08);
}

// ---------------------------------------------------------------------------
// THE CROWD, ON A GOAL. The building answering the bell.
//
// Everything above is a sound made IN the water. This one is not: it is made
// out in the air by several thousand people, and it reaches the player through
// the glass and a hundred yards of water. So it is muffled harder than any cue
// here, there is no consonant left in it, only the shape of a shout, and it
// is SLOW, because a crowd does not have a transient. It swells.
//
// Three layers. The voices are two lowpassed noise bands beaten against each
// other (the band BETWEEN two cutoffs is what reads as "many people" rather
// than as wind). Under them, arriving a beat late, the bowl's own stamp: feet
// on stone at a few hertz, which is what makes a roar feel like a full
// building rather than a loud noise. And over the decay, the ragged
// second-wind swells of a crowd that will not sit down yet.
// ---------------------------------------------------------------------------
function renderCrowdRoar(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  let deep = 0;
  let mid = 0;
  let stampPhase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const w = random();
    // ~80 Hz and ~360 Hz. Nothing above: through glass and water a shout has
    // no top, and putting one back is the single tell that would break it.
    deep += 0.011 * (w - deep);
    mid += 0.048 * (w - mid);

    // The swell: up over a third of a second (fast for a crowd, slow for a
    // cue), a short peak while it registers, then a long ragged subside.
    const rise = Math.min(1, t / 0.34) ** 0.65;
    const fall = t < 1.05 ? 1 : Math.exp(-(t - 1.05) * 0.78);
    // Second wind. Two late lifts, so the tail is a crowd rather than a fade.
    const again = 1 + 0.34 * grain(t, 1.55, 0.42) + 0.22 * grain(t, 2.65, 0.5);
    const env = rise * fall * again;

    // The stamp. Deliberately behind the voices: the shout is reflex, the feet
    // are the second thing that happens.
    const stampEnv = t < 0.4 ? 0 : Math.exp(-(t - 0.4) * 1.25);
    stampPhase += (Math.PI * 2 * (44 + 6 * Math.sin(t * 1.9))) / sampleRate;
    const stamp =
      Math.sin(stampPhase) * stampEnv * 0.4 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 5.2 * t));

    out[i] = saturate((deep * 2.8 + (mid - deep) * 1.55) * env + stamp, 1.25);
  }
  // No bubbles: unlike every other cue in this file the source is not in the
  // water, and cavitation on a crowd would put the stands inside the bell.
  normalize(out, 0.9);
  fadeOut(out, sampleRate, 0.12);
}

// ---------------------------------------------------------------------------
// THE GLASS. A body meeting the wall: a dull knock on something enormous and
// hard, plus the squeak of a hand dragging along it.
// ---------------------------------------------------------------------------
function renderWall(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const scrape: Svf = { lp: 0, bp: 0 };
  let knock = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    knock += (Math.PI * 2 * (128 * Math.exp(-t * 14) + 62)) / sampleRate;
    const body = Math.sin(knock) * Math.exp(-t * 18) * 0.9;
    // A high, thin ring: glass, and the only cue here allowed any top end.
    svfStep(scrape, random(), 2200 * Math.exp(-t * 5) + 600, 2.4, sampleRate);
    out[i] = saturate(body + scrape.bp * Math.exp(-t * 12) * 0.35, 1.3);
  }
  bubbles(out, sampleRate, random, { from: 0.01, to: 0.3, count: 10, level: 0.1 });
  normalize(out, 0.75);
  fadeOut(out, sampleRate);
}

// ---------------------------------------------------------------------------
// THE BOUNCE. The ball coming off a body, and the one sound in the bank a
// player hears a hundred times a bout, so it is the one that has to stay
// satisfying on the hundredth.
//
// The reference is a BASKETBALL, because a basketball bounce is the sound
// everybody already knows for "inflated ball, struck hard": a sharp rubber
// SLAP, then the ball's own air cavity ringing under it as a short pitched
// pock, then a sub thump you feel. Under water the slap loses its top end and
// its edge, the cavity ring sustains a little longer (the water loads the
// shell), and the whole thing arrives wrapped in cavitation.
//
// Three separate recipes rather than one buffer at three volumes, because a
// hard hit is not a loud soft hit, it is a DIFFERENT sound: more shell, more
// sub, a longer ring. The renderer mixes between them by impact speed
// ({@link bounceMixFor}), so a ball rolled onto a shoulder and a ball met at
// full boost sit at opposite ends of one continuous feel.
// ---------------------------------------------------------------------------

/** A light touch: the pock alone, small and quick. */
function renderBounceSoft(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const slap: Svf = { lp: 0, bp: 0 };
  let cavity = 0;
  let mode = 0;
  let sub = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    // The rubber, brushed rather than struck.
    svfStep(slap, random(), 380 + 340 * Math.exp(-t * 30), 1.0, sampleRate);
    const skin = slap.bp * Math.exp(-t * 44) * 0.5;
    // The air inside: a small ball reads HIGH, which is what separates this
    // from the heavy layers without needing any more level.
    cavity += (Math.PI * 2 * (262 - 18 * (1 - Math.exp(-t * 9)))) / sampleRate;
    mode += (Math.PI * 2 * 388) / sampleRate;
    const ring =
      Math.sin(cavity) * Math.exp(-t * 22) * 0.55 + Math.sin(mode) * Math.exp(-t * 30) * 0.2;
    sub += (Math.PI * 2 * 84) / sampleRate;
    out[i] = saturate(skin + ring + Math.sin(sub) * Math.exp(-t * 26) * 0.25, 1.1);
  }
  bubbles(out, sampleRate, random, { from: 0.01, to: 0.18, count: 5, level: 0.09 });
  normalize(out, 0.62);
  fadeOut(out, sampleRate);
}

/** The everyday bounce: slap, cavity, thump, the whole basketball. */
function renderBounce(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const slap: Svf = { lp: 0, bp: 0 };
  let cavity = 0;
  let mode = 0;
  let thump = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    // The slap: a band that collapses downward inside 30 ms. The COLLAPSE is
    // what makes it read as rubber rather than as a snare.
    svfStep(slap, random(), 320 + 900 * Math.exp(-t * 30), 1.0, sampleRate);
    const skin = slap.bp * Math.exp(-t * 38) * 0.75;

    // The cavity: two modes that are NOT harmonically related (168 / 251 is a
    // little under a fifth), because a sphere's modes are not a harmonic
    // series and a harmonic pair fuses into one organ note. Both drift down a
    // few percent as the shell relaxes.
    const drift = 1 - 0.05 * (1 - Math.exp(-t * 8));
    cavity += (Math.PI * 2 * 168 * drift) / sampleRate;
    mode += (Math.PI * 2 * 251 * drift) / sampleRate;
    const ring =
      Math.sin(cavity) * Math.exp(-t * 15) * 0.8 + Math.sin(mode) * Math.exp(-t * 22) * 0.34;

    // The weight. Water couples to the body: this is the part you feel.
    thump += (Math.PI * 2 * (46 + 72 * Math.exp(-t * 10))) / sampleRate;
    out[i] = saturate(skin + ring + Math.sin(thump) * Math.exp(-t * 12) * 0.7, 1.4);
  }
  bubbles(out, sampleRate, random, { from: 0.02, to: 0.3, count: 12, level: 0.13 });
  normalize(out, 0.88);
  fadeOut(out, sampleRate);
}

/** The heavy layer, mixed IN on top of the core rather than replacing it: the
 *  extra shell and the extra sub a ball met at boost pace has. */
function renderBounceHard(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const slap: Svf = { lp: 0, bp: 0 };
  let boom = 0;
  let cavity = 0;
  let mode = 0;
  let strain = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    // A wider, dirtier slap, driven hard.
    svfStep(slap, random(), 300 + 1300 * Math.exp(-t * 26), 0.8, sampleRate);
    const skin = saturate(slap.bp * Math.exp(-t * 26), 2.2) * 0.8;

    // The shell straining: a fast downward chirp. It is the "crack" of a big
    // hit, kept under 1.4 kHz so the water still owns the top end.
    strain += (Math.PI * 2 * (380 + 1020 * Math.exp(-t * 55))) / sampleRate;
    const crack = Math.sin(strain) * Math.exp(-t * 70) * 0.22;

    // Lower modes, ringing longer: a harder hit deforms the ball further, and
    // a bigger deformation is a lower, longer note.
    cavity += (Math.PI * 2 * 142) / sampleRate;
    mode += (Math.PI * 2 * 214) / sampleRate;
    const ring =
      Math.sin(cavity) * Math.exp(-t * 9) * 0.85 + Math.sin(mode) * Math.exp(-t * 13) * 0.3;

    // The boom: slower to fall than the core layer's thump, which is the whole
    // difference between "hit" and "HIT".
    boom += (Math.PI * 2 * (38 + 62 * Math.exp(-t * 6))) / sampleRate;
    out[i] = saturate(skin + crack + ring + Math.sin(boom) * Math.exp(-t * 6.5) * 1.0, 1.8);
  }
  bubbles(out, sampleRate, random, { from: 0.03, to: 0.5, count: 24, level: 0.16 });
  normalize(out, 0.95);
  fadeOut(out, sampleRate);
}

/**
 * How the three bounce layers are mixed for one impact.
 *
 * Impact is the CLOSING speed of ball and body, in yd/s. Everything about the
 * curve is about keeping the extremes far apart: a ball taken softly is the
 * small pock alone, a ball met at pace is all three layers at once, pitched
 * down, a bigger, slower, heavier object. `rate` falls with force for the
 * same reason a big drum is a low drum.
 *
 * Pure and exported so it can be pinned by a test: verifying audio live in the
 * bell means a minute-long WebGL reload per edit, and the mix curve is the part
 * that actually decides whether the sound reads.
 */
export interface BounceMix {
  /** Gain for `bounce_soft`, the light pock. */
  soft: number;
  /** Gain for `bounce`, the everyday basketball. */
  core: number;
  /** Gain for `bounce_hard`, layered on top of the core for big hits. */
  heavy: number;
  /** Playback rate for all three: down with force. */
  rate: number;
}

/** Under this, a contact is a nudge, no strike energy at all. */
const BOUNCE_FLOOR = 1.5;
/** At this closing speed the mix is fully heavy. Below the ball's own ceiling
 *  (34 yd/s) on purpose: a bout should reach the top of the sound often. */
const BOUNCE_CEIL = 26;

/** Smoothstep from `a` to `b`, clamped. */
function ramp(x: number, a: number, b: number): number {
  const p = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return p * p * (3 - 2 * p);
}

/**
 * The layers STACK, so their gains have to be budgeted together: core and
 * heavy both peak on the same transient (both start on the ball meeting the
 * body), and the naive "each layer up to 1" version summed to about 1.8,  * which the engine's own trim and the distance panner usually hide, and which
 * a point-blank hit at full volume does not. Rendering the mix to a file and
 * counting clipped samples is what caught it; nothing in the bell would have.
 */
// The budget also has to leave room for what the bounce lands ON: the room
// tone and, on the hit that matters, a burner bed running under it. A ceiling
// that only fits the bounce alone clips the moment a hard hit happens during a
// boost, which is most hard hits.
const BOUNCE_HEADROOM = 1.0;

export function bounceMixFor(impactSpeed: number): BounceMix {
  const hard = ramp(impactSpeed, BOUNCE_FLOOR, BOUNCE_CEIL);
  return {
    // The pock rules the bottom of the range and is gone by a third of the way
    // up, where the core has fully taken over.
    soft: (1 - ramp(hard, 0.02, 0.28)) * 0.55,
    core: ramp(hard, 0.04, 0.3) * (0.22 + 0.3 * hard),
    // Only real hits, and it arrives late so that when it does arrive it is an
    // event rather than a slider.
    heavy: ramp(hard, 0.42, 1) * 0.4,
    rate: 1.2 - 0.34 * hard,
  };
}

/** The most gain any single impact can ask for across all three layers. Pinned
 *  by a test so a future tuning pass cannot quietly spend the headroom. */
export const BOUNCE_MAX_DEMAND = BOUNCE_HEADROOM;

// ---------------------------------------------------------------------------
// THE BEDS. Two sustained loops, rendered by their own path because a loop has
// the opposite requirement to a cue: no fade at either end (a fade is a gap
// once around), and a wrap point the ear cannot find.
//
// Seamlessness is bought two ways, and both are needed. Anything TONAL is
// snapped to a whole number of cycles across the buffer, so its phase is
// already continuous at the wrap; everything NOISY is crossfaded head-over-tail
// at the end (the same equal-power trick the Sowfield crowd bed uses), because
// noise has no phase to align.
// ---------------------------------------------------------------------------

/** Snap `hz` to the nearest frequency with a whole number of cycles in a buffer
 *  of `seconds`, so the wrap lands mid-cycle at exactly the phase it started. */
function wrapped(hz: number, seconds: number): number {
  return Math.max(1, Math.round(hz * seconds)) / seconds;
}

/**
 * Fold a rendered OVERHANG back over the head to make a loop seamless.
 *
 * `work` is rendered `len + tail` samples long; the last `tail` of it is the
 * natural continuation of the loop past its end. Mixing that continuation into
 * the first `tail` samples (equal power, continuation fading out) means the
 * sample after `len - 1` is the sample that would have followed it anyway,  * continuous, at the wrap, by construction.
 *
 * This is NOT the same as crossfading the head over the tail, which is the
 * obvious version and is wrong: it leaves the buffer ENDING on head material
 * from `tail` seconds in, so the wrap jumps from there back to sample 0 and
 * clicks exactly as loudly as before.
 */
function foldWrap(work: Float32Array, len: number, tail: number): void {
  for (let i = 0; i < tail; i++) {
    const amount = i / tail;
    work[i] = work[len + i] * Math.sqrt(1 - amount) + work[i] * Math.sqrt(amount);
  }
}

/**
 * THE BELL'S ROOM TONE. What the Deepglass sounds like when nothing is
 * happening, which is most of any given second, so it is what the arena
 * actually sounds LIKE.
 *
 * Four layers, in order of how much they matter: a pressure rumble that is
 * felt more than heard (deep water is a weight, not a noise), a slow band of
 * moving water over it, the enormous glass shell groaning as it flexes, and
 * bubble streams drifting up somewhere off in the dark. No top end at all
 * beyond a whisper, the one thing that would break the illusion instantly.
 */
function renderAmbient(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const seconds = out.length / sampleRate;
  // Every LFO gets a whole number of cycles: a swell that is mid-rise at the
  // wrap is a pump heard once every pass.
  const swellA = wrapped(0.11, seconds);
  const swellB = wrapped(0.29, seconds);
  const swellC = wrapped(0.07, seconds);
  let deep = 0;
  let mid = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const w = random();
    // Two one-poles, both LOW: ~90 Hz and ~380 Hz. There is deliberately no
    // third, brighter band. At depth there is no top end to have, a "whisper
    // of air" over this reads instantly as a room recorded in one, and the
    // bubbles below are all the detail the bed needs.
    deep += 0.012 * (w - deep);
    mid += 0.05 * (w - mid);
    const swell =
      0.72 + 0.2 * Math.sin(2 * Math.PI * swellA * t) + 0.12 * Math.sin(2 * Math.PI * swellB * t);
    const drift = 0.8 + 0.2 * Math.sin(2 * Math.PI * swellC * t);
    out[i] =
      deep * 3.2 * swell + // the pressure
      (mid - deep) * 0.45 * drift; // water moving past
  }

  // The shell. Five groans across the bed, each a pair of detuned partials
  // under a slow swell, detuned because two close partials BEAT, and a beat
  // is what tells the ear the thing groaning is enormous.
  const groanAt = [0.9, 2.6, 4.1, 5.8, 7.6];
  for (let g = 0; g < groanAt.length; g++) {
    const at = groanAt[g] * (seconds / 9);
    const f = 58 + 74 * ((random() + 1) / 2);
    const width = 0.55 + 0.5 * ((random() + 1) / 2);
    const level = 0.1 + 0.08 * ((random() + 1) / 2);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      const env = grain(t, at, width);
      if (env < 1e-4) continue;
      a += (Math.PI * 2 * f) / sampleRate;
      b += (Math.PI * 2 * f * 1.011) / sampleRate;
      out[i] += (Math.sin(a) + Math.sin(b) * 0.7) * env * level;
    }
  }

  // Three streams rather than an even scatter: bubbles come from somewhere.
  for (let s = 0; s < 3; s++) {
    const from = 0.4 + (seconds - 2.2) * ((random() + 1) / 2);
    bubbles(out, sampleRate, random, { from, to: from + 0.7, count: 9, level: 0.05 });
  }
}

/**
 * THE BURNERS UNDER LOAD. The sustained half of what the pack does, the
 * ignition one-shot lights it, this is the thirty seconds after.
 *
 * A jet in water is not a jet in air: no whistle, no top end, just a broad
 * low-mid roar with the cavitation flutter of collapsing bubbles beating
 * through it. That flutter is the whole character; a smooth roar sounds like
 * a hairdryer, a fluttering one sounds like thrust.
 */
function renderBoost(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const seconds = out.length / sampleRate;
  const roar: Svf = { lp: 0, bp: 0 };
  // The two flutter rates and the cutoff wobble all wrap.
  const flutterA = wrapped(23, seconds);
  const flutterB = wrapped(37.4, seconds);
  const wobble = wrapped(3.1, seconds);
  const thrustHz = wrapped(58, seconds);
  let thrust = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const cutoff = 300 + 160 * Math.sin(2 * Math.PI * wobble * t);
    svfStep(roar, random(), cutoff, 0.55, sampleRate);
    // Two beating rates, not one: a single rate is a buzz with a pitch, two
    // irrational-ish ones are churn.
    const flutter =
      0.7 +
      0.22 * Math.sin(2 * Math.PI * flutterA * t) +
      0.14 * Math.sin(2 * Math.PI * flutterB * t);
    thrust += (Math.PI * 2 * thrustHz) / sampleRate;
    const sub = Math.sin(thrust) * 0.5 + Math.sin(thrust * 2) * 0.18;
    out[i] = saturate((roar.bp * 1.6 + roar.lp * 0.9) * flutter + sub * 0.55, 1.6);
  }
  bubbles(out, sampleRate, random, { from: 0, to: seconds - 0.12, count: 34, level: 0.1 });
}

/**
 * THE BOWL, HEARD FROM INSIDE THE BELL. The stadium's room tone, the way the
 * ambient bed above is the water's.
 *
 * Same muffling as the roar and for the same reason, the crowd is out in the
 * air and the player is not, but where the roar is one event, this is the
 * sound of a full bowl waiting. Two ideas carry it:
 *
 *   BABBLE   the voice band is modulated by FIVE slow independent rates rather
 *            than one. One rate is wind with a pulse; five never line up, and
 *            not lining up is exactly what a thousand conversations sound like.
 *   SURGES   a crowd leans in and lets go. Six swells across the bed, each the
 *            same voice band getting louder rather than a new sound arriving,
 *            so the bowl reacts without anything ever being "a sample".
 *
 * The renderer scales this bed by how much is happening (sfx.ts ambience), so
 * the level is the mood and the material stays the same throughout.
 */
function renderCrowd(out: Float32Array, sampleRate: number, seed: number): void {
  const random = seededNoise(seed);
  const seconds = out.length / sampleRate;
  // Whole numbers of cycles over the bed, or the wrap is a heard pump.
  const rates = [0.13, 0.31, 0.53, 0.79, 1.21].map((hz) => wrapped(hz, seconds));
  const amps = [0.13, 0.1, 0.08, 0.06, 0.04];
  const phases = rates.map(() => random() * Math.PI);
  let deep = 0;
  let mid = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const w = random();
    deep += 0.01 * (w - deep); // ~77 Hz: the mass of the building
    // ~186 Hz, not the ~340 the voices would sit at in air. Through the shell
    // and a hundred yards of water almost nothing survives above two hundred,
    // and the bed gate in tests/deepglass_audio.test.ts holds the whole file
    // to that: a brighter band read as a crowd recorded in a room.
    mid += 0.024 * (w - mid);
    let babble = 0.62;
    for (let k = 0; k < rates.length; k++) {
      babble += amps[k] * Math.sin(2 * Math.PI * rates[k] * t + phases[k]);
    }
    out[i] = deep * 2.8 + (mid - deep) * 1.1 * babble;
  }

  // The surges, laid over the top. Written against the 14s bed and scaled, so
  // changing LOOP_SECONDS moves them with it instead of bunching at the head.
  const surgeAt = [1.2, 3.6, 5.5, 7.9, 10.4, 12.6];
  for (let s = 0; s < surgeAt.length; s++) {
    const at = surgeAt[s] * (seconds / 14);
    const width = 0.75 + 0.6 * ((random() + 1) / 2);
    const level = 0.55 + 0.4 * ((random() + 1) / 2);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      const env = grain(t, at, width);
      if (env < 1e-4) continue;
      const w = random();
      a += 0.028 * (w - a);
      b += 0.01 * (w - b);
      out[i] += (a - b) * level * env;
    }
  }
}

const RENDERERS: Record<
  DeepglassCue,
  (out: Float32Array, sampleRate: number, seed: number) => void
> = {
  strike: renderStrike,
  bump: renderBump,
  dash: renderDash,
  brake: renderBrake,
  ignite: renderIgnite,
  vent: renderVent,
  powerup: renderPowerup,
  whistle: renderWhistle,
  goal: renderGoal,
  wall: renderWall,
  bounce_soft: renderBounceSoft,
  bounce: renderBounce,
  bounce_hard: renderBounceHard,
  crowd_roar: renderCrowdRoar,
};

const LOOP_RENDERERS: Record<
  DeepglassLoop,
  (out: Float32Array, sampleRate: number, seed: number) => void
> = {
  ambient: renderAmbient,
  boost: renderBoost,
  crowd: renderCrowd,
};

/** Render one cue to mono PCM. Deterministic in (cue, sampleRate). */
export function deepglassSamples(cue: DeepglassCue, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.floor(CUE_SECONDS[cue] * sampleRate)));
  RENDERERS[cue](out, sampleRate, CUE_SEEDS[cue]);
  // Applied here rather than per recipe so no cue can be added without it.
  fadeIn(out, sampleRate);
  return out;
}

/**
 * Render one sustained bed to mono PCM, ready to be looped end-to-end.
 *
 * Deliberately NOT routed through {@link deepglassSamples}: the fade-in and
 * fade-out that keep a one-shot from clicking are exactly what would put a
 * hole in a loop every time it came around.
 */
export function deepglassLoopSamples(loop: DeepglassLoop, sampleRate: number): Float32Array {
  const len = Math.max(1, Math.floor(LOOP_SECONDS[loop] * sampleRate));
  const tail = Math.max(1, Math.floor(LOOP_WRAP_SECONDS[loop] * sampleRate));
  // Rendered long, then folded: the recipes above are written as if the bed ran
  // forever, and the overhang they render past `len` is what makes the seam
  // disappear (see foldWrap).
  const work = new Float32Array(len + tail);
  LOOP_RENDERERS[loop](work, sampleRate, LOOP_SEEDS[loop]);
  foldWrap(work, len, tail);
  const out = work.slice(0, len);
  // Normalized AFTER the fold, because the fold sums two signals and can push
  // a peak up past whatever the recipe left.
  normalize(out, LOOP_PEAK[loop]);
  return out;
}
