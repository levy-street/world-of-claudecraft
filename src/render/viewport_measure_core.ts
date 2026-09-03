// The CSS viewport the renderer sizes its canvas to, as a pure function of
// its inputs; viewport_measure.ts is the one DOM reader that feeds it.

export interface ViewportMeasureInput {
  /** The canvas's own layout box (getBoundingClientRect), 0 when not laid out. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** In-game on a touch host: the layout box wins over the visual viewport,
   *  which the on-screen keyboard and browser chrome resize under the game. */
  readonly stableMobileGameViewport: boolean;
  /** window.visualViewport, or null where the host has none. */
  readonly visualViewport: { readonly width: number; readonly height: number } | null;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export function resolveViewportSize(input: ViewportMeasureInput): ViewportSize {
  const vv = input.stableMobileGameViewport ? null : input.visualViewport;
  const width = Math.round(
    input.stableMobileGameViewport
      ? input.canvasWidth || input.innerWidth
      : (vv?.width ?? (input.canvasWidth || input.innerWidth)),
  );
  const height = Math.round(
    input.stableMobileGameViewport
      ? input.canvasHeight || input.innerHeight
      : (vv?.height ?? (input.canvasHeight || input.innerHeight)),
  );
  return { width: Math.max(1, width), height: Math.max(1, height) };
}
