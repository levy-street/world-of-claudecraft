export interface VarkhulVoicePackLine {
  key: string;
  text: string;
  synthesisText: string;
  processingPreset: 'stone-forge';
}

export const VARKHUL_VOICE_PACK_LINES: readonly VarkhulVoicePackLine[];

export interface VarkhulAlignmentWord {
  text: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export function normalizeVarkhulAlignmentWords(
  words: readonly VarkhulAlignmentWord[],
): VarkhulAlignmentWord[];

export function shouldUseVarkhulScribeFallback(status: number, detail: string): boolean;
export function validateVarkhulAlignment<T extends { words?: unknown }>(
  alignment: T,
): T & { words: VarkhulAlignmentWord[] };
