// Ignivar-only post-processing that keeps the selected actor performance as
// the dominant signal while adding deterministic forged-metal motion around it.

const SAMPLE_RATE = 44100;

export const IGNIVAR_PRODUCTION_VOICE_PRESET = 'robotic-automaton';

export const IGNIVAR_ROBOTIC_VOICE_PRESETS = [
  {
    id: 'robotic-moderate',
    mainPitchSemitones: -1.7,
    mainGain: 0.91,
    bassPitchSemitones: -6.2,
    bassGain: 0.13,
    metalGain: 0.11,
    metalTremoloFrequency: 31,
    metalTremoloDepth: 0.32,
    servoPitchSemitones: -3.4,
    servoGain: 0.045,
    servoTremoloFrequency: 47,
    servoTremoloDepth: 0.74,
    presenceGainDb: 2.4,
  },
  {
    id: 'robotic-automaton',
    mainPitchSemitones: -2.1,
    mainGain: 0.86,
    bassPitchSemitones: -7.4,
    bassGain: 0.18,
    metalGain: 0.17,
    metalTremoloFrequency: 34,
    metalTremoloDepth: 0.52,
    servoPitchSemitones: -4.2,
    servoGain: 0.085,
    servoTremoloFrequency: 53,
    servoTremoloDepth: 0.9,
    presenceGainDb: 3.6,
  },
];

function pitchFilters(semitones) {
  const ratio = 2 ** (semitones / 12);
  const rate = Math.round(SAMPLE_RATE * ratio);
  const tempo = (1 / ratio).toFixed(6);
  return `asetrate=${rate},aresample=${SAMPLE_RATE},atempo=${tempo}`;
}

export function buildIgnivarRoboticVoiceFilter(presetId) {
  const preset = IGNIVAR_ROBOTIC_VOICE_PRESETS.find(({ id }) => id === presetId);
  if (!preset) throw new Error(`Unknown Ignivar robotic voice preset: ${presetId}`);

  return (
    `aresample=${SAMPLE_RATE},asplit=4[main_in][bass_in][metal_in][servo_in];` +
    `[main_in]${pitchFilters(preset.mainPitchSemitones)},` +
    'highpass=f=45,lowpass=f=8800,' +
    `equalizer=f=720:t=q:w=1.1:g=${preset.presenceGainDb},` +
    `equalizer=f=1480:t=q:w=1.4:g=${(preset.presenceGainDb * 0.55).toFixed(2)},` +
    `volume=${preset.mainGain}[main];` +
    `[bass_in]${pitchFilters(preset.bassPitchSemitones)},` +
    `lowpass=f=210,volume=${preset.bassGain}[bass];` +
    `[metal_in]${pitchFilters(preset.mainPitchSemitones / 2)},` +
    'highpass=f=190,lowpass=f=3500,' +
    `tremolo=f=${preset.metalTremoloFrequency}:d=${preset.metalTremoloDepth},` +
    `aecho=0.8:0.2:13|29:0.1|0.05,volume=${preset.metalGain}[metal];` +
    `[servo_in]${pitchFilters(preset.servoPitchSemitones)},` +
    'highpass=f=280,lowpass=f=2800,' +
    `tremolo=f=${preset.servoTremoloFrequency}:d=${preset.servoTremoloDepth},` +
    `aecho=0.8:0.22:7|19|37:0.11|0.06|0.03,volume=${preset.servoGain}[servo];` +
    '[main][bass][metal][servo]amix=inputs=4:duration=longest:dropout_transition=0:normalize=0,' +
    'acompressor=threshold=0.12:ratio=2.8:attack=8:release=130:makeup=1.16,' +
    'alimiter=limit=0.88,loudnorm=I=-18:TP=-2:LRA=7[out]'
  );
}
