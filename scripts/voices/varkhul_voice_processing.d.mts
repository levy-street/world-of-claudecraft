export interface VarkhulVoiceProcessingPreset {
  id: string;
  mainPitchSemitones: number;
  stonePitchSemitones: number;
  furnacePitchSemitones: number;
  fracturePitchSemitones: number;
}

export declare const VARKHUL_VOICE_PROCESSING_PRESET: Readonly<VarkhulVoiceProcessingPreset>;
export declare function buildVarkhulVoiceFilter(): string;
