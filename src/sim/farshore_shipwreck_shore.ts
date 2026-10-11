// A small beach apron for the owner's anchor at (320.6, -4.25, 130.05).
// The old bank rose above the whole model. Keep the exported asset transform
// and lower only this patch, with a broad skirt back into the existing beach.
// Applied to the finished height so mesh, movement and sea queries agree.
// Calm-sizing probes skip this pad: a local cut must not resize distant skirts.
export function applyFarshoreShipwreckShore(x: number, z: number, h: number): number {
  const dx = x - 320.6;
  const dz = z - 130.05;
  const radiusSq = dx * dx + dz * dz;
  if (radiusSq >= 100 || h <= -4.3) return h;
  // The 3 yd core covers the anchor and the nearby terrain-mesh vertices.
  // Seven yards of smooth blending avoids cutting a vertical bank around it.
  const t = Math.min(1, Math.max(0, (Math.sqrt(radiusSq) - 3) / 7));
  const weight = 1 - t * t * (3 - 2 * t);
  return h + (-4.3 - h) * weight;
}
