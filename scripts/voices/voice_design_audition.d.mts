import type { RaidBossVoicePrompt } from './raid_boss_voice_prompts.mjs';

export interface VoiceDesignPreview {
  candidate: number;
  generatedVoiceId: string;
  audioBase64: string;
}

export interface VoiceDesignMetadata {
  boss: string;
  take: string;
  candidates: Array<{ candidate: number; generatedVoiceId: string }>;
}

export declare const VOICE_DESIGN_MODEL: string;
export declare function auditionRelativeDir(prompt: {
  npcId: string;
  takeId: string;
}): [string, string];
export declare function seedForVoiceDesign(id: string): number;
export declare function buildVoiceDesignRequest(prompt: RaidBossVoicePrompt): {
  voice_description: string;
  text: string;
  model_id: string;
  seed: number;
  guidance_scale: number;
};
export declare function normalizeVoiceDesignPreviews(response: unknown): VoiceDesignPreview[];
export declare function buildVoiceFinalizationRequest(
  prompt: RaidBossVoicePrompt | undefined,
  metadata: VoiceDesignMetadata,
  candidateNumber: number,
): {
  voice_name: string;
  voice_description: string;
  generated_voice_id: string;
};
export declare function voiceIdFromFinalizationResponse(response: unknown): string;
