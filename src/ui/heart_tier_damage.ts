// Resolved per-difficulty damage for the Smith's Heart aura tooltips
// (docs/design/tooltip-writing.md: resolved values, never "X% more"). Every
// encounter hit rolls its tuned range and multiplies it by the tier's damage
// factor (the encounters' `roll`: Math.max(1, round(value * mult))), so a
// tooltip shows Normal's range from the tuning and each harder tier's range
// through this one rounding rule. The client cannot know which tier a pull is
// on, so the tooltip names every tier's resolved range. Pure: the five fights'
// descriptors (council/breath/quench/heat/final[_phase]_aura_effect.ts) call
// it with their own difficulty table's factor. Pinned by
// tests/smith_heart_tier_tooltips.test.ts.

/** One tuned value at a tier's damage factor, rounded the way the fight rolls. */
export function tierValue(value: number, mult: number): number {
  return Math.max(1, Math.round(value * mult));
}

/** A tuned min/max range at a tier's damage factor, under `<prefix>Min/Max`. */
export function tierRange(
  prefix: string,
  min: number,
  max: number,
  mult: number,
): Record<string, number> {
  return { [`${prefix}Min`]: tierValue(min, mult), [`${prefix}Max`]: tierValue(max, mult) };
}
