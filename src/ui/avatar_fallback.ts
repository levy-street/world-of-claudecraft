// Guard an external avatar <img> (a Discord CDN profile picture) against a failed
// load. When the CDN image cannot be fetched (an ad-blocker or privacy extension
// blocking cdn.discordapp.com, a stale or deleted avatar hash, a transient network
// error, or a reverse-proxy CSP), the browser paints its own broken-image
// placeholder in place of the picture: a jarring generic icon on an in-world
// nameplate or unit frame. Every OTHER image on those surfaces is a locally
// generated data-URL (tier badge, raid marker) that cannot fail; the linked-Discord
// avatar is the one external source, so it is the one that needs a fallback.
//
// On 'error' this runs `onError(img)` when given, otherwise it hides the element so
// nothing broken shows. Surfaces that have a local fallback (a generated data-URL
// badge, which cannot itself fail) pass a callback that reproduces their normal
// "no avatar" rendering, so a failed load degrades to the same clean state.
//
// Safe on a reused element (the pooled nameplate img) and on a throwaway one (a
// window that re-renders its innerHTML): the listener lives and dies with the node,
// and the default hide-path cannot loop (a hidden img stops loading).

export function attachAvatarFallback(
  img: HTMLImageElement,
  onError?: (img: HTMLImageElement) => void,
): void {
  img.addEventListener('error', () => {
    if (onError) {
      onError(img);
      return;
    }
    img.style.display = 'none';
  });
}
