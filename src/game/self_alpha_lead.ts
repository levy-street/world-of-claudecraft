// Adaptive self alpha lead for the online local player.
//
// The renderer shows the self avatar at `selfSnapshotAlpha(alpha, lead)`:
// interpolation between the last two server poses pushed `lead` snapshot
// intervals ahead, then exponentially smoothed (updateSelfRenderPosition).
// The lead's job is to erase the interpolation buffer plus a small
// extrapolation; it was a fixed 0.65 tuned for a typical LAN-adjacent echo.
// Derive it from the measured input echo instead: higher ping earns more
// lead (up to the hard ceiling the renderer's 1.25 alpha cap makes useful),
// and each millisecond of jitter cancels one of lead so an unstable link
// backs off rather than oscillating against the smoother.

export const SELF_LEAD_DEFAULT = 0.65; // pre-first-echo fallback (the old constant)
const SELF_LEAD_MIN = 0.25;
// Above ~0.9 the renderer's min(1.25, alpha + lead) cap eats the rest of the
// lead for most of the frame window, so more only adds stop overshoot.
const SELF_LEAD_MAX = 0.9;
const SELF_LEAD_BASE_MS = 15; // covers send throttle + half a server tick queue

export function adaptiveSelfAlphaLead(
  echoMs: number,
  jitterMs: number,
  snapIntervalMs: number,
): number {
  if (echoMs <= 0) return SELF_LEAD_DEFAULT;
  const interval = Math.max(20, snapIntervalMs);
  const leadMs = 0.5 * echoMs + SELF_LEAD_BASE_MS - jitterMs;
  return Math.min(SELF_LEAD_MAX, Math.max(SELF_LEAD_MIN, leadMs / interval));
}
