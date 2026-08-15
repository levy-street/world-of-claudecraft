export interface ExtraLine {
  key: string;
  voiceNpc: string;
  text: string;
}

export function yellKey(text: string): string;
export const EXTRA_LINES: ExtraLine[];
