export declare const MELEE_REACH: number;
export declare const DEAD_ZONE_MARGIN: number;
export declare function engagementDistance(
  abilityDefs: Array<{ minRange?: number; range?: number }> | null | undefined,
  rangedProfile: { maxRange?: number } | null | undefined,
): number;
export declare const DAMAGE_EFFECTS: Set<string>;
export declare const STATION_DEAD_BAND: number;
export declare function station(
  mover: { pos: { x: number; z: number }; castingAbility?: unknown },
  target: { pos: { x: number; z: number } },
  reach: number,
  speed: number,
  ticksPerSecond: number,
): void;
export declare function attributeSweepDamage(
  sourceId: number,
  pid: number,
  source: { kind?: string; ownerId?: number | null } | null | undefined,
): 'player' | 'pet' | null;
