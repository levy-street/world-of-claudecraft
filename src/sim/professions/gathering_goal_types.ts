// Compact goal selection and owner-only projection. No inventory is persisted here.

export type GatheringGoalIdentity =
  | { readonly kind: 'recipe'; readonly recipeId: string; readonly count: number }
  | {
      readonly kind: 'commission';
      readonly recipeId: string;
      readonly orderId: number;
      readonly count: 1;
    };

export type GatheringGoalUnavailableReason =
  | 'invalid_goal'
  | 'unknown_recipe'
  | 'recipe_unavailable'
  | 'commission_unavailable'
  | 'daily_limit'
  | 'batch_limit';

export interface GatheringGoalMaterial {
  readonly itemId: string;
  readonly required: number;
  /** Physical units allocated toward this goal, including unusable locked units. */
  readonly carried: number;
  readonly stored: number;
  /** Spendable carried units plus currently drawable vault units. */
  readonly reachable: number;
  /** Requirement not covered by allocated owned units. */
  readonly missing: number;
  /** Allocated owned units not currently usable for this bill. */
  readonly inaccessible: number;
}

export interface GatheringGoalView {
  readonly goal: GatheringGoalIdentity | null;
  readonly status: 'collecting' | 'ready' | 'unavailable' | 'delivered' | 'cancelled' | 'expired';
  readonly reason: GatheringGoalUnavailableReason | null;
  readonly materials: readonly GatheringGoalMaterial[];
  readonly payableCrafts: number;
  readonly storageRestricted: boolean;
}
