export interface ReactionOptions {
  minMs: number;
  maxMs: number;
  slipChance: number;
  slipMinMs: number;
  slipMaxMs: number;
}

export const REACTION_DEFAULTS: Readonly<ReactionOptions>;

export interface Reaction {
  opts: ReactionOptions;
  noticed(viewer: string, hazardId: number | string | null | undefined, now: number): boolean;
  prune(liveIds: Set<number | string>): void;
  slips(): number;
}

export function createReaction(roll: () => number, opts?: Partial<ReactionOptions>): Reaction;
