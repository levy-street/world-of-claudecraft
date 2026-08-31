import { yellKey } from './extra_lines.mjs';
import { VARKHUL_PRODUCTION_TREATMENT } from './varkhul_voice_finalists.mjs';
import { shouldUseScribeFallback, validateWordAlignment } from './voice_clip_extraction.mjs';

function line(text, synthesisText) {
  return {
    key: yellKey(text),
    text,
    synthesisText,
    processingPreset: VARKHUL_PRODUCTION_TREATMENT,
  };
}

export const VARKHUL_VOICE_PACK_LINES = [
  line(
    'The spring did not die. I bound its last memory into iron.',
    '[a deep stone rumble] The spring did not die. I bound its last memory into iron.',
  ),
  line(
    'You call it a prison because your flesh fears endurance.',
    '[grinding anger] You call it a prison because your flesh fears endurance.',
  ),
  line(
    'I am Varkhul, Forgefather of the Last Flame. Raise your weapons, little sparks.',
    '[booming] I am Varkhul, Forgefather of the Last Flame. Raise your weapons, little sparks.',
  ),
  line(
    'Every blow will feed the furnace in my chest. By ember, stone, and anvil, I will unmake you.',
    '[a subterranean roar] Every blow will feed the furnace in my chest. By ember, stone, and anvil, I will unmake you.',
  ),
  line('Master... I have failed you.', '[fading into a low rumble] Master... I have failed you.'),
];

function normalizedToken(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeVarkhulAlignmentWords(words) {
  const spoken = words.filter(({ text }) => normalizedToken(text));
  const normalized = [];
  for (let index = 0; index < spoken.length; index++) {
    const current = spoken[index];
    const next = spoken[index + 1];
    if (
      normalizedToken(current.text) === 'forge' &&
      next &&
      normalizedToken(next.text) === 'father'
    ) {
      normalized.push({ ...current, text: 'Forgefather', end: next.end });
      index += 1;
      continue;
    }
    normalized.push(current);
  }
  return normalized;
}

export function shouldUseVarkhulScribeFallback(status, detail) {
  return shouldUseScribeFallback(status, detail);
}

export function validateVarkhulAlignment(alignment) {
  return validateWordAlignment(alignment, 'Varkhul alignment');
}
