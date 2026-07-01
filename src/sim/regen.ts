// Shared resource-regeneration math. The sim tick and character stat tooltip
// both use these helpers so #103 tuning stays in one place.

export const FIVE_SECOND_RULE_THRESHOLD = 5;
export const REGEN_TICKS_PER_5S = 2.5;

export function healthRegenPerTick(sta: number): number {
  return Math.round(Math.max(0, sta) * 0.3 + 2);
}

export function manaRegenPerTick(spi: number, level: number): number {
  return Math.round(Math.max(0, spi) / 3 + 4 + Math.floor(Math.max(0, level) / 5));
}

export function restingHealthPer5s(sta: number): number {
  return Math.round(healthRegenPerTick(sta) * REGEN_TICKS_PER_5S);
}

export function restingManaPer5s(spi: number, level: number): number {
  return Math.round(manaRegenPerTick(spi, level) * REGEN_TICKS_PER_5S);
}
