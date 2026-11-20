// The welded-skin read of a shipped rigid-plate creature GLB (the Smith's Heart Quench bodies): every
// plate rides one bone, and only the vertices on a seam between two bones' plates share them, so a seam
// gives a little and never opens into a gap you can see through (the owner's call, 2026-11-09: never
// split the model). The glTF still duplicates a vertex along a UV seam, so every copy of one point must
// carry the same joints and weights: `parted` counts the copies that do not (a seam that can open).

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export interface WeldedSkinReport {
  /** Vertices in the skinned primitive. */
  count: number;
  /** Vertices at a position another vertex holds with a different joint mix. */
  parted: number;
  /** The share of vertices riding one bone at full weight (the rigid plates). */
  singleShare: number;
}

/** Read `path` (a GLB under public/) and report its skin's seams. */
export async function weldedSkinReport(path: string): Promise<WeldedSkinReport> {
  await MeshoptDecoder.ready;
  const doc = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .read(path);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const jts = prim.getAttribute('JOINTS_0');
  const wts = prim.getAttribute('WEIGHTS_0');
  if (!pos || !jts || !wts) throw new Error(`${path}: no skinned primitive`);
  const p = [0, 0, 0];
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  const mixAt = new Map<string, string>();
  let parted = 0;
  let single = 0;
  const count = pos.getCount();
  for (let i = 0; i < count; i++) {
    pos.getElement(i, p);
    jts.getElement(i, j);
    wts.getElement(i, w);
    const mix = [0, 1, 2, 3]
      .filter((k) => w[k] > 0.001)
      .map((k) => `${j[k]}:${w[k].toFixed(2)}`)
      .sort()
      .join(',');
    const key = p.map((x) => x.toFixed(4)).join(',');
    const seen = mixAt.get(key);
    if (seen === undefined) mixAt.set(key, mix);
    else if (seen !== mix) parted++;
    if (!mix.includes(',')) single++;
  }
  return { count, parted, singleShare: single / count };
}
