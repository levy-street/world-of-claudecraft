// Three's default opaque comparator groups by material before projected depth.
// Front-to-back wins in dense stationary views, but its extra ordering work is
// not worthwhile while traversing the world or in a sparse combat view. This
// core owns both comparators and the pure policy that selects between them.

/** Previous-frame draw density below this does not justify the early-Z sort. */
export const OPAQUE_FRONT_TO_BACK_MIN_DRAW_CALLS = 560;
/** A translating focus pays the stock material-first cost until it settles. */
export const OPAQUE_FRONT_TO_BACK_MAX_FOCUS_SPEED = 1;

export interface OpaqueDrawItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: {
    id: number;
    alphaTest?: number;
  };
}

export interface OpaqueSortPolicyInput {
  drawCalls: number;
  elapsedSeconds: number;
  focusX: number;
  focusZ: number;
  previousFocusX: number;
  previousFocusZ: number;
}

function alphaTestOrder(item: OpaqueDrawItem): number {
  return (item.material.alphaTest ?? 0) > 0 ? 1 : 0;
}

/**
 * Select the early-Z ordering only where its measured fragment savings can
 * repay the sort. The focus point, unlike the camera eye, does not translate
 * when the player rotates an orbit camera in place.
 */
export function shouldUseFrontToBackOpaqueSort(input: OpaqueSortPolicyInput): boolean {
  if (input.drawCalls < OPAQUE_FRONT_TO_BACK_MIN_DRAW_CALLS) return false;
  if (
    !Number.isFinite(input.previousFocusX) ||
    !Number.isFinite(input.previousFocusZ) ||
    !Number.isFinite(input.elapsedSeconds) ||
    input.elapsedSeconds <= 0
  ) {
    return false;
  }
  const dx = input.focusX - input.previousFocusX;
  const dz = input.focusZ - input.previousFocusZ;
  const maxStep = OPAQUE_FRONT_TO_BACK_MAX_FOCUS_SPEED * input.elapsedSeconds;
  return dx * dx + dz * dz <= maxStep * maxStep;
}

export function opaqueFrontToBackSort(left: OpaqueDrawItem, right: OpaqueDrawItem): number {
  if (left.groupOrder !== right.groupOrder) return left.groupOrder - right.groupOrder;
  if (left.renderOrder !== right.renderOrder) return left.renderOrder - right.renderOrder;

  const alphaOrder = alphaTestOrder(left) - alphaTestOrder(right);
  if (alphaOrder !== 0) return alphaOrder;
  if (left.z !== right.z) return left.z - right.z;
  if (left.material.id !== right.material.id) return left.material.id - right.material.id;
  return left.id - right.id;
}

/** Three r165's material-first keys inside the required solid/foliage partition. */
export function opaqueMaterialFirstSort(left: OpaqueDrawItem, right: OpaqueDrawItem): number {
  if (left.groupOrder !== right.groupOrder) return left.groupOrder - right.groupOrder;
  if (left.renderOrder !== right.renderOrder) return left.renderOrder - right.renderOrder;
  const alphaOrder = alphaTestOrder(left) - alphaTestOrder(right);
  if (alphaOrder !== 0) return alphaOrder;
  if (left.material.id !== right.material.id) return left.material.id - right.material.id;
  if (left.z !== right.z) return left.z - right.z;
  return left.id - right.id;
}
