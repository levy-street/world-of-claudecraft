export interface VoicePrompt {
  npcId: string;
  name: string;
  voiceDescription: string;
  sampleText: string;
}

export const VOICE_PROMPTS: VoicePrompt[];
export const VOICE_ALIAS: Record<string, string>;
export function voiceIdFor(npcId: string): string;
