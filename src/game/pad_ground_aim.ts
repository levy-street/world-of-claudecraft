export function reticleStickDelta(
  stickX: number,
  stickY: number,
  camYaw: number,
  dt: number,
  range: number,
  sensitivity: number,
): { dx: number; dz: number } {
  const speed = ((range > 0 ? range : 5) / 1.2) * sensitivity;
  const distance = speed * dt;
  const forwardX = Math.sin(camYaw);
  const forwardZ = Math.cos(camYaw);
  const rightX = -Math.cos(camYaw);
  const rightZ = Math.sin(camYaw);
  return {
    dx: (-stickY * forwardX + stickX * rightX) * distance,
    dz: (-stickY * forwardZ + stickX * rightZ) * distance,
  };
}

export function nextSnapPoint(
  caster: { x: number; z: number },
  candidates: readonly { x: number; z: number }[],
  current: { x: number; z: number } | null,
  direction: 1 | -1,
): { x: number; z: number } | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const angleA = Math.atan2(a.z - caster.z, a.x - caster.x);
    const angleB = Math.atan2(b.z - caster.z, b.x - caster.x);
    if (angleA !== angleB) return angleA - angleB;
    const distanceA = (a.x - caster.x) ** 2 + (a.z - caster.z) ** 2;
    const distanceB = (b.x - caster.x) ** 2 + (b.z - caster.z) ** 2;
    return distanceA - distanceB;
  });
  if (current === null) return direction === 1 ? sorted[0] : sorted[sorted.length - 1];

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    const distance = (candidate.x - current.x) ** 2 + (candidate.z - current.z) ** 2;
    if (distance < nearestDistance) {
      nearestIndex = i;
      nearestDistance = distance;
    }
  }
  return sorted[(nearestIndex + direction + sorted.length) % sorted.length];
}
