/**
 * The viewer's reduced-motion choice: the OS setting or the in-game Reduce Motion
 * switch (the `reduce-motion` body class). The media query is resolved once; its
 * `matches` stays live as the OS setting changes.
 */
export function createReducedMotionProbe(): () => boolean {
  const query =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  return () => query?.matches === true || document.body.classList.contains('reduce-motion');
}
