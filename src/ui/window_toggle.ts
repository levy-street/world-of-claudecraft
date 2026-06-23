// Visibility predicate for HUD windows that share the `.window { display: none }`
// stylesheet rule (see index.html). Such a window is hidden by CSS while its
// INLINE `style.display` is still '' (the default), and a toggle only ever sets
// an inline 'block'/'flex' to show it or 'none' to hide it. So a window counts
// as open exactly when its inline display is a real visible value, i.e. neither
// '' (CSS-hidden, never opened this session) nor 'none' (explicitly closed).
//
// Reading '' as "open" was the first-press bug: the first press of B/M closed an
// already-hidden window (a no-op) instead of opening it.
export function isWindowOpen(inlineDisplay: string): boolean {
  return inlineDisplay !== '' && inlineDisplay !== 'none';
}
