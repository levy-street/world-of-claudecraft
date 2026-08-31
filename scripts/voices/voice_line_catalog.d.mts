export interface VoiceLineCatalogEntry {
  key: string;
  text: string;
  voiceNpc: string;
  source: string;
}

export interface VoiceLineCatalogContent {
  NPCS: Record<string, { id: string; greeting?: string }>;
  QUESTS: Record<
    string,
    {
      id: string;
      text?: string;
      completionText?: string;
      giverNpcId: string;
      turnInNpcId: string;
    }
  >;
  ESCORTS?: Record<
    string,
    {
      id: string;
      npcMobId: string;
      startText?: string;
      successText?: string;
      failText?: string;
    }
  >;
  IGNIVAR_DIALOGUE_LINES: readonly string[];
  VARKHUL_DIALOGUE_LINES: readonly string[];
}

export function collectVoiceLines(content: VoiceLineCatalogContent): VoiceLineCatalogEntry[];
