export declare const MELEE_REACH: number;
export declare const DEAD_ZONE_MARGIN: number;
export declare function engagementDistance(
  abilityDefs: Array<{ minRange?: number; range?: number }> | null | undefined,
  rangedProfile: { maxRange?: number } | null | undefined,
): number;
