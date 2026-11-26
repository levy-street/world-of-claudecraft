export interface CueGroup {
  id: string;
  label: string;
  matches(key: string): boolean;
}
export interface CueGroupSummary {
  id: string;
  label: string;
  count: number;
}
export declare const SMITH_HEART_SHARED_CUES: readonly string[];
export declare const PING_CUES: readonly string[];
export declare const CUE_GROUPS: readonly CueGroup[];
export declare function cueGroupsFor(key: string): string[];
export declare function cueGroupSummary(keys: string[]): CueGroupSummary[];
