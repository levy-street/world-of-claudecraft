export interface IgnivarVoiceExtensionLine {
  outputName: string;
  key: string;
  text: string;
  processingPreset: string;
}

export declare const IGNIVAR_VOICE_EXTENSION_LINES: IgnivarVoiceExtensionLine[];
export declare const IGNIVAR_VOICE_EXTENSION_MASTER_TEXT: string;
export declare const IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT: string;
export type IgnivarVoiceExtensionModel = 'eleven_multilingual_v2' | 'eleven_v3';
export declare function resolveIgnivarVoiceExtensionModel(
  model?: string,
): IgnivarVoiceExtensionModel;
export declare function validateFinalizedIgnivarVoiceReceipt<T extends object>(
  receipt: T,
): T & { boss: 'ignivar'; voiceId: string };
export declare function validateIgnivarVoiceExtensionCache(
  hasRaw: boolean,
  hasAlignment: boolean,
): void;
export declare function decodeIgnivarVoiceExtensionSynthesis(generated: unknown): {
  audio: Buffer;
  alignment: object;
};
export declare function ignivarVoiceExtensionMasterText(model?: string): string;

import type { Buffer } from 'node:buffer';
