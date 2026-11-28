// Reduced motion for the standalone preview renderers (the armory inspector and the mount
// preview). They own their own renderer and never see the world renderer's reduced-motion
// read (the game setting OR the OS preference), so they honour the OS preference, the half
// they can read on their own. The weapon-skin rigs they draw cap their flashes on it
// (WeaponVfxHandle.setCalm). One MediaQueryList for the page, read on demand.

let query: MediaQueryList | null | undefined;

/** True when the viewer's OS asks for reduced motion. Safe without a DOM (false). */
export function previewPrefersReducedMotion(): boolean {
  if (query === undefined) {
    query =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  }
  return query?.matches ?? false;
}
