export interface RaidBossVoicePrompt {
  npcId: string;
  takeId: string;
  name: string;
  voiceDescription: string;
  previewText: string;
  visualReferences: string[];
  guidanceScale?: number;
}

export declare const RAID_BOSS_VOICE_PROMPTS: RaidBossVoicePrompt[];
