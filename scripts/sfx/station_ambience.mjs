// Deterministic synthesis for the crafting-station ambience beds (issue
// #2208): amb_kitchens, amb_apothecary, amb_tannery, amb_loom, amb_toolworks.
// Pure DSP over Float32Array PCM, no I/O and no FFmpeg: the generator
// (scripts/gen_station_ambience.mjs) writes the WAV and runs the shared
// conform pass. Everything is seeded (fnv1a of the cue key) so a re-run is
// byte-identical: same repo, same clips.
//
// Loop safety is BY CONSTRUCTION, the two amb_forge lessons applied in
// reverse (that clip decays to silence at the wrap, these must not):
// continuous bed layers render 0.6 s long and equal-power-crossfade the tail
// into the head, so the bed is exactly periodic across the MP3 wrap, and
// every discrete foley event is placed so its tail fully decays at least
// 0.45 s before the end. assertLoopSafe pins both properties at render time.
// Rhythms deliberately break pattern (uneven strike spacing, varied gaps)
// so no station bed turns metronomic over a long stand-nearby session.

export const SAMPLE_RATE = 44100;
const TAU = Math.PI * 2;
// Bed-layer crossfade length (seconds) used to make beds exactly periodic.
// Compositions keep every discrete event fully decayed at least 0.45 s
// before the wrap; assertLoopSafe verifies that in the rendered signal.
const BED_CROSS_S = 0.6;

/** Samples for a time in seconds, rounded. */
const sec = (s) => Math.round(s * SAMPLE_RATE);

/** fnv1a string hash: the per-cue deterministic seed. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG: small, seedable, deterministic across platforms. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Small in-place DSP blocks ---------------------------------------------

/** One-pole low-pass over a buffer, in place. */
function lowpass(buf, cutoffHz) {
  const k = 1 - Math.exp((-TAU * cutoffHz) / SAMPLE_RATE);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += k * (buf[i] - y);
    buf[i] = y;
  }
}

/** DC blocker, in place (keeps integrated noise from drifting). */
function dcBlock(buf) {
  let px = 0;
  let py = 0;
  for (let i = 0; i < buf.length; i++) {
    const y = buf[i] - px + 0.995 * py;
    px = buf[i];
    py = y;
    buf[i] = y;
  }
}

/** RBJ band-pass (constant 0 dB peak) with an exponential center sweep,
 *  in place. Coefficients update every 32 samples along the sweep. */
function bandpassSweep(buf, fromHz, toHz, q) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const n = buf.length;
  const ratio = toHz / fromHz;
  let b0 = 0;
  let a1 = 0;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    if (i % 32 === 0) {
      const f = fromHz * ratio ** (i / n);
      const w0 = (TAU * f) / SAMPLE_RATE;
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      b0 = alpha / a0;
      a1 = (-2 * Math.cos(w0)) / a0;
      a2 = (1 - alpha) / a0;
    }
    const x0 = buf[i];
    const y0 = b0 * x0 - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    buf[i] = y0;
  }
}

/** Slow amplitude wobble, in place (simmer, breeze, machine flutter). */
function applyAm(buf, rateHz, depth, phase = 0) {
  const w = (TAU * rateHz) / SAMPLE_RATE;
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= 1 - depth * 0.5 + depth * 0.5 * Math.sin(phase + w * i);
  }
}

// --- Discrete foley events (all add into `out` at time t0) -----------------

/** A struck resonant object: damped sine partials plus a 2.5 ms contact
 *  click. `partials` rows are [freqHz, decaySeconds, relativeAmp]. */
function addStrike(out, rng, t0, partials, gain) {
  const start = sec(t0);
  for (const [freq, decay, amp] of partials) {
    const f = freq * 2 ** (((rng() * 2 - 1) * 14) / 1200);
    const w = (TAU * f) / SAMPLE_RATE;
    const phase = rng() * TAU;
    const nS = Math.min(sec(decay * 6), out.length - start);
    const dk = 1 / (decay * SAMPLE_RATE);
    for (let i = 0; i < nS; i++) {
      out[start + i] += Math.sin(phase + w * i) * amp * gain * Math.exp(-i * dk);
    }
  }
  const clickN = Math.min(sec(0.0025), out.length - start);
  for (let i = 0; i < clickN; i++) {
    out[start + i] += (rng() * 2 - 1) * gain * 0.55 * (1 - i / clickN);
  }
}

/** One liquid bubble: a short rising sine chirp with a soft window. */
function addBubble(out, rng, t0, f0, dur, gain) {
  const start = sec(t0);
  const nS = Math.min(sec(dur), out.length - start);
  const phase = rng() * TAU;
  let ph = phase;
  for (let i = 0; i < nS; i++) {
    const u = i / nS;
    const f = f0 * (1 + 0.45 * u);
    ph += (TAU * f) / SAMPLE_RATE;
    out[start + i] += Math.sin(ph) * gain * Math.sin(Math.PI * u) ** 1.4;
  }
}

/** A filtered noise gesture (scrape, file stroke, swish, pour, sizzle):
 *  band-passed white noise with a center-frequency sweep, an attack-shaped
 *  window, and an optional rasp AM that sells tool-on-surface texture. */
function addNoiseSweep(out, rng, t0, dur, opts) {
  const { fromHz, toHz, q, gain, attackFrac = 0.5, raspHz = 0, raspDepth = 0 } = opts;
  const nS = Math.min(sec(dur), out.length - sec(t0));
  const seg = new Float32Array(nS);
  for (let i = 0; i < nS; i++) seg[i] = rng() * 2 - 1;
  bandpassSweep(seg, fromHz, toHz, q);
  if (raspHz > 0) applyAm(seg, raspHz, raspDepth, rng() * TAU);
  const start = sec(t0);
  const aN = Math.max(1, Math.floor(nS * attackFrac));
  for (let i = 0; i < nS; i++) {
    const env =
      i < aN
        ? Math.sin(((i / aN) * Math.PI) / 2)
        : Math.cos((((i - aN) / (nS - aN)) * Math.PI) / 2);
    out[start + i] += seg[i] * gain * env * env;
  }
}

/** Liquid slosh: low-passed noise swell with a slow sub-wobble. */
function addSlosh(out, rng, t0, dur, gain) {
  const nS = Math.min(sec(dur), out.length - sec(t0));
  const seg = new Float32Array(nS);
  for (let i = 0; i < nS; i++) seg[i] = rng() * 2 - 1;
  bandpassSweep(seg, 420, 170, 0.8);
  applyAm(seg, 1.7, 0.8, rng() * TAU);
  const start = sec(t0);
  for (let i = 0; i < nS; i++) {
    const u = i / nS;
    const env =
      Math.sin(Math.PI * Math.min(1, u / 0.45) * 0.5) ** 1.2 *
      Math.cos((Math.max(0, u - 0.45) / 0.55) * (Math.PI / 2));
    out[start + i] += seg[i] * gain * env;
  }
}

/** Wood or cork creak: a stick-slip pulse train that accelerates then eases,
 *  each pulse a tiny damped knock around `freqHz`. */
function addCreak(out, rng, t0, dur, freqHz, gain) {
  let t = t0;
  const end = t0 + dur;
  let i = 0;
  while (t < end) {
    const u = (t - t0) / dur;
    const rate = 12 + 26 * Math.sin(Math.PI * u);
    const env = Math.sin(Math.PI * u);
    addStrike(out, rng, t, [[freqHz * (1 + 0.12 * u), 0.014, 1]], gain * (0.4 + 0.6 * env));
    t += 1 / rate;
    if (++i > 200) break;
  }
}

/** Machine hum swell: a detuned sine pair (chorused, so it breathes). */
function addHum(out, rng, t0, dur, freqHz, gain) {
  const start = sec(t0);
  const nS = Math.min(sec(dur), out.length - start);
  const w1 = (TAU * freqHz) / SAMPLE_RATE;
  const w2 = (TAU * freqHz * 1.004) / SAMPLE_RATE;
  const p1 = rng() * TAU;
  const p2 = rng() * TAU;
  for (let i = 0; i < nS; i++) {
    const u = i / nS;
    const env = Math.sin(Math.PI * u);
    out[start + i] += (Math.sin(p1 + w1 * i) + 0.7 * Math.sin(p2 + w2 * i)) * gain * env * 0.5;
  }
}

// --- Periodic bed construction ---------------------------------------------

/** Render a bed layer `renderFn(buf)` over n + cross samples and equal-power
 *  crossfade the tail into the head, returning an exactly periodic layer.
 *  Tonal layers must pick freq * durationSeconds = integer so the wrap
 *  blends identical phase (see composeToolworks's hum). */
function periodicBed(n, renderFn) {
  const cross = sec(BED_CROSS_S);
  const ext = new Float32Array(n + cross);
  renderFn(ext);
  const outBed = new Float32Array(n);
  for (let i = 0; i < n; i++) outBed[i] = ext[i];
  for (let i = 0; i < cross; i++) {
    const w = i / cross;
    outBed[i] = ext[i] * Math.sin((w * Math.PI) / 2) + ext[n + i] * Math.cos((w * Math.PI) / 2);
  }
  return outBed;
}

/** Sparse crackle impulses (hearth pops), low-passed into softness. */
function crackleLayer(rng, buf, ratePerS, cutoffHz, gain) {
  let t = 0;
  const durS = buf.length / SAMPLE_RATE;
  while (t < durS) {
    t += -Math.log(1 - rng()) / ratePerS;
    const at = sec(t);
    if (at >= buf.length - 4) break;
    const amp = rng() ** 2.2 * gain;
    buf[at] += amp;
    buf[at + 1] += amp * 0.5;
    buf[at + 2] -= amp * 0.3;
  }
  lowpass(buf, cutoffHz);
}

/** Filtered-noise bed layer helper: white noise, one-pole low-pass, gain. */
function noiseLayer(rng, buf, cutoffHz, gain) {
  const seg = new Float32Array(buf.length);
  for (let i = 0; i < seg.length; i++) seg[i] = rng() * 2 - 1;
  lowpass(seg, cutoffHz);
  dcBlock(seg);
  for (let i = 0; i < seg.length; i++) buf[i] += seg[i] * gain;
}

/** Band-passed shimmer/whir bed layer. */
function bandLayer(rng, buf, centerHz, q, gain, amRate = 0, amDepth = 0) {
  const seg = new Float32Array(buf.length);
  for (let i = 0; i < seg.length; i++) seg[i] = rng() * 2 - 1;
  bandpassSweep(seg, centerHz, centerHz, q);
  if (amRate > 0) applyAm(seg, amRate, amDepth, rng() * TAU);
  for (let i = 0; i < seg.length; i++) buf[i] += seg[i] * gain;
}

// --- The five station compositions -----------------------------------------

/** Eastbrook kitchens: hearth crackle under a stew that will not stop
 *  bubbling, two uneven knife-chop clusters, one pan sizzle, one pot tink,
 *  a ladle stir near the end. */
function composeKitchens(rng, n) {
  const out = periodicBed(n, (buf) => {
    noiseLayer(rng, buf, 700, 0.05);
    crackleLayer(rng, buf, 16, 1400, 0.5);
    bandLayer(rng, buf, 500, 1.2, 0.018, 5, 0.5);
  });
  for (let i = 0; i < 26; i++) {
    const t = 0.4 + rng() * 11.4;
    addBubble(out, rng, t, 180 + rng() * 240, 0.03 + rng() * 0.03, 0.05 + rng() * 0.04);
  }
  const woodBlock = [
    [190, 0.03, 1],
    [430, 0.02, 0.5],
    [1250, 0.008, 0.35],
  ];
  for (const [t, g] of [
    [2.1, 0.32],
    [2.34, 0.29],
    [2.62, 0.33],
    [2.83, 0.27],
  ]) {
    addStrike(out, rng, t, woodBlock, g);
  }
  addNoiseSweep(out, rng, 5.4, 1.9, {
    fromHz: 3200,
    toHz: 2400,
    q: 0.7,
    gain: 0.1,
    attackFrac: 0.12,
    raspHz: 9,
    raspDepth: 0.35,
  });
  addStrike(out, rng, 6.9, woodBlock, 0.09); // a distant chop from the far bench
  for (const [t, g] of [
    [8.4, 0.34],
    [8.78, 0.3],
  ]) {
    addStrike(
      out,
      rng,
      t,
      [
        [150, 0.04, 1],
        [360, 0.025, 0.5],
        [1100, 0.009, 0.3],
      ],
      g,
    );
  }
  addStrike(
    out,
    rng,
    10.6,
    [
      [820, 0.05, 1],
      [1930, 0.04, 0.6],
      [3100, 0.02, 0.35],
    ],
    0.16,
  );
  addSlosh(out, rng, 11.2, 0.8, 0.08);
  return out;
}

/** Highwatch apothecary: a quiet glass laboratory, slow glassy bubbles and
 *  retort glugs, one clink pair, one long pour, a cork squeak. */
function composeApothecary(rng, n) {
  const out = periodicBed(n, (buf) => {
    noiseLayer(rng, buf, 350, 0.03);
    bandLayer(rng, buf, 850, 1, 0.02, 3.5, 0.5);
    bandLayer(rng, buf, 3400, 2, 0.006);
  });
  for (let i = 0; i < 18; i++) {
    const t = 0.35 + rng() * 10.5;
    addBubble(out, rng, t, 400 + rng() * 500, 0.025 + rng() * 0.02, 0.045 + rng() * 0.03);
  }
  for (const t of [2.8, 6.4, 9.1]) {
    addBubble(out, rng, t, 240, 0.07, 0.09);
    addBubble(out, rng, t + 0.09, 200, 0.06, 0.07);
  }
  const glass = [
    [1650, 0.09, 1],
    [2700, 0.05, 0.55],
    [4200, 0.03, 0.3],
  ];
  addStrike(out, rng, 3.5, glass, 0.14);
  addStrike(out, rng, 3.62, glass, 0.09);
  addNoiseSweep(out, rng, 7.1, 1.3, {
    fromHz: 1200,
    toHz: 700,
    q: 1.2,
    gain: 0.09,
    attackFrac: 0.3,
  });
  for (let i = 0; i < 7; i++) {
    addBubble(out, rng, 7.25 + i * 0.16, 500 + rng() * 400, 0.02, 0.04);
  }
  addCreak(out, rng, 9.7, 0.28, 900, 0.07);
  return out;
}

/** Fenbridge tannery: open-air breeze, long hide-scraping strokes in uneven
 *  clusters, a vat slosh, a rack creak, a wring-out splash. */
function composeTannery(rng, n) {
  const out = periodicBed(n, (buf) => {
    noiseLayer(rng, buf, 300, 0.045);
    applyAm(buf, 0.3, 0.4, rng() * TAU);
  });
  const stroke = (t, dur, from, to, g) =>
    addNoiseSweep(out, rng, t, dur, {
      fromHz: from,
      toHz: to,
      q: 2.2,
      gain: g,
      attackFrac: 0.35,
      raspHz: 26,
      raspDepth: 0.55,
    });
  stroke(1.4, 0.42, 900, 520, 0.3);
  stroke(1.95, 0.45, 860, 500, 0.27);
  stroke(2.6, 0.4, 940, 540, 0.31);
  addSlosh(out, rng, 4.9, 1.1, 0.16);
  stroke(7.6, 0.55, 700, 380, 0.34);
  stroke(8.35, 0.58, 680, 360, 0.3);
  addCreak(out, rng, 10.3, 0.6, 150, 0.12);
  addSlosh(out, rng, 11.6, 0.7, 0.12);
  for (let i = 0; i < 5; i++) {
    addBubble(out, rng, 11.9 + i * 0.11, 900 + rng() * 500, 0.018, 0.035);
  }
  return out;
}

/** Eastbrook loom: the weaving cycle (shuttle swish, clack pair, beater
 *  thump) in two runs with human gaps, a treadle creak, a thread whisper. */
function composeLoom(rng, n) {
  const out = periodicBed(n, (buf) => {
    noiseLayer(rng, buf, 450, 0.028);
    bandLayer(rng, buf, 1700, 2.5, 0.006);
  });
  const clack = [
    [640, 0.018, 1],
    [1450, 0.01, 0.55],
    [320, 0.03, 0.6],
  ];
  const thump = [
    [120, 0.045, 1],
    [240, 0.02, 0.5],
  ];
  const throwAt = (t, g) => {
    addNoiseSweep(out, rng, t, 0.16, {
      fromHz: 1300,
      toHz: 900,
      q: 1.6,
      gain: 0.1 * g,
      attackFrac: 0.4,
    });
    addStrike(out, rng, t + 0.1, clack, 0.3 * g);
    addStrike(out, rng, t + 0.155, clack, 0.24 * g);
    addStrike(out, rng, t + 0.34, thump, 0.3 * g);
  };
  for (const t of [0.9, 2.05, 3.15, 4.4]) throwAt(t, 1);
  addCreak(out, rng, 6.1, 0.5, 180, 0.1);
  for (const t of [7.0, 8.2, 9.35]) throwAt(t, 0.9);
  addNoiseSweep(out, rng, 10.6, 0.3, {
    fromHz: 1500,
    toHz: 1100,
    q: 1.8,
    gain: 0.05,
    attackFrac: 0.5,
  });
  return out;
}

/** Eastbrook toolworks: file strokes in forward-back pairs, a light tink
 *  triplet (a jeweler's cousin of the smithy anvil, never competing with
 *  it), an accelerating ratchet run, a gear whir. The 108 Hz bench hum
 *  picks freq * duration = integer cycles so the loop wrap blends in phase. */
function composeToolworks(rng, n) {
  const out = periodicBed(n, (buf) => {
    noiseLayer(rng, buf, 550, 0.03);
    bandLayer(rng, buf, 2600, 2, 0.005);
    const w = (TAU * 108) / SAMPLE_RATE; // 108 * 13.0 s = 1404 whole cycles
    for (let i = 0; i < buf.length; i++) buf[i] += Math.sin(w * i) * 0.01;
  });
  const fileStroke = (t, from, to, g) =>
    addNoiseSweep(out, rng, t, 0.5, {
      fromHz: from,
      toHz: to,
      q: 2.8,
      gain: g,
      attackFrac: 0.4,
      raspHz: 34,
      raspDepth: 0.5,
    });
  fileStroke(1.2, 2100, 1500, 0.24);
  fileStroke(1.85, 1500, 2000, 0.2);
  fileStroke(3.1, 2200, 1550, 0.25);
  fileStroke(3.8, 1550, 2050, 0.21);
  const tink = [
    [1180, 0.1, 1],
    [2350, 0.07, 0.6],
    [3900, 0.04, 0.4],
    [5200, 0.02, 0.25],
  ];
  for (const [t, g] of [
    [5.0, 0.2],
    [5.23, 0.17],
    [5.52, 0.21],
  ]) {
    addStrike(out, rng, t, tink, g);
  }
  let t = 7.9;
  for (let i = 0; i < 11; i++) {
    addStrike(out, rng, t, [[2800, 0.006, 1]], 0.13);
    t += 0.09 - i * 0.004;
  }
  addStrike(
    out,
    rng,
    9.6,
    [
      [210, 0.035, 1],
      [520, 0.02, 0.5],
    ],
    0.2,
  );
  addHum(out, rng, 10.7, 1.3, 140, 0.05);
  addNoiseSweep(out, rng, 10.8, 1.1, {
    fromHz: 700,
    toHz: 750,
    q: 1.2,
    gain: 0.02,
    attackFrac: 0.5,
  });
  return out;
}

// --- Catalog ----------------------------------------------------------------

/** The five station beds. `prompt` is the authored sound-design brief (it
 *  documents intent in the catalog exactly like the ElevenLabs rows; nothing
 *  regenerates from it, see custom: true in scripts/sfx/sfx_prompts.mjs). */
export const STATION_AMBIENCE_SPECS = [
  {
    key: 'amb_kitchens',
    duration: 12.8,
    compose: composeKitchens,
    prompt:
      'A town kitchen at work: hearth crackle, a stew bubbling, uneven knife chops, one pan sizzle, a pot tink, a ladle stir. Seamless loop, no music.',
  },
  {
    key: 'amb_apothecary',
    duration: 11.6,
    compose: composeApothecary,
    prompt:
      'A quiet apothecary laboratory: slow glassy bubbles, retort glugs, a glass clink, a long careful pour, a cork squeak. Seamless loop, no music.',
  },
  {
    key: 'amb_tannery',
    duration: 13.4,
    compose: composeTannery,
    prompt:
      'An open-air tannery: long hide-scraping strokes, a vat slosh, a drying-rack creak, a wring-out splash on a breeze. Seamless loop, no music.',
  },
  {
    key: 'amb_loom',
    duration: 12.2,
    compose: composeLoom,
    prompt:
      'A weaving room: shuttle swish, wooden clack pairs, beater thumps in an uneven human rhythm, a treadle creak, a thread whisper. Seamless loop, no music.',
  },
  {
    key: 'amb_toolworks',
    duration: 13.0,
    compose: composeToolworks,
    prompt:
      'A tinker workshop: file strokes back and forth, light metallic tinks, an accelerating ratchet run, a gear whir over a low bench hum. Seamless loop, no music.',
  },
];

/** Render-time loop-safety pins (see the module comment): a bed-only head
 *  and tail within 4 dB of each other, and no event tail inside the final
 *  guard window. Deterministic, so a failure is a composition bug, never
 *  flake. */
function assertLoopSafe(key, out) {
  const rms = (from, to) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += out[i] * out[i];
    return Math.sqrt(sum / Math.max(1, to - from));
  };
  // Matched 350 ms windows: every composition keeps both the head and the
  // tail bed-only (first event at 0.35 s or later, last tail decayed by the
  // guard), and the bed is one stationary periodic process, so the two
  // windows must look statistically alike. A discrete event tail leaking
  // into the wrap shows up as a tail peak far above the head's.
  const win = sec(0.35);
  const headRms = rms(0, win);
  const tailRms = rms(out.length - win, out.length);
  const ratioDb = Math.abs(20 * Math.log10(headRms / tailRms));
  if (!Number.isFinite(ratioDb) || ratioDb > 4) {
    throw new Error(`${key}: loop seam head/tail differ by ${ratioDb.toFixed(1)} dB`);
  }
  const peakIn = (from, to) => {
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(out[i]));
    return peak;
  };
  const headPeak = peakIn(0, win);
  const tailPeak = peakIn(out.length - win, out.length);
  if (tailPeak > 3 * headPeak) {
    throw new Error(`${key}: an event tail crosses the loop wrap (peak ${tailPeak.toFixed(3)})`);
  }
}

/** Render one station bed to mono Float32Array PCM, peak-scaled to 0.5 with
 *  loop-safety pins applied. Throws on an unknown key. */
export function renderStationAmbience(key) {
  const spec = STATION_AMBIENCE_SPECS.find((entry) => entry.key === key);
  if (!spec) throw new Error(`unknown station ambience: ${key}`);
  const rng = mulberry32(fnv1a(spec.key));
  const n = sec(spec.duration);
  const out = spec.compose(rng, n);
  if (out.length !== n) throw new Error(`${key}: composed ${out.length} samples, expected ${n}`);
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const scale = 0.5 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= scale;
  }
  assertLoopSafe(key, out);
  return out;
}
