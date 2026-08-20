export interface GrassCapCollapseBand {
  start: number;
  end: number;
}

const BASE_CARPET_RADIUS = 34;
const BASE_COLLAPSE_START = 22;
const BASE_COLLAPSE_END = 30;

/**
 * Match the cap-card collapse to the blade carpet that replaces it. A zero
 * radius keeps the cap everywhere because there is no carpet underneath.
 */
export function grassCapCollapseBand(radius: number): GrassCapCollapseBand | null {
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const scale = radius / BASE_CARPET_RADIUS;
  return {
    start: BASE_COLLAPSE_START * scale,
    end: BASE_COLLAPSE_END * scale,
  };
}

export function grassCapCollapseShaderPatch(band: GrassCapCollapseBand | null): string {
  if (!band) return '';
  return `
        float capKeep = smoothstep(${band.start.toFixed(3)}, ${band.end.toFixed(3)}, distance(tuftBase, uPlayerPos));
        transformed *= mix(1.0, capKeep, aCap);`;
}

/** The `cap:` segment of a grass-card material's program cache key. */
export function grassCardCapKey(band: GrassCapCollapseBand | null): string {
  return band ? `${band.start.toFixed(3)}-${band.end.toFixed(3)}` : 'none';
}

/**
 * The whole `customProgramCacheKey` a grass-card material returns. Two cards
 * that differ only in their collapse band are two programs, so the boot prewarm
 * needs one twin per band the tiers produce (ground_decor_prewarm.ts), and the
 * key composition lives here rather than in foliage.ts so a test can enumerate
 * those arms from the same source the live material uses.
 */
export function grassCardProgramCacheKey(
  band: GrassCapCollapseBand | null,
  baseProgramKey: string,
): string {
  return `grass-card|cap:${grassCardCapKey(band)}|${baseProgramKey}`;
}
