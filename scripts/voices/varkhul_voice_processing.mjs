const SAMPLE_RATE = 44100;

export const VARKHUL_VOICE_PROCESSING_PRESET = Object.freeze({
  id: 'black-anvil-colossus',
  mainPitchSemitones: -2.8,
  stonePitchSemitones: -9,
  furnacePitchSemitones: -4.5,
  fracturePitchSemitones: -0.6,
});

function pitchFilters(semitones) {
  const ratio = 2 ** (semitones / 12);
  const rate = Math.round(SAMPLE_RATE * ratio);
  const tempo = (1 / ratio).toFixed(6);
  return `asetrate=${rate},aresample=${SAMPLE_RATE},atempo=${tempo}`;
}

export function buildVarkhulVoiceFilter() {
  const preset = VARKHUL_VOICE_PROCESSING_PRESET;
  return (
    `aresample=${SAMPLE_RATE},asplit=4[main_in][stone_in][furnace_in][fracture_in];` +
    `[main_in]${pitchFilters(preset.mainPitchSemitones)},` +
    'highpass=f=42,lowpass=f=7600,volume=0.84[main];' +
    `[stone_in]${pitchFilters(preset.stonePitchSemitones)},` +
    'highpass=f=35,lowpass=f=270,volume=0.24[stone];' +
    `[furnace_in]${pitchFilters(preset.furnacePitchSemitones)},` +
    'highpass=f=58,lowpass=f=1700,tremolo=f=19:d=0.2,' +
    'aecho=0.8:0.2:29:0.11,volume=0.16[furnace];' +
    `[fracture_in]${pitchFilters(preset.fracturePitchSemitones)},` +
    'highpass=f=230,lowpass=f=3300,tremolo=f=31:d=0.11,' +
    'aecho=0.8:0.2:11|23:0.1|0.05,volume=0.09[fracture];' +
    '[main][stone][furnace][fracture]' +
    'amix=inputs=4:duration=longest:dropout_transition=0:normalize=0,' +
    'acompressor=threshold=0.1:ratio=3.2:attack=8:release=150:makeup=1.15,' +
    'alimiter=limit=0.88,loudnorm=I=-18:TP=-2:LRA=7[out]'
  );
}
