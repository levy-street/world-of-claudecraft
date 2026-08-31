export interface AlignedWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

export interface ClipBounds {
  start: number;
  end: number;
}

export declare function shouldUseScribeFallback(status: number, detail: string): boolean;
export declare function validateWordAlignment<T extends { words?: unknown }>(
  alignment: T,
  label: string,
): T & { words: AlignedWord[] };
export declare function validateCharacterAlignment<T extends object>(
  alignment: T,
  label?: string,
): T & CharacterAlignment;

export declare function phraseClipBounds(
  words: AlignedWord[],
  phrase: string,
  padding?: { lead?: number; tail?: number; aliases?: Record<string, string[]> },
): ClipBounds;

export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export declare function phraseCharacterClipBounds(
  alignment: CharacterAlignment,
  phrase: string,
  padding?: { lead?: number; tail?: number },
): ClipBounds;
