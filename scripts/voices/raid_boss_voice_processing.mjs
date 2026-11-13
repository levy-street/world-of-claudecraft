const SAMPLE_RATE = 44100;

export const RAID_BOSS_VOICE_PROCESSING_PRESETS = [
  {
    id: 'living-construct',
    mainPitchSemitones: -0.8,
    bassPitchSemitones: -4.8,
    bassGain: 0.07,
    metalGain: 0.05,
    tremoloDepth: 0.08,
  },
  {
    id: 'ancient-herald',
    mainPitchSemitones: -1.6,
    bassPitchSemitones: -6,
    bassGain: 0.12,
    metalGain: 0.09,
    tremoloDepth: 0.16,
  },
  {
    id: 'forge-automaton',
    mainPitchSemitones: -2.4,
    bassPitchSemitones: -7,
    bassGain: 0.18,
    metalGain: 0.14,
    tremoloDepth: 0.28,
  },
];

function pitchFilters(semitones) {
  const ratio = 2 ** (semitones / 12);
  const rate = Math.round(SAMPLE_RATE * ratio);
  const tempo = (1 / ratio).toFixed(6);
  return `asetrate=${rate},aresample=${SAMPLE_RATE},atempo=${tempo}`;
}

export function buildRaidBossVoiceFilter(presetId) {
  const preset = RAID_BOSS_VOICE_PROCESSING_PRESETS.find(({ id }) => id === presetId);
  if (!preset) throw new Error(`Unknown voice processing preset: ${presetId}`);

  return (
    `aresample=${SAMPLE_RATE},asplit=3[main_in][bass_in][metal_in];` +
    `[main_in]${pitchFilters(preset.mainPitchSemitones)},` +
    'highpass=f=45,lowpass=f=9000,volume=0.94[main];' +
    `[bass_in]${pitchFilters(preset.bassPitchSemitones)},` +
    `lowpass=f=190,volume=${preset.bassGain}[bass];` +
    `[metal_in]${pitchFilters(preset.mainPitchSemitones / 2)},` +
    'highpass=f=180,lowpass=f=3200,' +
    `tremolo=f=28:d=${preset.tremoloDepth},` +
    `aecho=0.8:0.2:17|31:0.12|0.06,volume=${preset.metalGain}[metal];` +
    '[main][bass][metal]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,' +
    'acompressor=threshold=0.125:ratio=2.5:attack=10:release=120:makeup=1.2,' +
    'alimiter=limit=0.9,loudnorm=I=-18:TP=-2:LRA=7[out]'
  );
}

// The Smith's Heart's elemental treatments: the same three layers (the actor
// performance on top, a sub-octave bass, a texture voice), each texture tuned
// to its vein (quarry grind, crystal shimmer, gust, frost crackle, flame
// flutter), an optional choir of detuned copies (the Masterless Strength's
// four veins in one voice) and the room it is heard in. Mastered louder than
// the three above (-15 LUFS) so a boss line sits over the raid's -14 LUFS
// score as the client plays it (src/ui/voice_events.ts voicedYellGain).

export const SMITH_HEART_VOICE_PROCESSING_PRESETS = [
  {
    id: 'quarry-stone',
    mainPitchSemitones: -1.8,
    bassPitchSemitones: -8,
    bassGain: 0.22,
    texture: {
      pitch: -0.9,
      highpass: 150,
      lowpass: 2600,
      tremolo: [24, 0.45],
      echo: ['19|37', '0.18|0.1'],
      gain: 0.12,
    },
    choir: [],
    room: ['45|90', '0.18|0.1'],
  },
  {
    id: 'seam-crystal',
    mainPitchSemitones: -0.4,
    bassPitchSemitones: -12,
    bassGain: 0.03,
    texture: {
      pitch: 12,
      highpass: 2500,
      lowpass: 9000,
      tremolo: [6, 0.25],
      echo: ['80|160', '0.22|0.14'],
      gain: 0.05,
    },
    choir: [],
    room: ['120|240|360', '0.2|0.13|0.07'],
  },
  {
    id: 'summit-gale',
    mainPitchSemitones: -1,
    bassPitchSemitones: -7,
    bassGain: 0.12,
    texture: {
      pitch: -2,
      highpass: 1200,
      lowpass: 7000,
      tremolo: [4, 0.5],
      echo: ['60|130', '0.25|0.15'],
      gain: 0.14,
    },
    choir: [],
    room: ['150|300', '0.24|0.14'],
  },
];

/** The Smith's Heart's loudness: a touch over the raid's score. */
export const SMITH_HEART_VOICE_LOUDNESS = 'loudnorm=I=-15:TP=-1.5:LRA=7';

// The Smith's Heart's CLEAN treatments (chosen 2026-11-09): for a voice
// designed to sound like its boss already (the Guardians of the Heat and the
// Quench, the Masterless Strength), the take is kept as performed. Only a
// light high-pass, gentle compression, a soft sub an octave down at a very
// low level and a short, low-wet early-reflection room (wet only, so the dry
// voice is never doubled), then the pack's loudness. No vocoder, ring
// modulation, noise carrier, tremolo or pitch shift of the voice itself.

export const SMITH_HEART_CLEAN_VOICE_PRESETS = [
  {
    id: 'rime-queen-clean',
    highpass: 85,
    compressor: { threshold: 0.18, ratio: 2, attack: 12, release: 150 },
    sub: { gain: 0.02, lowpass: 130 },
    room: { delays: '23|37|53|71', decays: '0.45|0.35|0.25|0.15', wet: 0.08 },
  },

  {
    id: 'hearth-fire-clean',
    highpass: 70,
    compressor: { threshold: 0.16, ratio: 2.2, attack: 10, release: 140 },
    sub: { gain: 0.06, lowpass: 150 },
    room: { delays: '29|47|67|89|117|149', decays: '0.5|0.42|0.33|0.25|0.18|0.11', wet: 0.13 },
  },
  {
    id: 'masterless-clean',
    highpass: 65,
    compressor: { threshold: 0.16, ratio: 2.2, attack: 10, release: 150 },
    sub: { gain: 0.07, lowpass: 140 },
    room: { delays: '41|61|89|127|163|211', decays: '0.5|0.43|0.35|0.27|0.2|0.13', wet: 0.18 },
  },
];

function buildSmithHeartCleanPresetFilter(preset) {
  const c = preset.compressor;
  const r = preset.room;
  return (
    `aresample=${SAMPLE_RATE},highpass=f=${preset.highpass},` +
    `acompressor=threshold=${c.threshold}:ratio=${c.ratio}:attack=${c.attack}:release=${c.release}:makeup=1,` +
    'asplit=3[dry][sub_in][room_in];' +
    `[sub_in]${pitchFilters(-12)},lowpass=f=${preset.sub.lowpass},volume=${preset.sub.gain}[sub];` +
    `[room_in]aecho=0:1:${r.delays}:${r.decays},highpass=f=180,lowpass=f=5500,volume=${r.wet}[room];` +
    '[dry][sub][room]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,' +
    // Pin the mix's format: left to negotiation, the sub's rate-shifted
    // branch makes loudnorm's 192 kHz output come out labelled 44.1 kHz
    // (a clip four times too long and slowed down).
    `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=mono,` +
    `alimiter=limit=0.89,${SMITH_HEART_VOICE_LOUDNESS}[out]`
  );
}

export function buildSmithHeartVoiceFilter(presetId) {
  const clean = SMITH_HEART_CLEAN_VOICE_PRESETS.find(({ id }) => id === presetId);
  if (clean) return buildSmithHeartCleanPresetFilter(clean);
  const preset = SMITH_HEART_VOICE_PROCESSING_PRESETS.find(({ id }) => id === presetId);
  if (!preset) throw new Error(`Unknown voice processing preset: ${presetId}`);
  const tex = preset.texture;
  const choir = preset.choir;
  const inputs = 3 + choir.length;
  const choirIns = choir.map((_, i) => `[c${i}_in]`).join('');
  const choirOuts = choir.map((_, i) => `[c${i}]`).join('');
  const choirGraph = choir
    .map(
      (c, i) =>
        `[c${i}_in]${pitchFilters(c.pitch)},adelay=delays=${c.delayMs}:all=1,` +
        `highpass=f=80,lowpass=f=6000,volume=${c.gain}[c${i}];`,
    )
    .join('');
  return (
    `aresample=${SAMPLE_RATE},asplit=${inputs}[main_in][bass_in][tex_in]${choirIns};` +
    `[main_in]${pitchFilters(preset.mainPitchSemitones)},` +
    'highpass=f=70,lowpass=f=9500,volume=0.92[main];' +
    `[bass_in]${pitchFilters(preset.bassPitchSemitones)},` +
    `lowpass=f=220,volume=${preset.bassGain}[bass];` +
    `[tex_in]${pitchFilters(tex.pitch)},` +
    `highpass=f=${tex.highpass},lowpass=f=${tex.lowpass},` +
    `tremolo=f=${tex.tremolo[0]}:d=${tex.tremolo[1]},` +
    `aecho=0.8:0.3:${tex.echo[0]}:${tex.echo[1]},volume=${tex.gain}[tex];` +
    choirGraph +
    `[main][bass][tex]${choirOuts}amix=inputs=${inputs}:duration=longest:dropout_transition=0:normalize=0,` +
    `aecho=0.85:0.9:${preset.room[0]}:${preset.room[1]},highpass=f=55,` +
    'acompressor=threshold=0.12:ratio=3:attack=8:release=140:makeup=1.2,' +
    `alimiter=limit=0.89,${SMITH_HEART_VOICE_LOUDNESS}[out]`
  );
}

/** A human ally's clean line (Captain Thessaly on the Cornice): no treatment,
 *  only the raid voices' level. */
export const SMITH_HEART_CLEAN_VOICE_FILTER =
  `aresample=${SAMPLE_RATE},highpass=f=70,` +
  'acompressor=threshold=0.12:ratio=2.5:attack=10:release=120:makeup=1.1,' +
  `alimiter=limit=0.89,${SMITH_HEART_VOICE_LOUDNESS}[out]`;
