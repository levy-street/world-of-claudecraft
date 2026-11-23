export interface CharacterPreviewPolicy {
  antialias: boolean;
  preserveDrawingBuffer: boolean;
  pixelRatioCap: number;
}

/** Keep the secondary preview context small beside a memory-constrained world renderer.
 *  Still 1.5x on such a device (a phone): the preview canvas is a few hundred CSS px,
 *  so the extra backing store is well under a megabyte, and at 1x the face close-up
 *  in the creator read soft on a phone screen. */
export function resolveCharacterPreviewPolicy(constrainedMemory: boolean): CharacterPreviewPolicy {
  if (constrainedMemory) {
    return {
      antialias: false,
      preserveDrawingBuffer: false,
      pixelRatioCap: 1.5,
    };
  }
  return {
    antialias: true,
    preserveDrawingBuffer: true,
    pixelRatioCap: 2,
  };
}

/** A hidden preview keeps its RAF alive for reuse but submits no GPU work. */
export function characterPreviewFrameVisible(
  canvasConnected: boolean,
  width: number,
  height: number,
): boolean {
  return canvasConnected && width > 0 && height > 0;
}
