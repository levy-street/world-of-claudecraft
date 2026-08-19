// Procedural audio for the Weirdo Cream truck: the engine bed and the chime.
//
// Synthesized sample by sample in plain JS rather than assembled from FFmpeg
// filter graphs, because the chime is a MELODY: sequencing twenty notes as
// oscillator inputs is unreadable, whereas a note table is a tune you can edit.
//
// THE ENGINE IS ONE CHUG, NOT A LOOPING BED. The obvious design was a seamless
// one-second bed played on a loop with its playbackRate driven by ground speed.
// It does not survive the asset standard: every cue ships as MP3, and the
// encoder's own delay and padding land a few tens of milliseconds of silence at
// the end of the decoded buffer, so a looped bed ticks audibly once per lap no
// matter how carefully the synthesis closes over its period. Retriggering a
// single cylinder-firing one-shot instead puts the cadence in the caller's hands
// (src/render/mount_chug_core.ts steps the interval off speed), which is both
// seam-proof and a better read for a tired old truck: it lopes at idle and
// gallops under throttle rather than droning at a shifted pitch.
//
// Deterministic: the only randomness is a seeded integer hash, so the same
// source renders the same bytes on every machine.

/** One cylinder firing, plus its tail. Short enough that the runtime can stack
 *  them at fifteen a second under full throttle without smearing. */
export const ENGINE_DURATION = 0.34;
/** Chime length. The brief asked for five seconds and the phrase is written to
 *  fill exactly that. */
export const CHIME_DURATION = 5;
export const SAMPLE_RATE = 44100;

/** Deterministic unit-interval hash. */
function hash01(index, seed) {
  let value = (index ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * Periodic band-limited noise.
 *
 * Built as a sum of harmonics with hashed phases rather than by filtering white
 * noise: a sum of harmonics of 1/duration is periodic over the buffer by
 * construction, so the band stays exactly where it is asked for with no filter
 * ringing at the edges, and it is reproducible from the seed alone.
 */
function periodicNoise(length, duration, lowHz, highHz, seed) {
  const out = new Float32Array(length);
  const lowHarmonic = Math.max(1, Math.round(lowHz * duration));
  const highHarmonic = Math.max(lowHarmonic + 1, Math.round(highHz * duration));
  const count = highHarmonic - lowHarmonic;
  const scale = 1 / Math.sqrt(count);
  for (let harmonic = lowHarmonic; harmonic < highHarmonic; harmonic++) {
    const phase = hash01(harmonic, seed) * Math.PI * 2;
    const omega = (Math.PI * 2 * harmonic) / duration;
    const amplitude = scale * (0.6 + 0.4 * hash01(harmonic, seed ^ 0x5bf03635));
    for (let index = 0; index < length; index++) {
      out[index] += Math.sin(omega * (index / SAMPLE_RATE) + phase) * amplitude;
    }
  }
  return out;
}

/** Soft clip, the cheap stand-in for an overdriven speaker cone. */
function saturate(value, drive) {
  return Math.tanh(value * drive) / Math.tanh(drive);
}

/**
 * One cylinder firing on a tired old truck engine.
 *
 * Three layers, all decaying from the same strike: the low combustion thump at
 * 58 Hz with its harmonics, the exhaust blat just above it, and the tappet
 * clatter on top. The clatter is what says "old" rather than merely "engine",
 * so it decays slowest and is band-limited high where a worn valvetrain lives.
 * The whole thing is soft-clipped, because a truck exhaust is not a clean
 * source and the saturation is most of the character.
 */
export function renderEngineChug() {
  const length = Math.round(ENGINE_DURATION * SAMPLE_RATE);
  const out = new Float32Array(length);
  const clatter = periodicNoise(length, ENGINE_DURATION, 1100, 6000, 0x1c3a55);
  const blat = periodicNoise(length, ENGINE_DURATION, 120, 900, 0x77f10b);

  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE;
    // Strike envelope: near-instant attack, then down inside a third of a
    // second so consecutive firings articulate instead of smearing.
    const attack = Math.min(1, t / 0.003);
    const thumpEnvelope = Math.exp(-t * 17) * attack;
    const blatEnvelope = Math.exp(-t * 26) * attack;
    const clatterEnvelope = Math.exp(-t * 12) * attack;
    // Combustion thump. The pitch sags slightly across the strike, which is
    // what a single cylinder actually does as the charge burns off.
    const sag = 1 - 0.12 * Math.min(1, t / 0.12);
    const thump =
      Math.sin(Math.PI * 2 * 58 * sag * t) * 0.62 +
      Math.sin(Math.PI * 2 * 116 * sag * t) * 0.3 +
      Math.sin(Math.PI * 2 * 174 * sag * t) * 0.15;
    out[index] =
      saturate(
        thump * thumpEnvelope * 0.72 +
          blat[index] * blatEnvelope * 0.34 +
          clatter[index] * clatterEnvelope * 0.16,
        2.1,
      ) * 0.66;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The chime
// ---------------------------------------------------------------------------

/** MIDI note to Hz. */
function noteHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

const G4 = 67;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const F5 = 77;
const G5 = 79;
const A5 = 81;

/**
 * The tune. `[start, duration, midi, bend]`, seconds and semitones.
 *
 * A bright little four-bar phrase that turns up at the end and then sags: the
 * last note bends a full semitone flat over its hold, which is the joke. Real
 * ice cream vans do this when the tape stretches, and it is what makes the
 * thing read as the WEIRDO Cream truck rather than as a generic jingle.
 */
export const CHIME_NOTES = Object.freeze([
  [0.0, 0.25, G5, 0],
  [0.25, 0.25, E5, 0],
  [0.5, 0.5, C5, 0],
  [1.0, 0.25, D5, 0],
  [1.25, 0.25, E5, 0],
  [1.5, 0.25, F5, 0],
  [1.75, 0.25, D5, 0],
  [2.0, 0.25, E5, 0],
  [2.25, 0.25, C5, 0],
  [2.5, 0.5, G5, 0],
  [3.0, 0.25, A5, 0],
  [3.25, 0.25, G5, 0],
  [3.5, 0.25, E5, 0],
  [3.75, 0.25, C5, 0],
  [4.0, 1.0, C5, -1.15],
]);

/** The oom-pah bass under the phrase, one note per beat. */
const CHIME_BASS = Object.freeze([
  [0.0, C5 - 24],
  [1.0, G4 - 12],
  [2.0, C5 - 24],
  [3.0, G4 - 12],
  [4.0, C5 - 24],
]);

/**
 * A music-box voice: a struck partial stack with a fast attack and an
 * exponential decay, the higher partials decaying faster the way a real
 * tine does. `detune` spreads the stack slightly so the timbre reads as a
 * cheap mechanism rather than as an additive synth.
 */
function strikeInto(out, startSample, frequency, seconds, amplitude, bendSemitones) {
  const partials = [
    [1, 1, 1],
    [2, 0.42, 1.6],
    [3.01, 0.2, 2.3],
    [4.17, 0.12, 3.1],
    [5.43, 0.06, 4],
  ];
  const total = Math.round(seconds * SAMPLE_RATE);
  for (let index = 0; index < total; index++) {
    const sample = startSample + index;
    if (sample >= out.length) break;
    const t = index / SAMPLE_RATE;
    const progress = t / seconds;
    // Attack over 4 ms, then the tine rings down.
    const attack = Math.min(1, t / 0.004);
    // The bend is applied as a running pitch multiplier, so a bent note slides
    // rather than stepping.
    const bend = 2 ** ((bendSemitones * progress) / 12);
    let value = 0;
    for (const [ratio, gain, decay] of partials) {
      value +=
        Math.sin(Math.PI * 2 * frequency * ratio * bend * t) * gain * Math.exp(-t * decay * 4.2);
    }
    out[sample] += value * attack * amplitude;
  }
}

/** A short plucked bass note for the oom-pah. */
function bassInto(out, startSample, frequency, amplitude) {
  const total = Math.round(0.34 * SAMPLE_RATE);
  for (let index = 0; index < total; index++) {
    const sample = startSample + index;
    if (sample >= out.length) break;
    const t = index / SAMPLE_RATE;
    const envelope = Math.exp(-t * 9) * Math.min(1, t / 0.006);
    out[sample] +=
      (Math.sin(Math.PI * 2 * frequency * t) + Math.sin(Math.PI * 2 * frequency * 2 * t) * 0.3) *
      envelope *
      amplitude;
  }
}

/**
 * Render the chime.
 *
 * The finished mix runs through a narrow band-pass and a hard-ish saturation,
 * because the sound is not a music box in a room: it is a music box through a
 * horn speaker bolted to a van roof, and that tinny band is most of what makes
 * it recognizable.
 */
export function renderChime() {
  const length = Math.round(CHIME_DURATION * SAMPLE_RATE);
  const dry = new Float32Array(length);
  for (const [start, duration, midi, bend] of CHIME_NOTES) {
    // Notes ring past their slot, which is what makes a music box sound like
    // one; the tail is clipped by the buffer end.
    strikeInto(
      dry,
      Math.round(start * SAMPLE_RATE),
      noteHz(midi),
      Math.min(duration + 0.9, CHIME_DURATION - start),
      0.3,
      bend,
    );
  }
  for (const [start, midi] of CHIME_BASS) {
    bassInto(dry, Math.round(start * SAMPLE_RATE), noteHz(midi), 0.22);
  }

  // Horn-speaker colouration: a one-pole high-pass into a one-pole low-pass
  // leaves a mid band around 500 Hz to 4 kHz, then a light saturation.
  const out = new Float32Array(length);
  const highPassCoefficient = Math.exp((-2 * Math.PI * 480) / SAMPLE_RATE);
  const lowPassCoefficient = Math.exp((-2 * Math.PI * 4200) / SAMPLE_RATE);
  let previousInput = 0;
  let highPassed = 0;
  let lowPassed = 0;
  for (let index = 0; index < length; index++) {
    const input = dry[index];
    highPassed = highPassCoefficient * (highPassed + input - previousInput);
    previousInput = input;
    lowPassed += (1 - lowPassCoefficient) * (highPassed - lowPassed);
    // Fade the last 60 ms so the clip ends clean rather than on a ring.
    const tailStart = length - Math.round(0.06 * SAMPLE_RATE);
    const tail = index < tailStart ? 1 : (length - index) / (length - tailStart);
    out[index] = saturate(lowPassed * 1.35, 2.2) * 0.72 * tail;
  }
  return out;
}

/** Float samples in [-1, 1] to a 16-bit mono WAV buffer. */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  }
  return buffer;
}
