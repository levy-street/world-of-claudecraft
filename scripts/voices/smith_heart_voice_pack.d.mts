export interface SmithHeartSpeaker {
  audition: { boss: string; take: string; candidate: number } | null;
  preset: string | null;
}

export interface SmithHeartPackLine {
  id: string;
  key: string;
  voiceNpc: string;
  text: string;
  synthesisText: string;
  preset: string | null;
}

export declare const SMITH_HEART_SPEAKERS: Record<string, SmithHeartSpeaker>;
export declare const SMITH_HEART_TTS_MODEL: string;
export declare const SMITH_HEART_DIRECTIONS: Record<string, string>;
export declare function packLine(line: {
  voiceNpc: string;
  id: string;
  text: string;
}): SmithHeartPackLine;
export declare function reviewName(line: { id: string }): string;
