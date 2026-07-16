// Deterministic procedural source for the sampled UI cue catalog.
//
// The shipped MP3 files are generated through the shared conform pipeline by
// scripts/gen_ui_sfx.mjs. This module emits a lossless intermediate so the final
// 192 kbps file is encoded exactly once.

import { TARGET_SAMPLE_RATE } from './sfx_conform_rules.mjs';

const SAMPLE_RATE = TARGET_SAMPLE_RATE;
const MASTER_LIMIT = 0.749894; // -2.5 dBFS leaves MP3 true-peak headroom

// These gains shape the source character before the fixed peak/LUFS conform
// pass. They are not cross-clip runtime mix values.
const MASTER_GAINS_DB = {
  ui_click: 8.75,
  ui_error: 8.08,
  ui_bag_open: 17.44,
  ui_bag_close: 15.95,
  ui_coin: 4.89,
  ui_loot_item: 20.6,
  ui_quest_accept: 3.57,
  ui_quest_done: 0.8,
  ui_level_up: -0.37,
  ui_whisper: 6.25,
  ui_sheep: 6.49,
  ui_death: 5.58,
  ui_duel_challenge: 3.81,
  ui_duel_countdown: 8.85,
  ui_duel_start: 0.46,
  ui_duel_end: 1.86,
  ui_fiesta_word_0: 2.68,
  ui_fiesta_word_1: 2.55,
  ui_fiesta_word_2: 0.09,
  ui_fiesta_word_3: -0.36,
  ui_fiesta_score_mine: 6.02,
  ui_fiesta_score_other: 8.55,
  ui_fiesta_wave: -0.79,
  ui_fiesta_augment: 3.02,
  ui_fiesta_down: 6.66,
  ui_fiesta_revive: 4.01,
};

function tone(frequency, start, duration, gain, options = {}) {
  return {
    kind: 'tone',
    frequency,
    endFrequency: options.endFrequency ?? frequency,
    start,
    duration,
    gain,
    wave: options.wave ?? 'sine',
  };
}

function noise(color, start, duration, gain, options = {}) {
  return {
    kind: 'noise',
    color,
    start,
    duration,
    gain,
    highpass: options.highpass,
    lowpass: options.lowpass,
  };
}

function cue(key, duration, prompt, layers) {
  return { key, duration, prompt, layers };
}

function fiestaWord(tier, base) {
  const layers = [
    tone(base, 0, 0.2, 0.27, { wave: 'square' }),
    tone(base * 1.5, 0.05, 0.29, 0.21, { wave: 'triangle' }),
  ];
  if (tier >= 2) {
    layers.push(
      tone(base * 2, 0.1, 0.36, 0.14, { wave: 'triangle' }),
      noise('white', 0.08, 0.34, 0.045, { highpass: 2800 }),
    );
  }
  return cue(
    `ui_fiesta_word_${tier}`,
    0.65,
    `Bright arcade takedown stinger, intensity tier ${tier}. Punchy and celebratory, no speech.`,
    layers,
  );
}

export const UI_SFX_SPECS = [
  cue('ui_click', 0.5, 'Short crisp fantasy interface button click, clean and dry.', [
    tone(1400, 0, 0.06, 0.24, { wave: 'square' }),
    tone(900, 0.012, 0.05, 0.08, { wave: 'sine' }),
  ]),
  cue('ui_error', 0.5, 'Short low invalid-action interface buzz, clear but not harsh.', [
    tone(230, 0, 0.16, 0.22, { wave: 'square', endFrequency: 180 }),
    tone(175, 0.12, 0.15, 0.15, { wave: 'square' }),
  ]),
  cue('ui_bag_open', 0.5, 'Leather inventory bag opening with a soft metal clasp.', [
    noise('pink', 0, 0.16, 0.16, { highpass: 130, lowpass: 1500 }),
    tone(660, 0.045, 0.07, 0.11, { wave: 'triangle' }),
  ]),
  cue('ui_bag_close', 0.5, 'Leather inventory bag closing with a muted clasp.', [
    noise('pink', 0, 0.14, 0.14, { highpass: 100, lowpass: 900 }),
    tone(440, 0.02, 0.07, 0.1, { wave: 'triangle' }),
  ]),
  cue('ui_coin', 0.5, 'Two bright gold coin pings, compact fantasy reward cue.', [
    tone(2200, 0, 0.12, 0.19, { wave: 'square' }),
    tone(2800, 0.055, 0.16, 0.17, { wave: 'square' }),
    tone(1100, 0, 0.2, 0.045, { wave: 'sine' }),
  ]),
  cue('ui_loot_item', 0.5, 'Soft item pickup rustle and compact inventory tick.', [
    noise('pink', 0, 0.14, 0.16, { highpass: 500, lowpass: 1700 }),
    tone(950, 0.025, 0.11, 0.055, { wave: 'triangle' }),
  ]),
  cue('ui_quest_accept', 0.6, 'Two-note rising fantasy quest accepted chime.', [
    tone(660, 0, 0.22, 0.18, { wave: 'triangle' }),
    tone(880, 0.1, 0.3, 0.17, { wave: 'triangle' }),
  ]),
  cue('ui_quest_done', 0.75, 'Three-note ascending fantasy quest completion chime.', [
    tone(523, 0, 0.35, 0.16, { wave: 'triangle' }),
    tone(659, 0.12, 0.38, 0.16, { wave: 'triangle' }),
    tone(784, 0.24, 0.42, 0.16, { wave: 'triangle' }),
  ]),
  cue('ui_level_up', 0.95, 'Triumphant five-note fantasy level-up flourish with shimmer.', [
    tone(392, 0, 0.5, 0.13, { wave: 'triangle' }),
    tone(523, 0.09, 0.5, 0.13, { wave: 'triangle' }),
    tone(659, 0.18, 0.5, 0.13, { wave: 'triangle' }),
    tone(784, 0.27, 0.5, 0.13, { wave: 'triangle' }),
    tone(1046, 0.36, 0.52, 0.14, { wave: 'triangle' }),
    noise('white', 0.05, 0.78, 0.025, { highpass: 2600 }),
  ]),
  cue('ui_whisper', 0.5, 'Private message notification with two delicate glassy notes.', [
    tone(1175, 0, 0.12, 0.15),
    tone(1568, 0.07, 0.16, 0.12),
    noise('pink', 0.02, 0.19, 0.018, { highpass: 1700 }),
  ]),
  cue('ui_sheep', 0.65, 'Playful magical sheep transformation bleat-like synth cue.', [
    tone(620, 0, 0.44, 0.18, { wave: 'saw', endFrequency: 520 }),
    tone(1240, 0.015, 0.27, 0.04, { wave: 'sine', endFrequency: 1040 }),
  ]),
  cue('ui_death', 1.5, 'Somber descending player defeat sting with a dark soft impact.', [
    tone(220, 0, 1.4, 0.2, { wave: 'saw', endFrequency: 55 }),
    noise('brown', 0, 1.2, 0.12, { lowpass: 360 }),
  ]),
  cue('ui_duel_challenge', 0.9, 'Short two-note fantasy war horn announcing a duel challenge.', [
    tone(196, 0, 0.4, 0.23, { wave: 'saw' }),
    tone(294, 0.18, 0.52, 0.22, { wave: 'saw' }),
  ]),
  cue('ui_duel_countdown', 0.5, 'Tight bright duel countdown tick with a firm attack.', [
    tone(880, 0, 0.08, 0.23, { wave: 'square' }),
    tone(1760, 0, 0.05, 0.06, { wave: 'sine' }),
  ]),
  cue('ui_duel_start', 0.9, 'Compact fantasy duel-start gong with a bright cymbal wash.', [
    tone(220, 0, 0.72, 0.24, { wave: 'triangle', endFrequency: 110 }),
    noise('white', 0, 0.42, 0.09, { highpass: 1600 }),
  ]),
  cue('ui_duel_end', 0.65, 'Two-note resolved fantasy duel ending cadence.', [
    tone(392, 0, 0.22, 0.2, { wave: 'triangle' }),
    tone(523, 0.12, 0.36, 0.2, { wave: 'triangle' }),
  ]),
  fiestaWord(0, 523),
  fiestaWord(1, 587),
  fiestaWord(2, 659),
  fiestaWord(3, 784),
  cue('ui_fiesta_score_mine', 0.5, 'High two-note arcade score ping for the player team.', [
    tone(1320, 0, 0.1, 0.22, { wave: 'square' }),
    tone(1760, 0.05, 0.15, 0.18, { wave: 'square' }),
  ]),
  cue('ui_fiesta_score_other', 0.5, 'Lower single-note arcade score ping for the opposing team.', [
    tone(740, 0, 0.12, 0.2, { wave: 'square' }),
    tone(370, 0, 0.1, 0.05, { wave: 'sine' }),
  ]),
  cue('ui_fiesta_wave', 0.8, 'Rising four-note arcade augment wave fanfare with shimmer.', [
    tone(523, 0, 0.4, 0.16, { wave: 'triangle' }),
    tone(659, 0.08, 0.4, 0.16, { wave: 'triangle' }),
    tone(784, 0.16, 0.4, 0.16, { wave: 'triangle' }),
    tone(1046, 0.24, 0.44, 0.17, { wave: 'triangle' }),
    noise('white', 0.04, 0.6, 0.025, { highpass: 2800 }),
  ]),
  cue('ui_fiesta_augment', 0.7, 'Sparkling arcade power-up swell for locking an augment.', [
    tone(660, 0, 0.3, 0.17, { endFrequency: 1100 }),
    tone(990, 0.06, 0.36, 0.13, { endFrequency: 1480 }),
    noise('white', 0.04, 0.42, 0.022, { highpass: 3200 }),
  ]),
  cue('ui_fiesta_down', 0.55, 'Short friendly descending arcade downed cue.', [
    tone(440, 0, 0.35, 0.21, { wave: 'saw', endFrequency: 180 }),
  ]),
  cue('ui_fiesta_revive', 0.55, 'Quick optimistic upward arcade revive pop.', [
    tone(523, 0, 0.16, 0.19, { wave: 'triangle', endFrequency: 784 }),
    tone(784, 0.08, 0.25, 0.17, { wave: 'triangle' }),
  ]),
].map((spec) => ({ ...spec, masterGainDb: MASTER_GAINS_DB[spec.key] }));

export const UI_SFX_CATALOG = UI_SFX_SPECS.map(({ key, duration, prompt }) => ({
  key,
  duration,
  prompt,
  generator: 'ffmpeg',
}));

function formatNumber(value) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function stableSeed(key, index) {
  let hash = 2166136261;
  for (const char of `${key}:${index}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

function toneExpression(layer) {
  const sweep = (layer.endFrequency - layer.frequency) / (2 * layer.duration);
  const phase = `2*PI*(${formatNumber(layer.frequency)}*t+${formatNumber(sweep)}*t*t)`;
  const partials = {
    sine: `sin(${phase})`,
    triangle: `(sin(${phase})+0.111111*sin(3*(${phase}))+0.04*sin(5*(${phase})))/1.151111`,
    square: `(sin(${phase})+0.333333*sin(3*(${phase}))+0.2*sin(5*(${phase})))/1.533333`,
    saw: `(sin(${phase})+0.5*sin(2*(${phase}))+0.333333*sin(3*(${phase}))+0.25*sin(4*(${phase})))/2.083333`,
  };
  const waveform = partials[layer.wave];
  if (!waveform) throw new Error(`unsupported waveform: ${layer.wave}`);
  return `${formatNumber(layer.gain)}*${waveform}`;
}

function layerInput(key, layer, index) {
  if (layer.kind === 'tone') {
    return `aevalsrc=exprs='${toneExpression(layer)}':s=${SAMPLE_RATE}:d=${formatNumber(layer.duration)}`;
  }
  if (layer.kind === 'noise') {
    const options = [
      `color=${layer.color}`,
      `amplitude=${formatNumber(layer.gain)}`,
      `sample_rate=${SAMPLE_RATE}`,
      `duration=${formatNumber(layer.duration)}`,
      `seed=${stableSeed(key, index)}`,
    ].join(':');
    return `anoisesrc=${options}`;
  }
  throw new Error(`unsupported layer kind: ${layer.kind}`);
}

function layerFilters(layer) {
  const filters = [];
  if (layer.highpass) filters.push(`highpass=f=${formatNumber(layer.highpass)}`);
  if (layer.lowpass) filters.push(`lowpass=f=${formatNumber(layer.lowpass)}`);
  const fadeIn = Math.min(0.006, layer.duration / 4);
  const fadeOut = Math.min(0.08, layer.duration / 3);
  filters.push(`afade=t=in:st=0:d=${formatNumber(fadeIn)}`);
  filters.push(
    `afade=t=out:st=${formatNumber(layer.duration - fadeOut)}:d=${formatNumber(fadeOut)}`,
  );
  if (layer.start > 0) filters.push(`adelay=${Math.round(layer.start * 1000)}:all=1`);
  return filters.join(',');
}

export function validateUiSfxSpecs(specs = UI_SFX_SPECS) {
  const keys = new Set();
  for (const spec of specs) {
    if (!/^ui_[a-z0-9_]+$/.test(spec.key)) throw new Error(`invalid UI SFX key: ${spec.key}`);
    if (keys.has(spec.key)) throw new Error(`duplicate UI SFX key: ${spec.key}`);
    keys.add(spec.key);
    if (!(spec.duration >= 0.5 && spec.duration <= 30)) {
      throw new Error(`invalid duration for ${spec.key}: ${spec.duration}`);
    }
    if (!spec.layers.length) throw new Error(`UI SFX cue has no layers: ${spec.key}`);
    if (!Number.isFinite(spec.masterGainDb) || Math.abs(spec.masterGainDb) > 24) {
      throw new Error(`invalid mastering gain for ${spec.key}: ${spec.masterGainDb}`);
    }
    for (const layer of spec.layers) {
      if (layer.start < 0 || layer.duration <= 0 || layer.start + layer.duration > spec.duration) {
        throw new Error(`layer exceeds cue duration: ${spec.key}`);
      }
    }
  }
  return true;
}

export function ffmpegArgsForUiSfx(spec, outputPath) {
  validateUiSfxSpecs([spec]);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  for (const [index, layer] of spec.layers.entries()) {
    args.push('-f', 'lavfi', '-i', layerInput(spec.key, layer, index));
  }

  const graph = spec.layers.map((layer, index) => {
    return `[${index}:a]${layerFilters(layer)}[layer${index}]`;
  });
  const labels = spec.layers.map((_, index) => `[layer${index}]`).join('');
  if (spec.layers.length === 1) graph.push(`${labels}anull[mixed]`);
  else {
    graph.push(
      `${labels}amix=inputs=${spec.layers.length}:duration=longest:dropout_transition=0:normalize=0[mixed]`,
    );
  }
  graph.push(
    `[mixed]highpass=f=30,volume=${formatNumber(spec.masterGainDb)}dB,alimiter=limit=${MASTER_LIMIT}:attack=1:release=40:level=0:latency=1,apad=whole_dur=${formatNumber(spec.duration)},atrim=duration=${formatNumber(spec.duration)},aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=mono[out]`,
  );

  args.push(
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[out]',
    '-vn',
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    '1',
    '-c:a',
    'pcm_s24le',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-f',
    'wav',
    outputPath,
  );
  return args;
}

validateUiSfxSpecs();
