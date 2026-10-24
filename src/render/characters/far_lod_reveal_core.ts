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
 * retry from update(), and the shadow plan).
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
 *  gate exists to remove. (A WOC body has a stand-in for that window and for
 *  every frame before its first far bake: shadowStandInShown.) */
export function shadowProxyShown(
  wanted: boolean,
  hasFarMesh: boolean,
  compilePending: boolean,
): boolean {
  return wanted && farLodReady(hasFarMesh, compilePending);
}

/**
 * A WOC body's shadow in the proxy band while its own far bake cannot cast it: the
 * stand-in silhouette of its visual key (assets.ts prepareVisual: the bare body mid-idle
 * with a head-sized ellipsoid, woc_shadow_stand_in.ts), mounted with the body so the
 * body's own creation gate links it. A WOC far bake is minted only by the far crossing
 * (it is one bake per look, and most of a crowd stands close enough never to draw it), so
 * between the articulated shadow range and that crossing the stand-in is what casts:
 * never a body without a shadow, never a bake for a shadow alone. The body's own baked
 * silhouette (`hasBakedProxy`: its far bake's shadow proxy) takes over the frame that
 * bake is ready, and exactly one of the two is ever drawn.
 */
export function shadowStandInShown(
  wanted: boolean,
  hasBakedProxy: boolean,
  compilePending: boolean,
): boolean {
  return wanted && !farLodReady(hasBakedProxy, compilePending);
}

/**
 * A body still waiting for its head draws NOTHING: not its rig, not its far mesh, not its
 * shadow proxy. A WOC base file ends at the neck (its head is a streamed pack), so the body
 * alone would be a headless figure; a body built directly (a preview, a portrait) stays
 * undrawn until its head is live (woc_head_stream_core.ts wocHeadAwaited decides
 * `awaitingHead`, which a failed head file ends, so a dead request never hides a character).
 * A body in the WORLD never waits (its bare head stands in for a hairstyle still on the
 * wire: wocHeadLiveLook), so it passes false, as every other body does, and is exactly
 * `shown`.
 */
export function bodyDrawn(shown: boolean, awaitingHead: boolean): boolean {
  return shown && !awaitingHead;
}
