/** The automatic floor when the caller names none. A tier's own floor
 *  (`GFX.budget.minRenderScaleMobile` / `Desktop`) replaces it: Low on a phone or
 *  tablet asks for 0.55, and a GPU-bound Mali tablet measured 2026-11-15 needs
 *  that room (town turns 21 FPS at 0.68, up to 30 at 0.55). The governor's
 *  resolution test keeps a cut only where it makes the frame cheaper, so a
 *  CPU-bound device is not pushed down for nothing. */
export const MIN_DYNAMIC_RENDER_SCALE = 0.68;
/** No floor, from any tier or caller, goes under this. */
export const DYNAMIC_RENDER_SCALE_ABSOLUTE_MIN = 0.5;

export interface DynamicResolutionInput {
  logicalWidth: number;
  logicalHeight: number;
  pixelRatio: number;
  renderScale: number;
  maxRenderScale: number;
  minRenderScale: number;
}

export interface DynamicResolutionRect {
  targetWidth: number;
  targetHeight: number;
  renderWidth: number;
  renderHeight: number;
  renderScale: number;
  uvScaleX: number;
  uvScaleY: number;
  uvMaxX: number;
  uvMaxY: number;
}

export interface DynamicResolutionGovernorRange {
  minRenderScale: number;
  maxRenderScale: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampedRenderScale(value: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0.5, finite));
}

function devicePixels(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/** The scale a fresh render-scale setting opens at: a mobile runtime starts
 *  below full scale unless the URL forces one of the desktop tiers. */
export function initialEffectiveRenderScale(
  scale: number,
  mobileRuntime: boolean,
  forcedTier: string | null,
): number {
  if (mobileRuntime && forcedTier !== 'high' && forcedTier !== 'ultra' && forcedTier !== 'insane') {
    return Math.min(scale, 0.85);
  }
  return scale;
}

export function dynamicResolutionAllocationScale(
  supported: boolean,
  manualRenderScale: number,
  effectiveRenderScale: number,
): number {
  const manual = clampedRenderScale(manualRenderScale, 1);
  return supported ? manual : clampedRenderScale(effectiveRenderScale, manual);
}

export function dynamicResolutionGovernorRange(
  supported: boolean,
  effectiveRenderScale: number,
  minRenderScale: number,
  maxRenderScale: number,
): DynamicResolutionGovernorRange {
  const effective = clampedRenderScale(effectiveRenderScale, 1);
  if (!supported) {
    return {
      minRenderScale: effective,
      maxRenderScale: effective,
    };
  }
  const max = clampedRenderScale(maxRenderScale, effective);
  const requestedMin = Number.isFinite(minRenderScale) ? minRenderScale : MIN_DYNAMIC_RENDER_SCALE;
  return {
    minRenderScale: Math.min(max, Math.max(DYNAMIC_RENDER_SCALE_ABSOLUTE_MIN, requestedMin)),
    maxRenderScale: max,
  };
}

export function dynamicResolutionRect(input: DynamicResolutionInput): DynamicResolutionRect {
  const logicalWidth = positive(input.logicalWidth, 1);
  const logicalHeight = positive(input.logicalHeight, 1);
  const pixelRatio = positive(input.pixelRatio, 1);
  const maxRenderScale = clampedRenderScale(input.maxRenderScale, 1);
  const requestedMin = Number.isFinite(input.minRenderScale)
    ? input.minRenderScale
    : MIN_DYNAMIC_RENDER_SCALE;
  const minRenderScale = Math.min(
    maxRenderScale,
    Math.max(DYNAMIC_RENDER_SCALE_ABSOLUTE_MIN, requestedMin),
  );
  const requestedScale = Number.isFinite(input.renderScale) ? input.renderScale : maxRenderScale;
  const renderScale = Math.min(maxRenderScale, Math.max(minRenderScale, requestedScale));
  const targetWidth = devicePixels(logicalWidth * pixelRatio * maxRenderScale);
  const targetHeight = devicePixels(logicalHeight * pixelRatio * maxRenderScale);
  const renderWidth = Math.min(targetWidth, devicePixels(logicalWidth * pixelRatio * renderScale));
  const renderHeight = Math.min(
    targetHeight,
    devicePixels(logicalHeight * pixelRatio * renderScale),
  );
  return {
    targetWidth,
    targetHeight,
    renderWidth,
    renderHeight,
    renderScale,
    uvScaleX: renderWidth / targetWidth,
    uvScaleY: renderHeight / targetHeight,
    uvMaxX: renderWidth === targetWidth ? 1 : (renderWidth - 0.5) / targetWidth,
    uvMaxY: renderHeight === targetHeight ? 1 : (renderHeight - 0.5) / targetHeight,
  };
}
