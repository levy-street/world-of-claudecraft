// Gourdlight Eve's own sound effects, synthesized here from first principles (no
// recording, no generator, no third-party sample): oscillators, seeded noise and RBJ
// biquad filters, written as a 44.1 kHz mono master and conformed to the repo's asset
// standard (scripts/sfx/conform_audio.mjs) into public/audio/sfx/<key>.mp3.
//
//   node scripts/sfx/gourdlight_sfx.mjs [--only <key>]
//   then: npm run sfx:manifest
//
// The cues:
//   proj_gourdfall_whistle        a burning pumpkin dropping out of the sky: a falling
//                                 whistle over a rising roar of flame (Gourdfall)
//   impact_gourdfall              it lands: a hollow thump, a wet rind split, a burst of
//                                 flame and a spray of sparks
//   spell_swelling_gourd_pulse    the Swelling Gourd ripening: a deep, wet heartbeat
//   impact_swelling_gourd_burst   the Swelling Gourd bursting over the field
//   mount_idle_emberbristle_broom the Emberbristle Broom hovering at rest: a warm,
//                                 breathing hum with embers ticking (a seamless loop)
//   mount_run_emberbristle_broom  one stride of the broom on the move: a soft swish of
//                                 bristles through the air with an ember flare
//   impact_prank_pumpkin_splat    Pranker's Pumpkin lands on a head: a hollow bonk, a wet
//                                 splat and seeds pattering off
//   spell_wanderwisp_lantern      the Wanderwisp Lantern set down: a glassy chime and a
//                                 little ghost's rising "ooo"
//   spell_startled_bats           the Sack of Startled Bats opened: cloth, a flurry of
//                                 wings and a scatter of squeaks
//   spell_murmurwick_candle       the Murmurwick Candle lit: a match strike, a green
//                                 whoomp and the flutter of its shadows springing up
//   spell_gurglegreen_cauldron    the Gurglegreen Cauldron set down: an iron clank, a
//                                 slosh of brew, the first bubbles
//   gurglegreen_bubble_loop       it bubbling where it stands (a seamless 4 s loop)
//   spell_gurglegreen_quaff       a drink from it: two gulps, a fizz and a sparkle
//
// Deterministic: a fixed seed per cue (mulberry32), no clock. Original work, recorded in
// CREDITS.md.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio } from './conform_audio.mjs';
import { FFMPEG_PATH } from './ffmpeg_paths.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT_DIR = join(ROOT, 'public/audio/sfx');
const SR = 44100;
const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An RBJ biquad (lowpass, highpass, bandpass), its centre movable per sample. */
function biquad(type) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x, freq, q = 0.707) => {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (type === 'lp') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
    } else if (type === 'hp') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cw;
    const a2 = 1 - alpha;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

const env = (t, attack, decay) =>
  t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay);

/** A pitch-dropping sine thump: the body of an impact or a heartbeat. */
function thump(t, f0, f1, drop, decay) {
  if (t < 0) return 0;
  const f = f1 + (f0 - f1) * Math.exp(-t / drop);
  // phase of an exponentially gliding sine
  const phase = TAU * (f1 * t + (f0 - f1) * drop * (1 - Math.exp(-t / drop)));
  return Math.sin(phase) * env(t, 0.003, decay) * (f > 0 ? 1 : 0);
}

/** Fire: lowpassed noise with crackles (sparse, sharp, high-passed clicks). */
function makeFire(rand, crackleRate) {
  const lp = biquad('lp');
  const hp = biquad('hp');
  let crack = 0;
  return (t, roarHz, level, crackLevel) => {
    const n = rand() * 2 - 1;
    const roar = lp(n, roarHz, 0.9);
    if (rand() < crackleRate / SR) crack = (0.5 + rand()) * (rand() < 0.5 ? -1 : 1);
    crack *= 0.985;
    const c = hp(crack * (rand() * 2 - 1), 2500, 0.8);
    return roar * level + c * crackLevel;
  };
}

function render(seconds, fn) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  return out;
}

const CUES = {
  proj_gourdfall_whistle: () => {
    const rand = rng(101);
    const fire = makeFire(rand, 60);
    const air = biquad('bp');
    const dur = 0.95;
    return render(dur, (t) => {
      const u = t / dur;
      // the whistle falls from a shriek to a moan as it nears the ground
      const f = 1900 * (420 / 1900) ** u;
      const vib = 1 + 0.012 * Math.sin(TAU * 7 * t);
      const ph = (TAU * 1900 * dur * ((420 / 1900) ** u - 1)) / Math.log(420 / 1900);
      const tone = Math.sin(ph * vib) * 0.35 + Math.sin(ph * 2.01) * 0.06;
      const breath = air(rand() * 2 - 1, f * 1.1, 6) * 0.9;
      const swell = 0.25 + 0.75 * u ** 1.6;
      const roar = fire(t, 500 + 900 * u, 0.55 * u ** 1.3, 0.25 * u);
      const fade = Math.min(1, (dur - t) / 0.03) * Math.min(1, t / 0.08);
      return (tone + breath) * swell * fade * 0.8 + roar * fade;
    });
  },

  impact_gourdfall: () => {
    const rand = rng(202);
    const fire = makeFire(rand, 140);
    const wet = biquad('bp');
    const snap = biquad('hp');
    return render(1.25, (t) => {
      const body = thump(t, 140, 46, 0.05, 0.22) * 1.0;
      const hollow = thump(t, 320, 180, 0.03, 0.07) * 0.35;
      const split =
        wet(rand() * 2 - 1, 700 - 300 * Math.min(1, t / 0.15), 1.4) * env(t, 0.002, 0.07) * 1.6;
      const crack = snap(rand() * 2 - 1, 3000, 0.7) * env(t, 0.0005, 0.012) * 1.2;
      const flame = fire(
        t,
        1400 * Math.exp(-t / 0.5) + 300,
        0.9 * env(t, 0.03, 0.42),
        0.5 * env(t, 0.05, 0.5),
      );
      return body + hollow + split + crack + flame;
    });
  },

  spell_swelling_gourd_pulse: () => {
    const rand = rng(303);
    const squish = biquad('bp');
    const fire = makeFire(rand, 25);
    return render(0.62, (t) => {
      // lub-dub: two deep beats, the second softer, and the rind creaking as it stretches
      const lub = thump(t, 95, 48, 0.04, 0.11);
      const dub = thump(t - 0.17, 85, 44, 0.04, 0.1) * 0.7;
      const creak =
        squish(rand() * 2 - 1, 260 + 140 * Math.sin(TAU * 3 * t), 4) * env(t, 0.04, 0.16) * 0.9;
      const ember = fire(t, 700, 0.12 * env(t, 0.02, 0.3), 0.18 * env(t, 0.02, 0.3));
      const fade = Math.min(1, (0.62 - t) / 0.05);
      return (lub + dub + creak + ember) * fade;
    });
  },

  impact_swelling_gourd_burst: () => {
    const rand = rng(404);
    const fire = makeFire(rand, 220);
    const wet = biquad('bp');
    const debrisF = biquad('bp');
    const hits = [];
    for (let i = 0; i < 26; i++)
      hits.push([0.2 + rand() * 1.4, 300 + rand() * 900, 0.15 + rand() * 0.35]);
    return render(2.6, (t) => {
      const boom = thump(t, 110, 32, 0.09, 0.55) * 1.2;
      const body = thump(t, 260, 90, 0.04, 0.12) * 0.5;
      const splat =
        wet(rand() * 2 - 1, 900 - 500 * Math.min(1, t / 0.3), 1.1) * env(t, 0.003, 0.14) * 1.8;
      const flame = fire(
        t,
        2200 * Math.exp(-t / 0.7) + 260,
        1.1 * env(t, 0.02, 0.85),
        0.6 * env(t, 0.1, 0.9),
      );
      // wet debris pattering down round the field
      let deb = 0;
      for (const [at, hz, lv] of hits) {
        const dt = t - at;
        if (dt >= 0 && dt < 0.12) deb += Math.sin(TAU * hz * dt) * Math.exp(-dt / 0.02) * lv;
      }
      const patter = debrisF(deb, 600, 0.8) * 1.4;
      const fade = Math.min(1, (2.6 - t) / 0.2);
      return (boom + body + splat + flame + patter) * fade;
    });
  },

  mount_idle_emberbristle_broom: () => {
    // a seamless 3 s loop: every partial an integer number of cycles in the period, the
    // noise layers crossfaded tail-into-head
    const P = 3;
    const rand = rng(505);
    const fire = makeFire(rand, 9);
    const air = biquad('bp');
    const N = Math.round(P * SR);
    const noise = render(P + 0.5, (t) =>
      air(rand() * 2 - 1, 520 + 120 * Math.sin((TAU * t) / P), 1.6),
    );
    const embers = render(P + 0.5, (t) => fire(t, 900, 0.0, 0.5));
    const xf = Math.round(0.5 * SR);
    const loopNoise = (i, src) => {
      if (i >= xf) return src[i];
      const k = i / xf;
      return src[i] * k + src[i + N] * (1 - k);
    };
    return render(P, (t, i) => {
      const breathe = 0.8 + 0.2 * Math.sin((TAU * t) / P) + 0.06 * Math.sin((TAU * 3 * t) / P);
      const hum =
        Math.sin(TAU * 110 * t) * 0.32 +
        Math.sin(TAU * (165 + 1 / 3) * t) * 0.14 +
        Math.sin(TAU * 220 * t + 0.7) * 0.07 +
        Math.sin(TAU * (330 + 2 / 3) * t) * 0.03;
      const shimmer = Math.sin(TAU * 880 * t) * Math.sin((TAU * 4 * t) / P) * 0.015;
      return hum * breathe + shimmer + loopNoise(i, noise) * 0.22 + loopNoise(i, embers) * 0.22;
    });
  },

  mount_run_emberbristle_broom: () => {
    const rand = rng(606);
    const bp = biquad('bp');
    const hp = biquad('hp');
    const fire = makeFire(rand, 90);
    const dur = 0.55;
    return render(dur, (t) => {
      const u = t / dur;
      const swell = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 1.4;
      // a swish of air through bristles: a bandpass sweeping up, rustled by grains
      const swish = bp(rand() * 2 - 1, 380 + 1500 * u, 1.3) * swell * 1.3;
      const grain = 0.6 + 0.4 * Math.sin(TAU * 38 * t + 3 * Math.sin(TAU * 7 * t));
      const rustle = hp(rand() * 2 - 1, 3500, 0.7) * swell * grain * 0.35;
      const hum = Math.sin(TAU * 110 * t) * 0.12 * swell;
      const ember = fire(t, 1100, 0.18 * swell, 0.3 * swell);
      return swish + rustle + hum + ember;
    });
  },
  // ---- Hester's toys (round 9) ----

  impact_prank_pumpkin_splat: () => {
    // a soft pumpkin bursting on a head: a hollow bonk, a wet splat, seeds pattering off
    const rand = rng(707);
    const wet = biquad('bp');
    const wet2 = biquad('bp');
    const pat = biquad('bp');
    const seeds = [];
    for (let i = 0; i < 18; i++)
      seeds.push([0.09 + rand() * 0.55, 900 + rand() * 1600, 0.2 + rand() * 0.3]);
    return render(0.9, (t) => {
      const bonk = thump(t, 260, 150, 0.025, 0.07) * 0.8 + thump(t, 120, 70, 0.04, 0.12) * 0.6;
      const splat =
        wet(rand() * 2 - 1, 1100 - 700 * Math.min(1, t / 0.12), 1.2) * env(t, 0.002, 0.06) * 2.2;
      const squelch =
        wet2(rand() * 2 - 1, 420 + 260 * Math.sin(TAU * 9 * t), 3.5) *
        env(t - 0.03, 0.02, 0.14) *
        1.4;
      let d = 0;
      for (const [at, hz, lv] of seeds) {
        const dt = t - at;
        if (dt >= 0 && dt < 0.05) d += Math.sin(TAU * hz * dt) * Math.exp(-dt / 0.008) * lv;
      }
      const patter = pat(d, 1500, 0.9) * 1.2;
      const fade = Math.min(1, (0.9 - t) / 0.08);
      return (bonk + splat + squelch + patter) * fade;
    });
  },

  spell_wanderwisp_lantern: () => {
    // the lantern set down with a glassy chime, and a little ghost's rising "ooo" drifting out
    const rand = rng(808);
    const air = biquad('bp');
    const oo1 = biquad('bp');
    const oo2 = biquad('bp');
    const dur = 2.2;
    const bells = [
      [0.0, 1318.5, 0.5],
      [0.07, 1975.5, 0.3],
      [0.15, 2637, 0.18],
    ];
    return render(dur, (t) => {
      let chime = 0;
      for (const [at, hz, lv] of bells) {
        const dt = t - at;
        if (dt >= 0)
          chime +=
            (Math.sin(TAU * hz * dt) +
              0.4 * Math.sin(TAU * hz * 2.76 * dt) * Math.exp(-dt / 0.15)) *
            Math.exp(-dt / 0.55) *
            lv;
      }
      // the ghost: a breathy voice gliding up and back down through an "oo" formant
      const g = t - 0.35;
      let voice = 0;
      if (g > 0) {
        const u = Math.min(1, g / 1.6);
        const f = 330 + 220 * Math.sin(Math.PI * u) + 8 * Math.sin(TAU * 5.5 * g);
        const src = Math.sin(TAU * f * g) * 0.5 + (rand() * 2 - 1) * 0.6;
        const shape = Math.sin(Math.PI * u) ** 1.3;
        voice = (oo1(src, 320, 5) * 1.3 + oo2(src, 800, 6) * 0.5) * shape * 1.6;
      }
      const shimmer = air(rand() * 2 - 1, 5200, 3) * env(t, 0.05, 0.9) * 0.18;
      const fade = Math.min(1, (dur - t) / 0.2);
      return (chime * 0.6 + voice + shimmer) * fade;
    });
  },

  spell_startled_bats: () => {
    // the sack's cloth, then a flurry of wings and a scatter of squeaks
    const rand = rng(909);
    const cloth = biquad('bp');
    const wing = biquad('bp');
    const sq = biquad('hp');
    const dur = 2.4;
    const flaps = [];
    for (let i = 0; i < 70; i++) {
      const at = 0.18 + rand() ** 1.6 * 1.9;
      flaps.push([at, 260 + rand() * 520, 0.4 + rand() * 0.6, 0.012 + rand() * 0.02]);
    }
    const squeaks = [];
    for (let i = 0; i < 16; i++)
      squeaks.push([
        0.25 + rand() * 1.7,
        4200 + rand() * 3800,
        0.04 + rand() * 0.06,
        0.3 + rand() * 0.5,
      ]);
    return render(dur, (t) => {
      const rustle = cloth(rand() * 2 - 1, 1800, 0.9) * env(t, 0.01, 0.12) * 0.9;
      let w = 0;
      const n = rand() * 2 - 1;
      for (const [at, hz, lv, len] of flaps) {
        const dt = t - at;
        if (dt >= 0 && dt < len * 4)
          w += n * Math.exp(-dt / len) * lv * (1 + 0.5 * Math.sin(TAU * hz * dt));
      }
      const wings = wing(w, 700, 0.8) * 1.1;
      let s = 0;
      for (const [at, hz, len, lv] of squeaks) {
        const dt = t - at;
        if (dt >= 0 && dt < len) {
          const u = dt / len;
          const f = hz * (1 - 0.35 * u);
          s += Math.sin(TAU * f * dt + 2 * Math.sin(TAU * 60 * dt)) * Math.sin(Math.PI * u) * lv;
        }
      }
      const squeak = sq(s, 2500, 0.7) * 0.9;
      const fade = Math.min(1, (dur - t) / 0.3);
      return (rustle + wings + squeak) * fade;
    });
  },

  spell_murmurwick_candle: () => {
    // a match struck, the wick catching in a soft green whoomp, then a low papery flutter
    // as the shadows spring up round the dish (round 10: no voice, no giggle)
    const rand = rng(1010);
    const scratch = biquad('bp');
    const flare = biquad('lp');
    const flutter = biquad('bp');
    const fire = makeFire(rand, 40);
    const dur = 1.9;
    return render(dur, (t) => {
      const strike =
        scratch(rand() * 2 - 1, 3200, 1.2) * (t < 0.14 ? Math.sin((Math.PI * t) / 0.14) : 0) * 1.2;
      const whoomp =
        flare(rand() * 2 - 1, 500 + 1600 * Math.exp(-Math.max(0, t - 0.14) / 0.08), 0.9) *
        env(t - 0.14, 0.03, 0.25) *
        1.4;
      const flame = fire(t, 900, 0.25 * env(t - 0.2, 0.1, 0.9), 0.15 * env(t - 0.2, 0.1, 0.9));
      // the shadows rising: a soft rush of air beaten by unseen wings (a slow amplitude
      // flutter on band-passed breath), swelling and settling
      const rush = env(t - 0.55, 0.35, 0.5);
      const beat = 0.55 + 0.45 * Math.sin(TAU * 11 * t) * Math.sin(TAU * 2.3 * t);
      const wings = flutter(rand() * 2 - 1, 700 + 500 * rush, 1.6) * rush * beat * 0.9;
      const fade = Math.min(1, (dur - t) / 0.2);
      return (strike + whoomp + flame + wings) * fade;
    });
  },

  spell_gurglegreen_cauldron: () => {
    // a small iron cauldron set down: a hollow ringing clank, the brew sloshing against
    // the iron, then it catches and starts to bubble
    const rand = rng(1313);
    const slosh = biquad('lp');
    const pops = biquad('bp');
    const dur = 1.6;
    // its bubbles: fixed times and pitches (seeded), each a short rising "bloop"
    const bubbles = [];
    for (let k = 0; k < 14; k++) bubbles.push([0.45 + rand() * 1.0, 180 + rand() * 260]);
    return render(dur, (t) => {
      // the clank: two inharmonic iron partials, a quick hard attack, a ringing decay
      const ring =
        (Math.sin(TAU * 412 * t) * 0.6 +
          Math.sin(TAU * 1131 * t) * 0.35 +
          Math.sin(TAU * 2240 * t) * 0.15) *
        env(t, 0.002, 0.28);
      const thud = thump(t, 140, 60, 0.04, 0.12) * 0.9;
      const wash =
        slosh(rand() * 2 - 1, 380 + 300 * env(t - 0.08, 0.05, 0.3), 0.8) *
        env(t - 0.08, 0.05, 0.35) *
        0.9;
      let b = 0;
      for (const [at, f] of bubbles) {
        const dt = t - at;
        if (dt >= 0 && dt < 0.07) {
          b += Math.sin(TAU * (f + 900 * dt) * dt) * Math.sin((Math.PI * dt) / 0.07);
        }
      }
      const bloop = pops(b, 600, 0.9) * 1.6;
      const fade = Math.min(1, (dur - t) / 0.15);
      return (ring * 0.7 + thud + wash + bloop) * fade;
    });
  },

  gurglegreen_bubble_loop: () => {
    // the cauldron left bubbling: a thick, slow simmer of blooping bubbles over a low
    // seethe, a seamless 4 s loop (every bubble placed inside the period, the noise
    // bed crossfaded at the seam)
    const P = 4;
    const rand = rng(1414);
    const N = Math.round(P * SR);
    const seethe = biquad('lp');
    const pop = biquad('bp');
    const bubbles = [];
    for (let k = 0; k < 34; k++) {
      bubbles.push([rand() * P, 140 + rand() * 300, 0.05 + rand() * 0.07, 0.4 + rand() * 0.6]);
    }
    const raw = render(P + 0.5, (t) => {
      const bed = seethe(rand() * 2 - 1, 260, 0.7) * 0.28;
      let b = 0;
      for (const [at, f, len, lv] of bubbles) {
        for (const base of [at, at + P]) {
          const dt = t - base;
          if (dt >= 0 && dt < len) {
            b += Math.sin(TAU * (f + 700 * dt) * dt) * Math.sin((Math.PI * dt) / len) * lv;
          }
        }
      }
      return bed + pop(b, 520, 0.8) * 1.4;
    });
    const xf = Math.round(0.5 * SR);
    return render(P, (_t, i) => {
      if (i >= xf) return raw[i];
      const k = i / xf;
      return raw[i] * k + raw[i + N] * (1 - k);
    });
  },

  spell_gurglegreen_quaff: () => {
    // a drink from the cauldron: two big gulps, then a fizzing rush of tiny bubbles and
    // a little rising sparkle as the green takes hold
    const rand = rng(1515);
    const throat = biquad('bp');
    const fizz = biquad('hp');
    const shimmer = biquad('bp');
    const dur = 1.5;
    const sparks = [];
    for (let k = 0; k < 40; k++) sparks.push([0.5 + rand() * 0.8, 1800 + rand() * 2600]);
    return render(dur, (t) => {
      let gulp = 0;
      for (const at of [0.02, 0.27]) {
        const dt = t - at;
        if (dt >= 0 && dt < 0.18) {
          const f = 220 - 90 * (dt / 0.18);
          gulp += Math.sin(TAU * f * dt) * Math.sin((Math.PI * dt) / 0.18) ** 2;
        }
      }
      const glug = throat(gulp + (rand() * 2 - 1) * 0.15 * (t < 0.5 ? 1 : 0), 420, 1.2) * 2.2;
      const rush = fizz(rand() * 2 - 1, 5200, 0.7) * env(t - 0.48, 0.08, 0.45) * 0.55;
      let s = 0;
      for (const [at, f] of sparks) {
        const dt = t - at;
        if (dt >= 0 && dt < 0.03) s += Math.sin(TAU * f * dt) * Math.sin((Math.PI * dt) / 0.03);
      }
      const twinkle = shimmer(s, 3000, 1.1) * 0.8;
      const fade = Math.min(1, (dur - t) / 0.15);
      return (glug + rush + twinkle) * fade;
    });
  },
};

/** 16-bit PCM mono WAV. */
function wav(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const k = peak > 0 ? 0.9 / peak : 1;
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * k)) * 32767), 44 + i * 2);
  }
  return buf;
}

export const GOURDLIGHT_SFX_KEYS = Object.keys(CUES);

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? process.argv[onlyArg + 1] : null;
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, make] of Object.entries(CUES)) {
    if (only && key !== only) continue;
    const samples = make();
    const dest = join(OUT_DIR, `${key}.mp3`);
    const tmp = join(dirname(dest), `.${key}.${process.pid}.source.wav`);
    writeFileSync(tmp, wav(samples));
    try {
      conformSfxAudio({
        inputFile: tmp,
        outputFile: dest,
        duration: samples.length / SR,
        ffmpegPath: FFMPEG_PATH,
        channels: 1,
        // custom: true in the catalog: the synth's own mix is the master (peak-safe only),
        // never loudness-targeted like a generated clip
        preserveLoudness: true,
      });
    } finally {
      rmSync(tmp, { force: true });
    }
    console.log(`wrote ${key}.mp3 (${(samples.length / SR).toFixed(2)} s)`);
  }
}
