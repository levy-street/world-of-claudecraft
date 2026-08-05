// Manual (code-computed) rigging: bind a raw generated mesh onto the ACTUAL
// KayKit reference skeleton, with vertex skin weights computed here instead of
// by Tripo's rig service.
//
// The trick that makes this worth doing: rather than building a new skeleton
// and retargeting animations onto it (the Tripo path), the raw mesh is
// transformed INTO the reference rig's bind space (yaw to face +Z, uniform
// scale so the T-pose arm line lands on the reference wrist line, feet at
// y=0) and skinned against the reference joints directly. The output GLB then
// carries the reference model's ENTIRE clip library natively (all 22 KayKit
// clips for the knight), plus the real handslot.r/.l bones, with zero
// animation cost and perfect style coherence.
//
// Weight solver: distance-to-bone-segment with a per-segment RADIUS measured
// from the mesh, in lib/skin_solver.mjs (pure, unit-tested). Each joint owns the
// segments from itself to its children; leaf joints get a synthetic segment
// (head up to the top of the mesh, toes forward). This file owns the glTF I/O
// and the bind-space transform and nothing else.
import { getBounds } from '@gltf-transform/core';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import { mat4Invert, openGlb, saveGlb } from './glb.mjs';
import {
  buildAdjacency,
  connectedComponents,
  rigidifyShells,
  segmentRadii,
  smoothWeights,
  solveSkinWeights,
  weldPositions,
} from './skin_solver.mjs';

const ROT = ([x, y, z]) => [-z, y, x]; // -90deg about Y: +X facing -> +Z facing

/** Rig `rawGlbPath` onto `referenceGlbPath`'s skeleton; write to `outPath`.
 *  Options: yaw ('auto' -90deg default via preRotated=false), armY override.
 *  Returns a fit report. */
export async function manualRigOntoReference(rawGlbPath, referenceGlbPath, outPath, opts = {}) {
  // glTF JOINTS_0/WEIGHTS_0 are VEC4, so 4 influences is the hard ceiling.
  const K = Math.max(1, Math.min(4, opts.influences ?? 4));

  // --- Reference rig: joints, bind-pose world positions, mesh bounds -------
  const doc = await openGlb(referenceGlbPath); // mutated in place, saved to outPath
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error('reference model has no skin');
  const joints = skin.listJoints();
  // Skinned vertices must be authored in the space the inverse bind matrices
  // define, so take the joint positions from inverse(IBM) rather than from the
  // node hierarchy.
  //
  // For the KayKit rigs bind IS rest (they agree to 5e-5 across all 23 joints),
  // so this is not a correction of the rest pose. What it IS load-bearing for is
  // quantization: the reference carries one skin CLONE PER PRIMITIVE, each with
  // that primitive's dequantization matrix folded into its inverse bind
  // matrices, and listSkins()[0] is an arbitrary one of them (the knight's is
  // ~2.18x with the body axis at x=-1.113). Every anchor below is measured in
  // that same frame, so the fit stays self-consistent whichever clone comes
  // first, but note the fragility: a reference whose primitive order or
  // quantization changed would shift the whole fit with no error raised.
  const ibmArr = skin.getInverseBindMatrices().getArray();
  const jointPos = joints.map((_, i) => {
    const inv = mat4Invert(Array.from(ibmArr.slice(i * 16, (i + 1) * 16)));
    return [inv[12], inv[13], inv[14]];
  });
  const byName = new Map(joints.map((j, i) => [j.getName(), i]));
  const refBounds = getBounds(root.listScenes()[0]);
  // Bind-frame anchors (the bind space can be offset AND scaled relative to
  // the rest pose; the knight's is ~2.18x with the body axis at x=-1.11):
  // ground = the root joint's bind height, body axis = hips XZ, and the
  // T-pose arm line = wrist height above ground.
  const P = (name) => jointPos[byName.get(name)];
  const groundY = P('root')?.[1] ?? 0;
  const centerX = P('hips')?.[0] ?? 0;
  const centerZ = P('hips')?.[2] ?? 0;
  const wristAbove = (P('wrist.r')?.[1] ?? 1.11) - groundY;

  const sideGuard = 0.02 * wristAbove;
  const side = (i) => {
    const n = joints[i].getName();
    return n.endsWith('.l') ? 1 : n.endsWith('.r') ? -1 : 0;
  };

  /** Bone segments, attributed to the PROXIMAL joint. Skip root (whole-body
   *  mover, no direct weights) and handslots (attachment-only).
   *
   *  `headTipY` is where the head's synthetic leaf segment ends, and it is
   *  measured from the MESH rather than from the rig. Sizing it off the rig
   *  (it was `0.4 * wristAbove`) assumes the head is a certain fraction of a
   *  reference-shaped body, and the moment a silhouette breaks that assumption
   *  the signature feature leaves the skeleton entirely: on the Sundered Horror
   *  the leaf ended at y=1.492 while the horn crown reaches y=2.145, so the top
   *  30% of the figure, the thing you see first, sat beyond the end of every
   *  bone in the rig. */
  const buildSegments = (headTipY) => {
    const segs = [];
    for (let i = 0; i < joints.length; i++) {
      const name = joints[i].getName();
      if (/^root$/i.test(name) || name.startsWith('handslot')) continue;
      const s = side(i);
      const kids = joints[i].listChildren().filter((c) => byName.has(c.getName()));
      for (const c of kids) {
        segs.push({ joint: i, side: s, a: jointPos[i], b: jointPos[byName.get(c.getName())] });
      }
      if (kids.length) continue;
      // Synthetic leaf segments: the head runs up to cover the mesh above it,
      // toes extend forward (+Z) by a fixed slice of the bind frame.
      const p = jointPos[i];
      const b =
        name === 'head'
          ? [p[0], Math.max(headTipY, p[1] + 0.05 * wristAbove), p[2]]
          : [p[0], p[1], p[2] + 0.05 * wristAbove];
      segs.push({ joint: i, side: s, a: p, b });
    }
    return segs;
  };

  // --- Raw mesh: read arrays, transform into reference bind space ----------
  const rawDoc = await openGlb(rawGlbPath);
  const rawPrims = rawDoc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives());
  if (!rawPrims.length) throw new Error('raw model has no primitives');

  // Pass 1: rotated bounds + arm line (mean y of the widest 5% of vertices).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const rotatedPerPrim = rawPrims.map((prim) => {
    const src = prim.getAttribute('POSITION').getArray();
    const out = new Float32Array(src.length);
    for (let v = 0; v < src.length; v += 3) {
      const p = opts.preRotated
        ? [src[v], src[v + 1], src[v + 2]]
        : ROT([src[v], src[v + 1], src[v + 2]]);
      out[v] = p[0];
      out[v + 1] = p[1];
      out[v + 2] = p[2];
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    return out;
  });
  const maxAbsX = Math.max(Math.abs(min[0]), Math.abs(max[0]));
  let armYSum = 0;
  let armN = 0;
  for (const arr of rotatedPerPrim) {
    for (let v = 0; v < arr.length; v += 3) {
      if (Math.abs(arr[v]) > 0.82 * maxAbsX) {
        armYSum += arr[v + 1];
        armN++;
      }
    }
  }
  const rawArmY = armYSum / Math.max(1, armN) - min[1]; // above feet
  const scale = wristAbove / rawArmY;
  const midX = (min[0] + max[0]) / 2;
  const midZ = (min[2] + max[2]) / 2;

  // Pass 2: final positions (feet at y=0, centered XZ), then weights.
  const report = {
    scale: +scale.toFixed(3),
    rawArmY: +rawArmY.toFixed(3),
    wristAbove: +wristAbove.toFixed(3),
    bindGroundY: +groundY.toFixed(3),
    bindCenter: [+centerX.toFixed(3), +centerZ.toFixed(3)],
    fitHeight: +((max[1] - min[1]) * scale).toFixed(2),
    refHeight: +(refBounds.max[1] - refBounds.min[1]).toFixed(2),
    verts: 0,
  };
  const bindTopY = (max[1] - min[1]) * scale + groundY;
  const segments = buildSegments(bindTopY);
  report.headTipY = +bindTopY.toFixed(3);

  // Bind-space positions for every primitive, plus one flat point list the
  // solver works over. The whole mesh is solved TOGETHER, not per primitive: the
  // weld and the shell pass both need to see geometry that a primitive split
  // would otherwise hide from them.
  const posPerPrim = rawPrims.map((_, pi) => {
    const rot = rotatedPerPrim[pi];
    const out = new Float32Array(rot.length);
    for (let v = 0; v < rot.length; v += 3) {
      out[v] = (rot[v] - midX) * scale + centerX;
      out[v + 1] = (rot[v + 1] - min[1]) * scale + groundY;
      out[v + 2] = (rot[v + 2] - midZ) * scale + centerZ;
    }
    return out;
  });
  const primOffset = [];
  const points = [];
  for (const arr of posPerPrim) {
    primOffset.push(points.length);
    for (let v = 0; v < arr.length; v += 3) points.push([arr[v], arr[v + 1], arr[v + 2]]);
  }
  report.verts = points.length;

  // Solve per WELDED POSITION, not per vertex. Tripo ships a triangle soup with
  // co-located duplicates at every seam; weighting them independently lets two
  // vertices at one point disagree and pull apart, which cracks the mesh open
  // along the seam under animation.
  const { nodeOf, nodePos } = weldPositions(points, 1e-5);
  const solveOpts = {
    influences: K,
    sideGuard,
    centerX,
    radiusPercentile: opts.radiusPercentile ?? 0.8,
    minWeightFrac: opts.minWeightFrac ?? 0.05,
    falloff: opts.falloff ?? 2,
    ...(opts.radiusBand ? { radiusBand: opts.radiusBand } : {}),
  };
  const radii = segmentRadii(nodePos, segments, solveOpts);
  const solved = solveSkinWeights(nodePos, segments, { ...solveOpts, radii });
  report.weldedNodes = nodePos.length;
  report.rigidPoints = solved.rigid;
  // The measured influence radius per bone, which is the number to look at first
  // when a bone turns out to own nothing: a radius far below its neighbours'
  // starves it even on its own geometry.
  report.radii = {};
  segments.forEach((seg, i) => {
    const n = joints[seg.joint].getName();
    report.radii[n] = Math.max(report.radii[n] ?? 0, +radii[i].toFixed(3));
  });

  const globalIndices = [];
  rawPrims.forEach((prim, pi) => {
    const ind = prim.getIndices()?.getArray();
    if (!ind) return;
    const off = primOffset[pi];
    for (let i = 0; i < ind.length; i++) globalIndices.push(ind[i] + off);
  });
  if (globalIndices.length) {
    const adj = buildAdjacency(nodePos.length, globalIndices, nodeOf);
    // Relax the field against the neighbour graph. Per-vertex candidate picking
    // cannot stop two nodes 5mm apart from landing on very different blends, and
    // that gradient is what actually opens the mesh under a swing.
    // 4 iterations, measured on the Horror through the full shipping chain as
    // torn edges (over 2x stretch AND over a 4cm absolute gap, since this mesh
    // is full of slivers that hit 5x while moving nothing anyone can see) summed
    // over Chop, Walking_A and Death_A: 0 iters 244, 4 iters 217, 8 iters 215
    // but with ownership down from 0.754 to 0.742 and Death_A drifting worse.
    // Past about 4 the smoothing is buying tenths of a torn edge with real
    // ownership, which is the trade that made the naive heat-diffusion re-solve
    // in the audit worse than what it replaced.
    smoothWeights(solved.joints, solved.weights, adj, {
      iters: opts.smoothIters ?? 4,
      mix: opts.smoothMix ?? 0.5,
      influences: K,
    });
    // Loose shells ride one bone as a piece, AFTER smoothing so the rigid
    // assignment is the final word on them. The horn thicket has no topological
    // path to the head, so per-vertex weights shear it apart and a diffusion
    // solver orphans it outright.
    const { label, count } = connectedComponents(nodePos.length, globalIndices, nodeOf, adj);
    report.shells = count;
    report.rigidShells = rigidifyShells(solved.joints, solved.weights, label, count, K, {
      // A large component is real articulated body, not a decoration: freezing
      // it would kill a limb. Only small loose pieces are rigidified.
      maxShellNodes: Math.max(24, Math.round(nodePos.length * 0.02)),
      nodePos,
    });
  }

  const built = rawPrims.map((prim, pi) => {
    const pos = posPerPrim[pi];
    const n = pos.length / 3;
    const jointsAttr = new Uint16Array(n * 4);
    const weightsAttr = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const node = nodeOf[primOffset[pi] + v];
      // JOINTS_0/WEIGHTS_0 are VEC4; K is clamped to 4 above, so any slot past
      // K stays zero rather than reading into the next node's weights.
      for (let k = 0; k < K; k++) {
        jointsAttr[v * 4 + k] = solved.joints[node * K + k];
        weightsAttr[v * 4 + k] = solved.weights[node * K + k];
      }
    }
    // Normals: rotate only (uniform scale + translation preserve direction).
    const nrmSrc = prim.getAttribute('NORMAL')?.getArray();
    let nrm = null;
    if (nrmSrc) {
      nrm = new Float32Array(nrmSrc.length);
      for (let v = 0; v < nrmSrc.length; v += 3) {
        const r = opts.preRotated
          ? [nrmSrc[v], nrmSrc[v + 1], nrmSrc[v + 2]]
          : ROT([nrmSrc[v], nrmSrc[v + 1], nrmSrc[v + 2]]);
        nrm[v] = r[0];
        nrm[v + 1] = r[1];
        nrm[v + 2] = r[2];
      }
    }
    return {
      pos,
      nrm,
      jointsAttr,
      weightsAttr,
      uv: prim.getAttribute('TEXCOORD_0')?.getArray() ?? null,
      indices: prim.getIndices()?.getArray() ?? null,
      material: prim.getMaterial(),
    };
  });

  // --- Rebuild the reference doc: drop its meshes, add the new skinned body -
  for (const node of root.listNodes()) if (node.getMesh()) node.setMesh(null);
  for (const mesh of root.listMeshes()) mesh.dispose();

  const buffer = root.listBuffers()[0];
  const mkAcc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  const mesh = doc.createMesh('body');
  for (const b of built) {
    // Material: copy the raw PBR set (color + normal + ORM) into this doc.
    const mat = doc.createMaterial(b.material?.getName() ?? 'body');
    const copyTex = (getter, setter) => {
      const t = b.material?.[getter]();
      if (!t) return;
      const nt = doc.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType());
      mat[setter](nt);
    };
    copyTex('getBaseColorTexture', 'setBaseColorTexture');
    copyTex('getNormalTexture', 'setNormalTexture');
    copyTex('getMetallicRoughnessTexture', 'setMetallicRoughnessTexture');
    mat.setMetallicFactor(b.material?.getMetallicFactor() ?? 0);
    mat.setRoughnessFactor(b.material?.getRoughnessFactor() ?? 1);

    const prim = doc
      .createPrimitive()
      .setMode(4)
      .setMaterial(mat)
      .setAttribute('POSITION', mkAcc(b.pos, 'VEC3'))
      .setAttribute('JOINTS_0', mkAcc(b.jointsAttr, 'VEC4'))
      .setAttribute('WEIGHTS_0', mkAcc(b.weightsAttr, 'VEC4'));
    if (b.nrm) prim.setAttribute('NORMAL', mkAcc(b.nrm, 'VEC3'));
    if (b.uv) prim.setAttribute('TEXCOORD_0', mkAcc(new Float32Array(b.uv), 'VEC2'));
    if (b.indices) prim.setIndices(mkAcc(b.indices, 'SCALAR'));
    mesh.addPrimitive(prim);
  }
  const bodyNode = doc.createNode('body').setMesh(mesh).setSkin(skin);
  root.listScenes()[0].addChild(bodyNode);

  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ targetFormat: 'webp', resize: [1024, 1024] }),
  );
  await saveGlb(doc, outPath);
  report.clips = root.listAnimations().length;
  report.joints = joints.length;
  return report;
}
