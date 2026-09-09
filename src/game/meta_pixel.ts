// The Meta pixel custom-event sender, lifted out of src/ui/hud.ts.
//
// It lives here because it is ANALYTICS GLUE, not HUD logic: src/CLAUDE.md puts
// client-bootstrap helpers (mobile, fullscreen, shell, loading, analytics,
// graphics detection) in src/game/ or a src/ui/ sibling and never in a
// coordinator, and hud.ts is one of the four sanctioned coordinators under the
// monolith ratchet.
//
// Fire-and-forget by design: the pixel is loaded by the marketing shell
// (index.html) and is simply absent on /play, on the packaged desktop and
// Capacitor shells, and whenever a content blocker has eaten it. A missing
// `fbq` is the ORDINARY case, so it returns silently rather than warning; a
// dev-channel log here would fire on every event for most sessions.

/** Send one Meta custom event, or do nothing when the pixel is not loaded. */
export function trackMetaPixel(
  eventName: string,
  data?: Record<string, unknown>,
  options?: Record<string, unknown>,
): void {
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== 'function') return;
  // The two arities are NOT interchangeable: passing `undefined` as a fourth
  // argument is not the same call as omitting it (the pixel reads an eventID
  // out of that slot for deduplication), so the branch stays.
  if (options) fbq('trackCustom', eventName, data ?? {}, options);
  else fbq('trackCustom', eventName, data ?? {});
}
