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

/** Marks a link whose clicks already report, so a second pass binds nothing. */
const TRACKED_LINK_ATTR = 'data-woc-click-tracked';

/**
 * Report clicks on the page's GitHub and Discord links as custom events. Safe to run
 * more than once: the landing-first boot (src/ui/landing_first.ts) binds them before
 * the client loads and main.ts binds again at boot. Moved out of src/main.ts.
 */
export function trackCommunityLinkClicks(root: ParentNode = document): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    if (link.hasAttribute(TRACKED_LINK_ATTR)) return;
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    const host = url.hostname.toLowerCase();
    const isGitHub = host === 'github.com' || host.endsWith('.github.com');
    const isDiscord =
      host === 'discord.gg' ||
      host.endsWith('.discord.gg') ||
      host === 'discord.com' ||
      host.endsWith('.discord.com');
    if (!isGitHub && !isDiscord) return;
    link.setAttribute(TRACKED_LINK_ATTR, '');
    link.addEventListener('click', () => {
      trackMetaPixel(isGitHub ? 'GitHubClick' : 'DiscordClick', {
        url: url.toString(),
        path: url.pathname,
      });
    });
  });
}
