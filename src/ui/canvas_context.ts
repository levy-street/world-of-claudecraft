// The shared 2D-context assertion, lifted out of src/ui/hud.ts, which called it
// from eleven places (the minimap, its background strip, the paperdoll and
// portrait canvases, the map surface).
//
// A 2D context is non-null for any attached canvas in this app, so centralizing
// the assertion is what keeps eleven call sites from each carrying a non-null
// bang. It THROWS rather than asserting: a null here is a broken embed, a
// dev-surfaced failure never reached in practice, and a bang would hand the
// call site an object that is actually null.
//
// Host-agnostic by construction, which is why it needs no row in
// tests/architecture.test.ts: it reaches no browser global at all, it only calls
// a method on the canvas element the caller already owns.

/** The 2D context of an attached canvas. Throws when the host has none. */
export function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}
