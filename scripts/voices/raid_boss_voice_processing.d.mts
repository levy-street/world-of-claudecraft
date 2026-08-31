export interface RaidBossVoiceProcessingPreset {
  id: string;
  mainPitchSemitones: number;
  bassPitchSemitones: number;
  bassGain: number;
  metalGain: number;
  tremoloDepth: number;
}

export declare const RAID_BOSS_VOICE_PROCESSING_PRESETS: RaidBossVoiceProcessingPreset[];
export declare function buildRaidBossVoiceFilter(presetId: string): string;
