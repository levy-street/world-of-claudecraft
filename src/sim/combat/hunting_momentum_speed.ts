// Hunting Momentum's movement layer (Fieldcraft). Kept in its own leaf module
// because player_motion.ts runs on both hosts (the live Sim and the online
// self-extrapolator), and reading the mirrored aura list here means the client
// predicts the same speed the server moves the hunter at. Draws no rng.

export const HUNTING_MOMENTUM_MAX_STACKS = 3;
/** Movement speed per Hunting Momentum stack. */
export const HUNTING_MOMENTUM_SPEED_PER_STACK = 0.15;

/** Movement multiplier from Hunting Momentum stacks (1 with none). */
export function huntingMomentumSpeedMult(
  auras: readonly { kind: string; stacks?: number }[],
): number {
  const momentum = auras.find((aura) => aura.kind === 'hunter_momentum');
  if (!momentum) return 1;
  const stacks = Math.max(0, Math.min(HUNTING_MOMENTUM_MAX_STACKS, momentum.stacks ?? 1));
  return 1 + HUNTING_MOMENTUM_SPEED_PER_STACK * stacks;
}
