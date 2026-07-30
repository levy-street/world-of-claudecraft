// Three's default opaque comparator groups by material before projected depth.
// This pure replacement preserves every explicit ordering barrier, puts solid
// depth writers ahead of alpha-tested cards, then lets early-Z reject hidden
// fragments by sorting each class front-to-back.

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

function alphaTestOrder(item: OpaqueDrawItem): number {
  return (item.material.alphaTest ?? 0) > 0 ? 1 : 0;
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
