const SAMPLE_RATE = 44100;

export const VARKHUL_FINALISTS = Object.freeze([
  Object.freeze({
    id: 'obsidian-forge-idol-candidate-2',
    source: '03-obsidian-forge-idol-candidate-2.mp3',
  }),
  Object.freeze({
    id: 'black-anvil-colossus-candidate-1',
    source: '01-black-anvil-colossus-candidate-1.mp3',
  }),
]);

export const VARKHUL_FINALIST_TREATMENTS = Object.freeze([
  Object.freeze({ id: 'original', label: 'Selected original' }),
  Object.freeze({ id: 'deeper', label: 'Deeper subharmonic body' }),
  Object.freeze({ id: 'stone-forge', label: 'Stronger stone and forge body' }),
]);

export const VARKHUL_PRODUCTION_TREATMENT = 'stone-forge';

function pitchFilters(semitones) {
  const ratio = 2 ** (semitones / 12);
  const rate = Math.round(SAMPLE_RATE * ratio);
  const tempo = (1 / ratio).toFixed(6);
  return `asetrate=${rate},aresample=${SAMPLE_RATE},atempo=${tempo}`;
}

function buildDeeperFilter() {
  return (
    `aresample=${SAMPLE_RATE},asplit=3[main_in][sub_in][furnace_in];` +
    `[main_in]${pitchFilters(-1.2)},` +
    'highpass=f=38,lowpass=f=6500,volume=0.78[main];' +
    `[sub_in]${pitchFilters(-6.8)},` +
    'highpass=f=32,lowpass=f=220,volume=0.34[sub];' +
    `[furnace_in]${pitchFilters(-3.2)},` +
    'highpass=f=50,lowpass=f=1250,tremolo=f=14:d=0.16,' +
    'aecho=0.8:0.15:43:0.09,volume=0.17[furnace];' +
    '[main][sub][furnace]' +
    'amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,' +
    'acompressor=threshold=0.1:ratio=2.8:attack=9:release=170:makeup=1.1,' +
    'alimiter=limit=0.88,loudnorm=I=-18:TP=-2:LRA=7[out]'
  );
}

function buildStoneForgeFilter() {
  return (
    `aresample=${SAMPLE_RATE},asplit=3[main_in][body_in][fracture_in];` +
    `[main_in]${pitchFilters(-0.4)},` +
    'highpass=f=42,lowpass=f=6200,volume=0.8[main];' +
    `[body_in]${pitchFilters(-4.2)},` +
    'highpass=f=48,lowpass=f=1250,tremolo=f=17:d=0.1,volume=0.22[body];' +
    `[fracture_in]${pitchFilters(0.7)},` +
    'highpass=f=280,lowpass=f=2500,tremolo=f=27:d=0.12,' +
    'aecho=0.8:0.18:13|29:0.1|0.05,volume=0.1[fracture];' +
    '[main][body][fracture]' +
    'amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,' +
    'acompressor=threshold=0.1:ratio=3:attack=7:release=145:makeup=1.12,' +
    'alimiter=limit=0.88,loudnorm=I=-18:TP=-2:LRA=7[out]'
  );
}

export function buildVarkhulFinalistFilter(treatmentId) {
  if (treatmentId === 'original') return null;
  if (treatmentId === 'deeper') return buildDeeperFilter();
  if (treatmentId === 'stone-forge') return buildStoneForgeFilter();
  throw new Error(`Unknown Varkhul finalist treatment: ${treatmentId}`);
}
