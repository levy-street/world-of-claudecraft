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

export interface SmithHeartVoiceProcessingPreset {
  id: string;
  mainPitchSemitones: number;
  bassPitchSemitones: number;
  bassGain: number;
  texture: {
    pitch: number;
    highpass: number;
    lowpass: number;
    tremolo: [number, number];
    echo: [string, string];
    gain: number;
  };
  choir: { pitch: number; delayMs: number; gain: number }[];
  room: [string, string];
}

export declare const SMITH_HEART_VOICE_PROCESSING_PRESETS: SmithHeartVoiceProcessingPreset[];
export declare const SMITH_HEART_VOICE_LOUDNESS: string;
export declare function buildSmithHeartVoiceFilter(presetId: string): string;
export declare const SMITH_HEART_CLEAN_VOICE_FILTER: string;
