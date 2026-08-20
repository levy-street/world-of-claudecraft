/**
 * Far-LOD reveal policy for one character visual: which of the articulated
 * rig (`modelWrap`), the baked far mesh and the far shadow proxy is drawn,
 * given the renderer's per-frame LOD/shadow decisions and whether the far
 * mesh's freshly minted materials are still linking behind the compile gate.
 *
 * A composed body bakes its far mesh on its first far crossing, and those
 * materials are brand-new programs (the near body's minus the skinning bit),
 * so drawing the mesh the same call it is minted links them synchronously: the
 * 100-160 ms first-draw stalls seen in prod whenever a peer walks out of the
 * near band or streams in already far. While that link is pending the mesh
 * is treated as absent: the articulated rig keeps drawing (never a hole, an
 * enemy stays visible), and the far mesh takes over once the gate settles.
 *
 * Pure and Three-free so the rule is testable on its own and cannot drift
 * between the three call sites that reveal the far mesh (the LOD edge, the
 * budget retry from update(), and the shadow plan).
 */

/** The far mesh exists and its materials are linked: it may stand in. */
export function farLodReady(hasFarMesh: boolean, compilePending: boolean): boolean {
  return hasFarMesh && !compilePending;
}

/** The baked far mesh is drawn (and the articulated rig hidden) only when
 *  the renderer wants the far LOD AND the mesh is ready to draw. */
export function farMeshShown(far: boolean, hasFarMesh: boolean, compilePending: boolean): boolean {
  return far && farLodReady(hasFarMesh, compilePending);
}

/** The far shadow proxy is drawn only while the far bake is ready: its
 *  depth program links through the same gate as the far mesh's colour
 *  programs. The renderer's shadow plan (`wanted`) may ask for the proxy near
 *  or far, so this is NOT gated on `far`. Deliberate cosmetic cost: while a
 *  first far bake links, a body the plan already took out of the articulated
 *  shadow pass casts no shadow at all for that window (a few frames);
 *  drawing the proxy early would link its depth program cold, the stall the
 *  gate exists to remove. */
export function shadowProxyShown(
  wanted: boolean,
  hasFarMesh: boolean,
  compilePending: boolean,
): boolean {
  return wanted && farLodReady(hasFarMesh, compilePending);
}
