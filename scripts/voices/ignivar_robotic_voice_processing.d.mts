export interface IgnivarRoboticVoiceProcessingPreset {
  id: string;
  mainPitchSemitones: number;
  mainGain: number;
  bassPitchSemitones: number;
  bassGain: number;
  metalGain: number;
  metalTremoloFrequency: number;
  metalTremoloDepth: number;
  servoPitchSemitones: number;
  servoGain: number;
  servoTremoloFrequency: number;
  servoTremoloDepth: number;
  presenceGainDb: number;
}

export declare const IGNIVAR_PRODUCTION_VOICE_PRESET: 'robotic-automaton';
export declare const IGNIVAR_ROBOTIC_VOICE_PRESETS: IgnivarRoboticVoiceProcessingPreset[];
export declare function buildIgnivarRoboticVoiceFilter(presetId: string): string;
