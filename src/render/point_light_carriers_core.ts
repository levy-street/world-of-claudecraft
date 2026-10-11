// Packing for the point-light carriers (point_light_carriers.ts is the Three
// consumer). The lit programs break out of their point-light loop at the first
// slot whose colour uniform is black (point_light_shader_core.ts), so every
// live light must sit before every dark one in three's light array. Three
// gathers only the carriers; this core copies the live sources into carriers
// 0..k-1 and darkens the rest, the whole of that ordering contract.

/** A layer no camera enables: three skips a source here, and its world matrix
 *  still updates, so the carrier reads the exact position three would have. */
export const POINT_LIGHT_SOURCE_LAYER = 31;
export const POINT_LIGHT_SOURCE_MASK = (1 << POINT_LIGHT_SOURCE_LAYER) >>> 0;
export const SOURCE_LAYER_MASK_KEY = 'pointLightSourceLayerMask';

// A colour channel under the float32 normal minimum can upload as a flushed
// zero, and the shader would then break at a slot this core counted as live.
const FLOAT32_MIN_NORMAL = 2 ** -126;

export interface CarrierSceneNode {
  visible: boolean;
  parent: CarrierSceneNode | null;
}

export interface CarrierColor {
  r: number;
  g: number;
  b: number;
}

export interface PointLightSourceLike extends CarrierSceneNode {
  intensity: number;
  distance: number;
  decay: number;
  color: CarrierColor;
  layers: { mask: number };
  userData: Record<string, unknown>;
  matrixWorld: { elements: ArrayLike<number> };
}

export interface PointLightCarrierLike {
  intensity: number;
  distance: number;
  decay: number;
  color: CarrierColor;
  matrixWorld: { elements: number[] };
}

/** Moves a source off every camera layer, remembering the mask three would
 *  have tested so liveness keeps today's layer semantics. Idempotent. A
 *  `.clone()` of a marked source copies layers and userData, so the clone is
 *  marked too: it draws only once it joins a source list. */
export function markPointLightSource(
  source: Pick<PointLightSourceLike, 'layers' | 'userData'>,
): void {
  if (typeof source.userData[SOURCE_LAYER_MASK_KEY] === 'number') return;
  source.userData[SOURCE_LAYER_MASK_KEY] = source.layers.mask;
  source.layers.mask = POINT_LIGHT_SOURCE_MASK;
}

function sourceLayerMask(source: PointLightSourceLike): number {
  const recorded = source.userData[SOURCE_LAYER_MASK_KEY];
  return typeof recorded === 'number' ? recorded : source.layers.mask;
}

/** False when the colour uniform (colour times intensity) reads as black. */
export function pointLightCarriesLight(color: CarrierColor, intensity: number): boolean {
  return (
    Math.abs(color.r * intensity) >= FLOAT32_MIN_NORMAL ||
    Math.abs(color.g * intensity) >= FLOAT32_MIN_NORMAL ||
    Math.abs(color.b * intensity) >= FLOAT32_MIN_NORMAL
  );
}

/** True when three would have drawn this source with a non-black colour
 *  uniform: its own flag, every ancestor up to `sceneRoot` visible, and its
 *  layer on the camera's mask. */
export function isLivePointLightSource(
  source: PointLightSourceLike,
  sceneRoot: CarrierSceneNode,
  cameraLayerMask: number,
): boolean {
  if (!source.visible) return false;
  if (!pointLightCarriesLight(source.color, source.intensity)) return false;
  if ((sourceLayerMask(source) & cameraLayerMask) === 0) return false;
  let node = source.parent;
  while (node !== null) {
    if (node === sceneRoot) return node.visible;
    if (!node.visible) return false;
    node = node.parent;
  }
  return false;
}

/** Copies each live source of `sources` into the carrier at `cursor` onward
 *  and returns the advanced cursor. The cursor keeps counting past the last
 *  carrier, so a caller can tell an overflow from a full set. */
export function packPointLightSources(
  sources: readonly PointLightSourceLike[],
  carriers: readonly PointLightCarrierLike[],
  cursor: number,
  sceneRoot: CarrierSceneNode,
  cameraLayerMask: number,
): number {
  let next = cursor;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!isLivePointLightSource(source, sceneRoot, cameraLayerMask)) continue;
    if (next < carriers.length) {
      const carrier = carriers[next];
      carrier.color.r = source.color.r;
      carrier.color.g = source.color.g;
      carrier.color.b = source.color.b;
      carrier.intensity = source.intensity;
      carrier.distance = source.distance;
      carrier.decay = source.decay;
      const from = source.matrixWorld.elements;
      const to = carrier.matrixWorld.elements;
      to[12] = from[12];
      to[13] = from[13];
      to[14] = from[14];
    }
    next++;
  }
  return next;
}

/** Blacks out every carrier from `from` on. Colour AND intensity go to zero:
 *  an infinite colour left behind would upload `inf * 0`, a NaN the shader's
 *  black test does not match. */
export function darkenPointLightCarriers(
  carriers: readonly PointLightCarrierLike[],
  from: number,
): void {
  for (let i = Math.max(0, from); i < carriers.length; i++) {
    const carrier = carriers[i];
    carrier.intensity = 0;
    carrier.color.r = 0;
    carrier.color.g = 0;
    carrier.color.b = 0;
  }
}
