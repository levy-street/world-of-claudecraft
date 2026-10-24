export interface HighwatchGuildTier {
  suffix: string;
  color: number;
  normal: number;
}

export interface HighwatchGuildAssetSpec {
  source: string;
  target: string;
  collision: string;
  collisionId: string;
  tiers: Record<string, HighwatchGuildTier>;
  inputs: string[];
  requiredNodes: string[];
  materials: string[];
  painted: string[];
}

export const GUILD_TROPHY_DUNGEONS: readonly string[];
export const HIGHWATCH_GUILD_ASSET: HighwatchGuildAssetSpec;
export const VERTEX_COLOUR_SCALE: number;
export const UV_STEPS_PER_REPEAT: number;
export function tierTarget(tier: string, asset?: HighwatchGuildAssetSpec): string;
export function guildSourceFingerprint(asset?: HighwatchGuildAssetSpec, root?: string): string;
export function buildHighwatchGuild(
  tier?: string,
  asset?: HighwatchGuildAssetSpec,
  root?: string,
): Promise<Uint8Array>;
export function mergeGuildCollision(raw: string, rows: unknown, id?: string): string;
