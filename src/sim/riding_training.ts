// Character riding progression, shared by movement, persistence, and vendor previews.
export type RidingTier = 0 | 1 | 2;
export const BASIC_RIDING_FEE_COPPER = 800_000;
export const ADVANCED_RIDING_FEE_COPPER = 10_000_000;

export function ridingTrainingTier(
  state:
    | {
        ridingTier?: number;
        ridingTrained?: boolean;
      }
    | undefined,
): RidingTier {
  if (state?.ridingTier === 2) return 2;
  return state?.ridingTier === 1 || state?.ridingTrained === true ? 1 : 0;
}

export function ridingTrainingFee(tier: RidingTier): number {
  return tier === 0 ? BASIC_RIDING_FEE_COPPER : tier === 1 ? ADVANCED_RIDING_FEE_COPPER : 0;
}

// An untrained lesson participant uses the basic lesson horse's speed.
export function ridingMoveSpeedPct(tier: number): number {
  return tier === 2 ? 1.1 : 0.7;
}

export function restoreRidingTraining(
  meta: {
    ridingTier?: 1 | 2;
    ridingTrained?: boolean;
    mountTrainingFeePaid?: boolean;
    questLog: ReadonlyMap<string, unknown>;
    questsDone: ReadonlySet<string>;
  },
  saved: { ridingTier?: number; ridingTrained?: boolean; mountTrainingFeePaid?: boolean },
): RidingTier {
  if (saved.mountTrainingFeePaid === true) meta.mountTrainingFeePaid = true;
  // Old fee payments and accepted/completed lessons prove that basic training was purchased.
  if (
    saved.ridingTrained === true ||
    saved.mountTrainingFeePaid === true ||
    meta.questLog.has('q_riding_lessons') ||
    meta.questsDone.has('q_riding_lessons')
  )
    meta.ridingTrained = true;
  if (saved.ridingTier === 1 || saved.ridingTier === 2) {
    meta.ridingTier = saved.ridingTier;
    meta.ridingTrained = true;
  }
  return ridingTrainingTier(meta);
}

/** Character progression and transient host ownership authority. */
export interface RidingPlayerState {
  // Legacy 100g lesson payment, preserved for basic riding grandfathering.
  mountTrainingFeePaid?: boolean;
  // Basic riding legacy flag; advanced progression adds ridingTier.
  ridingTrained?: boolean;
  ridingTier?: 1 | 2;
  // Host-supplied collectible ownership from this account's other characters.
  accountMountSkinIds?: readonly string[];
  // False until a successful complete account item projection has arrived.
  accountMountItemsHydrated?: boolean;
}
