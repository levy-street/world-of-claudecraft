import { yellKey } from './extra_lines.mjs';
import { IGNIVAR_PRODUCTION_VOICE_PRESET } from './ignivar_robotic_voice_processing.mjs';

function line(text, synthesisText, processingPreset) {
  return { key: yellKey(text), text, synthesisText, processingPreset };
}

export const IGNIVAR_VOICE_PACK_LINES = [
  line(
    'Ignivar Ashcaller awakens. Let the world burn!',
    '[shouts] Ignivar Ashcaller awakens. Let the world burn!',
    IGNIVAR_PRODUCTION_VOICE_PRESET,
  ),
  line(
    'The sky itself will burn!',
    '[shouts] The sky itself will burn!',
    IGNIVAR_PRODUCTION_VOICE_PRESET,
  ),
  line(
    'The last flame consumes all!',
    '[angry] The last flame consumes all!',
    IGNIVAR_PRODUCTION_VOICE_PRESET,
  ),
  line(
    'Varkhul... the seal is broken.',
    '[sad] Varkhul... the seal is broken.',
    IGNIVAR_PRODUCTION_VOICE_PRESET,
  ),
];

export function validateIgnivarProductionReceipt(authoredLines, receipt, label) {
  if (receipt.boss !== 'ignivar' || !Array.isArray(receipt.lines)) {
    throw new Error(`${label} is not an Ignivar line receipt`);
  }
  if (receipt.lines.length !== authoredLines.length) {
    throw new Error(`${label} must contain exactly ${authoredLines.length} lines`);
  }
  return authoredLines.map((line, index) => {
    const bounds = receipt.lines[index];
    if (bounds.key !== line.key || bounds.text !== line.text) {
      throw new Error(`${label} line ${index + 1} does not match the authored voice pack`);
    }
    if (!(bounds.start >= 0) || !(bounds.end > bounds.start)) {
      throw new Error(`${label} line ${index + 1} has invalid clip bounds`);
    }
    if (line.processingPreset !== IGNIVAR_PRODUCTION_VOICE_PRESET) {
      throw new Error(`${line.key} does not use ${IGNIVAR_PRODUCTION_VOICE_PRESET}`);
    }
    return { ...line, start: bounds.start, end: bounds.end };
  });
}
