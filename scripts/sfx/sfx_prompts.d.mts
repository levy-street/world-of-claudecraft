export interface SfxPromptEntry {
  key: string;
  prompt?: string;
  duration?: number;
  loop?: boolean;
  custom?: boolean;
  [key: string]: unknown;
}

export declare const SFX: SfxPromptEntry[];
export declare const MOB_VOICE_FAMILIES: string[];
