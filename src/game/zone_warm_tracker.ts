// The per-frame decision state for the zone-warm lane (main.ts's
// maybeWarmCurrentZone): how far the player moved since the last VISIBLE
// check, and whether this frame crossed the rift-band exit edge. Extracted so
// the freeze semantics are testable directly; main.ts holds only the thin
// consumer.
//
// The hidden argument is the desktop shell's presentation latch. A hidden
// frame is a full freeze: no tracker update, no answer. That is what makes
// the reveal frame honest: it computes the displacement accumulated across
// the whole hidden span, so the blocking-versus-background decision
// downstream keeps its meaning (an accumulated teleport-sized jump takes the
// blocking arm exactly as a live teleport would).
//
// The rift-exit edge survives a hidden span whenever any part of the crossing
// was seen: entered visible and exited hidden, or still inside the band at
// the reveal. A crossing contained ENTIRELY in one hidden span (entered and
// left the band with no visible frame in between) is deliberately not
// reported: no rift session was rendered during the span, so nothing near
// the exit was evicted, and the accumulated displacement still routes a
// teleport-sized reveal to the blocking arm.

export interface ZoneWarmCheck {
  /** Distance from the last visible check; 0 on the very first check. */
  displacement: number;
  /** True exactly on the frame that left the rift band (edge, not level). */
  riftExit: boolean;
}

/**
 * One tracker per world session. The returned function is called every frame;
 * it answers null while hidden and a REUSED result object otherwise (the
 * fields are only valid until the next call), so the per-frame path allocates
 * nothing.
 */
export function createZoneWarmTracker(
  isRiftBand: (x: number) => boolean,
): (x: number, z: number, hidden: boolean) => ZoneWarmCheck | null {
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let inRiftBand = false;
  const check: ZoneWarmCheck = { displacement: 0, riftExit: false };
  return (x, z, hidden) => {
    if (hidden) return null;
    check.displacement = Number.isFinite(lastX) ? Math.hypot(x - lastX, z - lastZ) : 0;
    lastX = x;
    lastZ = z;
    const wasInRiftBand = inRiftBand;
    inRiftBand = isRiftBand(x);
    check.riftExit = wasInRiftBand && !inRiftBand;
    return check;
  };
}
