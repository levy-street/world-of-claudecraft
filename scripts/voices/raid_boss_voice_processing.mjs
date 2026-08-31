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
