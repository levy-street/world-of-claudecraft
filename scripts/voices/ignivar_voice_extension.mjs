import { Buffer } from 'node:buffer';
import { yellKey } from './extra_lines.mjs';
import { IGNIVAR_PRODUCTION_VOICE_PRESET } from './ignivar_robotic_voice_processing.mjs';
import { validateCharacterAlignment } from './voice_clip_extraction.mjs';

function line(outputName, text) {
  return {
    outputName,
    key: yellKey(text),
    text,
    processingPreset: IGNIVAR_PRODUCTION_VOICE_PRESET,
  };
}

export const IGNIVAR_VOICE_EXTENSION_LINES = [
  line('01-last-flame-judgment', 'Bear the Last Flame. Let it judge you.'),
  line('02-wells-answer', 'The old wells answer to my fire.'),
  line('03-turn-with-the-flame', 'Turn with the flame, or be unmade.'),
  line('04-varkhul-forged-me', 'Varkhul forged me to endure.'),
  line('05-another-spark', 'Another spark, extinguished.'),
  line('06-forge-rejects-you', 'The forge rejects you.'),
  line('07-seal-will-not-break', 'I am the seal. I will not break.'),
];

const SUPPORTED_MODELS = ['eleven_multilingual_v2', 'eleven_v3'];

export function resolveIgnivarVoiceExtensionModel(model = 'eleven_multilingual_v2') {
  if (!SUPPORTED_MODELS.includes(model))
    throw new Error(`Unsupported Ignivar voice model: ${model}`);
  return model;
}

export function validateFinalizedIgnivarVoiceReceipt(receipt) {
  if (receipt?.boss !== 'ignivar' || typeof receipt.voiceId !== 'string' || !receipt.voiceId) {
    throw new Error('Receipt does not contain a finalized Ignivar voice');
  }
  return receipt;
}

export function validateIgnivarVoiceExtensionCache(hasRaw, hasAlignment) {
  if (hasRaw !== hasAlignment) {
    throw new Error(
      'Incomplete cached synthesis: raw audio and alignment must both exist or both be absent',
    );
  }
}

export function decodeIgnivarVoiceExtensionSynthesis(generated) {
  if (
    typeof generated?.audio_base64 !== 'string' ||
    generated.audio_base64.length === 0 ||
    !generated.alignment ||
    typeof generated.alignment !== 'object'
  ) {
    throw new Error('Voice synthesis returned no audio or character alignment');
  }
  const alignment = validateCharacterAlignment(generated.alignment, 'Voice synthesis alignment');
  const audio = Buffer.from(generated.audio_base64, 'base64');
  if (audio.length === 0) throw new Error('Voice synthesis returned empty audio');
  return { audio, alignment };
}

// The approved aggro and death lines are performance anchors only. Generating
// one continuous passage keeps the new barks inside the same restrained arc.
export const IGNIVAR_VOICE_EXTENSION_MASTER_TEXT = [
  'Ignivar Ashcaller awakens. Let the world burn!',
  'Varkhul forged me to endure.',
  'Bear the Last Flame. Let it judge you.',
  'The old wells answer to my fire.',
  'Turn with the flame, or be unmade.',
  'I am the seal. I will not break.',
  'Another spark, extinguished.',
  'The forge rejects you.',
  'Varkhul... the seal is broken.',
].join(' ');

export const IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT = [
  'Ignivar Ashcaller awakens. Let the world burn!',
  'The sky itself will burn!',
  'Varkhul forged me to endure.',
  'Bear the Last Flame. Let it judge you.',
  'The old wells answer to my fire.',
  'Turn with the flame, or be unmade.',
  'I am the seal. I will not break.',
  'Another spark, extinguished.',
  'The forge rejects you.',
  'The last flame consumes all!',
  'Varkhul... the seal is broken.',
].join(' ');

export function ignivarVoiceExtensionMasterText(model) {
  return resolveIgnivarVoiceExtensionModel(model) === 'eleven_v3'
    ? IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT
    : IGNIVAR_VOICE_EXTENSION_MASTER_TEXT;
}
