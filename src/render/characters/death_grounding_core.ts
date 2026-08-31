// Pure interpolation for model-local corpse grounding. The authored fall owns
// most of the clip; only the final quarter settles a model whose last pose
// otherwise ends above its world-space feet anchor.

const DEATH_GROUNDING_START_FRACTION = 0.75;

export function deathGroundingOffset(
  dead: boolean,
  elapsed: number,
  duration: number,
  finalOffset: number,
): number {
  if (!dead || duration <= 0 || finalOffset <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsed / duration));
  const t = Math.min(
    1,
    Math.max(0, (progress - DEATH_GROUNDING_START_FRACTION) / (1 - DEATH_GROUNDING_START_FRACTION)),
  );
  const smooth = t * t * (3 - 2 * t);
  return finalOffset * smooth;
}
