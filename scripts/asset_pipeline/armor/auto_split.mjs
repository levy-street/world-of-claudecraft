// Auto-split a GENERATED armor suit (one fused mesh, no slot names) into the
// forge's slot-named pieces (Helm/Torso/Arms/Legs) by classifying each
// triangle against the target class body's segments. The suit is aligned to
// the body (uniform height scale + center + floor) for CLASSIFICATION ONLY;
// the emitted GLB keeps the suit's original coordinates, because the forge
// does its own fitting (--fit anchored) afterwards.
//
// Slot policy: Head verts -> Helm, Torso -> Torso, Shoulders pads ->
// Shoulders (generated suits carry big decorative pauldrons; folding them
// into Torso blew the verify standoff since they legitimately stand far off
// the chest), Arms -> Arms, Legs/Pants -> Legs. Slots receiving fewer than 1%
// of triangles are dropped (noise).
import { join } from 'node:path';
import { extractBody, readDoc, writeDoc } from './forge_core.mjs';

const SLOT_OF_SEGMENT = {
  Head: 'Helm',
  Torso: 'Torso',
  Shoulders: 'Shoulders',
  Arms: 'Arms',
  Legs: 'Legs',
  Pants: 'Legs',
};

function bounds(arrays) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const a of arrays) {
    for (let i = 0; i < a.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (a[i + k] < min[k]) min[k] = a[i + k];
        if (a[i + k] > max[k]) max[k] = a[i + k];
      }
    }
  }
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/** Subsample a segment's positions to at most n points (classification speed). */
function samplePoints(positions, n = 1200) {
  const count = positions.length / 3;
  const stride = Math.max(1, Math.floor(count / n));
  const out = [];
  for (let i = 0; i < count; i += stride) {
    out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  }
  return out;
}

export async function autoSplitArmor(rawGlb, char, outGlb, { workspace, log = console.log } = {}) {
  const bodyPath = join(workspace, `work/bodies/${char}.glb`);
  const body = extractBody(await readDoc(bodyPath), { synthArms: false });

  const doc = await readDoc(rawGlb);
  const root = doc.getRoot();

  // Gather the triangle soup in WORLD space (bake node transforms; generated
  // GLBs often carry a normalization transform on the mesh node).
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  if (!meshNodes.length) throw new Error('no meshes in the generated GLB');
  const tris = []; // { pos: Float32Array(9), uv: Float32Array(6)|null, nrm: Float32Array(9)|null, mat, centroid }
  for (const node of meshNodes) {
    const m = node.getWorldMatrix();
    const xf = (p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const uv = prim.getAttribute('TEXCOORD_0');
      const nrm = prim.getAttribute('NORMAL');
      const mat = prim.getMaterial();
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const iv = [0, 0, 0];
      const pv = [0, 0, 0];
      const read = (k) => {
        const vi = idx ? (idx.getElement(k, iv), iv[0]) : k;
        pos.getElement(vi, pv);
        return { vi, p: xf(pv) };
      };
      for (let k = 0; k + 2 < count; k += 3) {
        const a = read(k);
        const b = read(k + 1);
        const c = read(k + 2);
        const t = {
          pos: new Float32Array([...a.p, ...b.p, ...c.p]),
          uv: null,
          nrm: null,
          mat,
          centroid: [
            (a.p[0] + b.p[0] + c.p[0]) / 3,
            (a.p[1] + b.p[1] + c.p[1]) / 3,
            (a.p[2] + b.p[2] + c.p[2]) / 3,
          ],
        };
        if (uv) {
          const u = [0, 0];
          const arr = new Float32Array(6);
          for (const [j, v] of [a, b, c].entries()) {
            uv.getElement(v.vi, u);
            arr[j * 2] = u[0];
            arr[j * 2 + 1] = u[1];
          }
          t.uv = arr;
        }
        if (nrm) {
          const u = [0, 0, 0];
          const arr = new Float32Array(9);
          for (const [j, v] of [a, b, c].entries()) {
            nrm.getElement(v.vi, u);
            arr.set(u, j * 3);
          }
          t.nrm = arr;
        }
        tris.push(t);
      }
    }
  }
  log(`auto-split: ${tris.length} triangles from ${meshNodes.length} mesh node(s)`);

  // Classification transform: suit -> body space. Generated suits carry big
  // decorative masses (helm crests, pauldron icicles) that skew any bbox or
  // percentile anchor, so FIT the alignment instead: grid-search a uniform
  // scale + vertical offset minimizing the mean suit-to-body nearest distance
  // over vertex samples. Shape-aware, decoration-immune.
  const allPos = Float32Array.from(tris.flatMap((t) => [...t.pos]));
  let cx = 0;
  let cz = 0;
  let suitMinY = Infinity;
  let suitMaxY = -Infinity;
  const n = allPos.length / 3;
  for (let i = 0; i < allPos.length; i += 3) {
    cx += allPos[i];
    cz += allPos[i + 2];
    if (allPos[i + 1] < suitMinY) suitMinY = allPos[i + 1];
    if (allPos[i + 1] > suitMaxY) suitMaxY = allPos[i + 1];
  }
  cx /= n;
  cz /= n;
  const segArrays = [...body.segments.values()].map((sg) => sg.positions);
  const bodyBox = bounds(segArrays);
  const bodyH = bodyBox.max[1] - bodyBox.min[1];
  const bodyCloud = samplePoints(Float32Array.from(segArrays.flatMap((a) => [...a])), 1500);
  const suitSample = samplePoints(allPos, 400);
  const s0 = bodyH / Math.max(suitMaxY - suitMinY, 1e-6);
  let best = { s: s0, dy: 0, cost: Infinity };
  for (let si = 0; si < 9; si++) {
    const s = s0 * (0.8 + 0.075 * si); // 0.8x .. 1.4x of the bbox guess
    for (let di = 0; di < 9; di++) {
      const dy = (-0.16 + 0.04 * di) * bodyH;
      let cost = 0;
      for (let i = 0; i < suitSample.length; i += 3) {
        const px = (suitSample[i] - cx) * s + bodyBox.center[0];
        const py = (suitSample[i + 1] - suitMinY) * s + bodyBox.min[1] + dy;
        const pz = (suitSample[i + 2] - cz) * s + bodyBox.center[2];
        let bd = Infinity;
        for (let j = 0; j < bodyCloud.length; j += 3) {
          const dx = px - bodyCloud[j];
          const dyy = py - bodyCloud[j + 1];
          const dz = pz - bodyCloud[j + 2];
          const d = dx * dx + dyy * dyy + dz * dz;
          if (d < bd) bd = d;
        }
        cost += Math.sqrt(bd);
      }
      if (cost < best.cost) best = { s, dy, cost };
    }
  }
  log(
    `auto-split: alignment s=${best.s.toFixed(3)} (bbox guess ${s0.toFixed(3)}), dy=${best.dy.toFixed(3)}, mean dist ${(best.cost / (suitSample.length / 3)).toFixed(4)}`,
  );
  const toBody = (p) => [
    (p[0] - cx) * best.s + bodyBox.center[0],
    (p[1] - suitMinY) * best.s + bodyBox.min[1] + best.dy,
    (p[2] - cz) * best.s + bodyBox.center[2],
  ];

  // Per-segment sampled point clouds for nearest-distance classification.
  const classes = [];
  for (const [segName, seg] of body.segments) {
    const slot = SLOT_OF_SEGMENT[segName];
    if (!slot) continue;
    classes.push({ slot, pts: samplePoints(seg.positions) });
  }
  if (!classes.length) throw new Error(`body ${char} has no classifiable segments`);

  const slotTris = new Map(); // slot -> tris
  for (const t of tris) {
    const p = toBody(t.centroid);
    let best = null;
    let bestD = Infinity;
    for (const c of classes) {
      const pts = c.pts;
      for (let i = 0; i < pts.length; i += 3) {
        const dx = p[0] - pts[i];
        const dy = p[1] - pts[i + 1];
        const dz = p[2] - pts[i + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = c.slot;
        }
      }
    }
    if (!slotTris.has(best)) slotTris.set(best, []);
    slotTris.get(best).push(t);
  }

  // Drop sub-1% noise slots (their tris are absorbed nowhere: tiny slivers).
  const minTris = Math.max(12, Math.floor(tris.length * 0.01));
  for (const [slot, list] of [...slotTris]) {
    if (list.length < minTris) {
      log(`auto-split: dropping slot ${slot} (${list.length} tris, below noise floor)`);
      slotTris.delete(slot);
    }
  }
  const summary = [...slotTris].map(([k, v]) => `${k}=${v.length}`).join(' ');
  log(`auto-split: ${summary}`);
  if (!slotTris.size) throw new Error('auto-split classified nothing (empty suit?)');

  // Rebuild IN the source document (materials + textures ride by reference):
  // one mesh per slot, one primitive per (slot, material) group, unindexed.
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const newNodes = [];
  for (const [slot, list] of slotTris) {
    const byMat = new Map();
    for (const t of list) {
      if (!byMat.has(t.mat)) byMat.set(t.mat, []);
      byMat.get(t.mat).push(t);
    }
    const mesh = doc.createMesh(slot);
    for (const [mat, group] of byMat) {
      const n = group.length;
      const posArr = new Float32Array(n * 9);
      const hasUv = group.every((t) => t.uv);
      const hasNrm = group.every((t) => t.nrm);
      const uvArr = hasUv ? new Float32Array(n * 6) : null;
      const nrmArr = hasNrm ? new Float32Array(n * 9) : null;
      group.forEach((t, i) => {
        posArr.set(t.pos, i * 9);
        if (uvArr) uvArr.set(t.uv, i * 6);
        if (nrmArr) nrmArr.set(t.nrm, i * 9);
      });
      const prim = doc.createPrimitive();
      prim.setAttribute(
        'POSITION',
        doc.createAccessor().setType('VEC3').setArray(posArr).setBuffer(buffer),
      );
      if (uvArr)
        prim.setAttribute(
          'TEXCOORD_0',
          doc.createAccessor().setType('VEC2').setArray(uvArr).setBuffer(buffer),
        );
      if (nrmArr)
        prim.setAttribute(
          'NORMAL',
          doc.createAccessor().setType('VEC3').setArray(nrmArr).setBuffer(buffer),
        );
      if (mat) prim.setMaterial(mat);
      mesh.addPrimitive(prim);
    }
    const node = doc.createNode(slot).setMesh(mesh);
    scene.addChild(node);
    newNodes.push(node);
  }
  // Remove the original fused nodes/meshes (the split nodes replace them).
  for (const node of meshNodes) {
    node.getMesh()?.dispose();
    node.dispose();
  }
  const { prune } = await import('@gltf-transform/functions');
  await doc.transform(prune({ keepLeaves: false }));
  await writeDoc(doc, outGlb);
  log(`auto-split: wrote ${outGlb} (${[...slotTris.keys()].join(', ')})`);
  return {
    slots: [...slotTris.keys()],
    triCounts: Object.fromEntries([...slotTris].map(([k, v]) => [k, v.length])),
  };
}
