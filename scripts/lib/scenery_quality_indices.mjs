import { MeshoptSimplifier } from 'meshoptimizer';

// Standard policy prioritizes intact surfaces. The opt-in Palmreach policy
// tolerates topology loss when disconnected leaf surfaces resist reduction.
// Caller awaits MeshoptSimplifier.ready. No source attributes or indices mutate.
export function sceneryQualityIndices(geometry, targetTriangles = 512, permissive = false) {
  const p = geometry.attributes.position;
  const base = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: p.count }, (_, i) => i);
  if (base.length <= targetTriangles * 3) return base;
  const positions = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) positions.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
  const [indices] = MeshoptSimplifier.simplify(
    base,
    positions,
    3,
    targetTriangles * 3,
    permissive ? 0.03 : 0.01,
    permissive ? ['Permissive'] : [],
  );
  if (permissive && indices.length > targetTriangles * 6) {
    const [coarse] = MeshoptSimplifier.simplifySloppy(
      base,
      positions,
      3,
      null,
      targetTriangles * 3,
      1,
    );
    if (coarse.length) return coarse;
    // Sloppy clustering can discard every disconnected leaf triangle. Keep a
    // nonempty mesh by allowing the regular simplifier its full error range.
    const [fallback] = MeshoptSimplifier.simplify(base, positions, 3, targetTriangles * 3, 1, [
      'Permissive',
    ]);
    if (fallback.length) return fallback;
  }
  return indices.length ? indices : base;
}

// The caller supplies the authored zone rectangle. Select by tree placement,
// not camera location, so looking across a zone border never changes its LOD.
export function isPalmBudgetTree(item, source, zone) {
  if (
    !zone ||
    item.x < zone.xMin ||
    item.x >= zone.xMax ||
    item.z < zone.zMin ||
    item.z >= zone.zMax
  )
    return false;
  const name = source.material?.name ?? '';
  return (
    /^(Bark_|Leaves_)/.test(name) || (item.owner.name === 'jungle-features' && name === 'Atlas')
  );
}
