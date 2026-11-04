// The optional ground point a 'use' frame carries for an aimed throwable (the
// Clockwork Shock Bomb). Shape-checked here only: the sim clamps it to the
// item's range from the user, so the client proposes and the server decides,
// exactly like the castAt frame. Anything malformed reads as no aim, which is
// the sim's forward-throw fallback, never a point at the origin.

export function itemUseAim(raw: unknown): { x: number; z: number } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { x, z } = raw as { x?: unknown; z?: unknown };
  return typeof x === 'number' && Number.isFinite(x) && typeof z === 'number' && Number.isFinite(z)
    ? { x, z }
    : undefined;
}
