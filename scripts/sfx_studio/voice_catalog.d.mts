export interface VoiceSpeaker {
  speaker: string;
  label: string;
  prefix?: string;
}
export interface VoiceLine {
  id: string;
  speaker: string;
  speakerLabel: string;
  title: string;
  url: string;
  bytes: number;
  groups: string[];
}
export interface VoiceGroup {
  id: string;
  label: string;
  count: number;
}
export declare const VOICE_SPEAKERS: readonly VoiceSpeaker[];
export declare const VOICE_FILE_PATTERN: RegExp;
export declare function isVoiceSpeaker(speaker: string): boolean;
export declare function isVoiceFile(speaker: string, file: string): boolean;
export declare function voiceLineTitle(fileName: string): string;
export declare function collectVoiceCatalog(voiceRoot: string): {
  groups: VoiceGroup[];
  lines: VoiceLine[];
};
export declare function voiceLineInGroup(line: VoiceLine, groupId: string): boolean;
