export const MIN_DYNAMIC_RENDER_SCALE = 0.68;

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
    minRenderScale: Math.min(max, Math.max(MIN_DYNAMIC_RENDER_SCALE, requestedMin)),
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
  const minRenderScale = Math.min(maxRenderScale, Math.max(0.5, requestedMin));
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
