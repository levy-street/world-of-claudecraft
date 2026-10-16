/** Exact rendered hits own ordinary selection. Approximate bounds are useful
 * for discovery, but must never grab a neighbouring building through a gap. */
export interface PlacementPickHit {
  index: number;
  distance: number;
  direct: boolean;
}

export interface PlacementPickChoice {
  index: number;
  x: number;
  y: number;
}

export function exactPlacementCandidates(
  hits: readonly PlacementPickHit[],
  available: (index: number) => boolean,
  limit = 16,
): number[] {
  const ordered = hits
    .filter((hit) => hit.direct && Number.isFinite(hit.distance) && hit.distance >= 0)
    .slice()
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const hit of ordered) {
    if (seen.has(hit.index) || !available(hit.index)) continue;
    seen.add(hit.index);
    result.push(hit.index);
    if (result.length >= limit) break;
  }
  return result;
}

/** An explicitly chosen overlap stays the drag target at that spot. Moving
 * elsewhere returns to the visible front surface, never an automatic cycle. */
export function resolvePlacementPick(
  candidates: readonly number[],
  choice: PlacementPickChoice | null | undefined,
  x: number,
  y: number,
): number | null {
  if (choice && Math.hypot(x - choice.x, y - choice.y) <= 16 && candidates.includes(choice.index)) {
    return choice.index;
  }
  return candidates[0] ?? null;
}

export interface PlacementTapCycle extends PlacementPickChoice {
  candidates: readonly number[];
}

/** Only a released stationary click advances the overlap. Presses retain the
 * current target so starting a drag never jumps to an object behind it. */
export function cyclePlacementPick(
  candidates: readonly number[],
  previous: PlacementTapCycle | null | undefined,
  x: number,
  y: number,
): PlacementTapCycle | null {
  if (!candidates.length) return null;
  const repeat =
    previous &&
    Math.hypot(x - previous.x, y - previous.y) <= 6 &&
    candidates.length === previous.candidates.length &&
    candidates.every((index, position) => index === previous.candidates[position]);
  const position = repeat ? (candidates.indexOf(previous.index) + 1) % candidates.length : 0;
  return { index: candidates[position], x, y, candidates: [...candidates] };
}
