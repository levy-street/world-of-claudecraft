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
  {
    id: 'rime-lake',
    mainPitchSemitones: -0.8,
    bassPitchSemitones: -12,
    bassGain: 0.05,
    texture: {
      pitch: 5,
      highpass: 3000,
      lowpass: 10000,
      tremolo: [38, 0.7],
      echo: ['23|47', '0.2|0.1'],
      gain: 0.08,
    },
    choir: [],
    room: ['70|140', '0.22|0.12'],
  },
  {
    id: 'hearth-fire',
    mainPitchSemitones: -1.5,
    bassPitchSemitones: -9,
    bassGain: 0.26,
    texture: {
      pitch: -3,
      highpass: 90,
      lowpass: 1400,
      tremolo: [11, 0.4],
      echo: ['31', '0.15'],
      gain: 0.16,
    },
    choir: [],
    room: ['55|110', '0.2|0.1'],
  },
  {
    id: 'masterless-heart',
    mainPitchSemitones: -1.2,
    bassPitchSemitones: -12,
    bassGain: 0.26,
    texture: {
      pitch: 12,
      highpass: 2200,
      lowpass: 9000,
      tremolo: [5, 0.3],
      echo: ['90|180', '0.25|0.15'],
      gain: 0.06,
    },
    choir: [
      { pitch: -5, delayMs: 18, gain: 0.2 },
      { pitch: 4, delayMs: 27, gain: 0.1 },
      { pitch: -9, delayMs: 11, gain: 0.16 },
    ],
    room: ['110|220|330', '0.28|0.18|0.1'],
  },
];

/** The Smith's Heart's loudness: a touch over the raid's score. */
export const SMITH_HEART_VOICE_LOUDNESS = 'loudnorm=I=-15:TP=-1.5:LRA=7';

export function buildSmithHeartVoiceFilter(presetId) {
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
