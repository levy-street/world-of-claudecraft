export interface IgnivarVoicePackLine {
  key: string;
  text: string;
  synthesisText: string;
  processingPreset: string;
}

export declare const IGNIVAR_VOICE_PACK_LINES: IgnivarVoicePackLine[];

export interface IgnivarVoiceReceipt {
  boss: string;
  lines: Array<{ key: string; text: string; start: number; end: number }>;
}

export declare function validateIgnivarProductionReceipt<
  T extends Pick<IgnivarVoicePackLine, 'key' | 'text' | 'processingPreset'>,
>(
  authoredLines: readonly T[],
  receipt: IgnivarVoiceReceipt,
  label: string,
): Array<T & { start: number; end: number }>;
