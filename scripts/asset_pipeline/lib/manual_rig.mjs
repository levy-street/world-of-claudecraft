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
// Weight solver: classic distance-to-bone-segment. Each joint owns the
// segments from itself to its children (leaf joints get a short synthetic
// segment: head up, toes forward); a vertex takes the K nearest segments
// weighted 1/d^4, with a laterality guard so .l bones never grab -X vertices
// and vice versa. Chibi bodies are blobby and forgiving, which is exactly why
// this simple solver has a chance of looking decent.
import { getBounds } from '@gltf-transform/core';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import { openGlb, saveGlb } from './glb.mjs';

const ROT = ([x, y, z]) => [-z, y, x]; // -90deg about Y: +X facing -> +Z facing

// General 4x4 inverse (column-major). Needed because the BIND pose lives in
// the inverse bind matrices: a rig's REST node pose is NOT necessarily its
// bind pose (true for the KayKit rigs, verified: jointWorld*IBM deviates by
// >1.0 on the legs), and skinned vertices must be authored in BIND space.
function inverse4(m) {
  const inv = new Array(16);
  inv[0] =
    m[5] * m[10] * m[15] -
    m[5] * m[11] * m[14] -
    m[9] * m[6] * m[15] +
    m[9] * m[7] * m[14] +
    m[13] * m[6] * m[11] -
    m[13] * m[7] * m[10];
  inv[4] =
    -m[4] * m[10] * m[15] +
    m[4] * m[11] * m[14] +
    m[8] * m[6] * m[15] -
    m[8] * m[7] * m[14] -
    m[12] * m[6] * m[11] +
    m[12] * m[7] * m[10];
  inv[8] =
    m[4] * m[9] * m[15] -
    m[4] * m[11] * m[13] -
    m[8] * m[5] * m[15] +
    m[8] * m[7] * m[13] +
    m[12] * m[5] * m[11] -
    m[12] * m[7] * m[9];
  inv[12] =
    -m[4] * m[9] * m[14] +
    m[4] * m[10] * m[13] +
    m[8] * m[5] * m[14] -
    m[8] * m[6] * m[13] -
    m[12] * m[5] * m[10] +
    m[12] * m[6] * m[9];
  inv[1] =
    -m[1] * m[10] * m[15] +
    m[1] * m[11] * m[14] +
    m[9] * m[2] * m[15] -
    m[9] * m[3] * m[14] -
    m[13] * m[2] * m[11] +
    m[13] * m[3] * m[10];
  inv[5] =
    m[0] * m[10] * m[15] -
    m[0] * m[11] * m[14] -
    m[8] * m[2] * m[15] +
    m[8] * m[3] * m[14] +
    m[12] * m[2] * m[11] -
    m[12] * m[3] * m[10];
  inv[9] =
    -m[0] * m[9] * m[15] +
    m[0] * m[11] * m[13] +
    m[8] * m[1] * m[15] -
    m[8] * m[3] * m[13] -
    m[12] * m[1] * m[11] +
    m[12] * m[3] * m[9];
  inv[13] =
    m[0] * m[9] * m[14] -
    m[0] * m[10] * m[13] -
    m[8] * m[1] * m[14] +
    m[8] * m[2] * m[13] +
    m[12] * m[1] * m[10] -
    m[12] * m[2] * m[9];
  inv[2] =
    m[1] * m[6] * m[15] -
    m[1] * m[7] * m[14] -
    m[5] * m[2] * m[15] +
    m[5] * m[3] * m[14] +
    m[13] * m[2] * m[7] -
    m[13] * m[3] * m[6];
  inv[6] =
    -m[0] * m[6] * m[15] +
    m[0] * m[7] * m[14] +
    m[4] * m[2] * m[15] -
    m[4] * m[3] * m[14] -
    m[12] * m[2] * m[7] +
    m[12] * m[3] * m[6];
  inv[10] =
    m[0] * m[5] * m[15] -
    m[0] * m[7] * m[13] -
    m[4] * m[1] * m[15] +
    m[4] * m[3] * m[13] +
    m[12] * m[1] * m[7] -
    m[12] * m[3] * m[5];
  inv[14] =
    -m[0] * m[5] * m[14] +
    m[0] * m[6] * m[13] +
    m[4] * m[1] * m[14] -
    m[4] * m[2] * m[13] -
    m[12] * m[1] * m[6] +
    m[12] * m[2] * m[5];
  inv[3] =
    -m[1] * m[6] * m[11] +
    m[1] * m[7] * m[10] +
    m[5] * m[2] * m[11] -
    m[5] * m[3] * m[10] -
    m[9] * m[2] * m[7] +
    m[9] * m[3] * m[6];
  inv[7] =
    m[0] * m[6] * m[11] -
    m[0] * m[7] * m[10] -
    m[4] * m[2] * m[11] +
    m[4] * m[3] * m[10] +
    m[8] * m[2] * m[7] -
    m[8] * m[3] * m[6];
  inv[11] =
    -m[0] * m[5] * m[11] +
    m[0] * m[7] * m[9] +
    m[4] * m[1] * m[11] -
    m[4] * m[3] * m[9] -
    m[8] * m[1] * m[7] +
    m[8] * m[3] * m[5];
  inv[15] =
    m[0] * m[5] * m[10] -
    m[0] * m[6] * m[9] -
    m[4] * m[1] * m[10] +
    m[4] * m[2] * m[9] +
    m[8] * m[1] * m[6] -
    m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-12) throw new Error('singular IBM');
  return inv.map((v) => v / det);
}

function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  let t = len2 > 1e-12 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Rig `rawGlbPath` onto `referenceGlbPath`'s skeleton; write to `outPath`.
 *  Options: yaw ('auto' -90deg default via preRotated=false), armY override.
 *  Returns a fit report. */
export async function manualRigOntoReference(rawGlbPath, referenceGlbPath, outPath, opts = {}) {
  const K = opts.influences ?? 4;
  const POW = opts.falloff ?? 4;

  // --- Reference rig: joints, bind-pose world positions, mesh bounds -------
  const doc = await openGlb(referenceGlbPath); // mutated in place, saved to outPath
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error('reference model has no skin');
  const joints = skin.listJoints();
  // BIND-pose joint positions from the inverse bind matrices: this is the
  // space skinned vertices must live in, NOT the rest-pose world space.
  const ibmArr = skin.getInverseBindMatrices().getArray();
  const jointPos = joints.map((_, i) => {
    const inv = inverse4(Array.from(ibmArr.slice(i * 16, (i + 1) * 16)));
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

  // Bone segments, attributed to the PROXIMAL joint. Skip root (whole-body
  // mover, no direct weights) and handslots (attachment-only).
  const segments = [];
  for (let i = 0; i < joints.length; i++) {
    const name = joints[i].getName();
    if (/^root$/i.test(name) || name.startsWith('handslot')) continue;
    const kids = joints[i].listChildren().filter((c) => byName.has(c.getName()));
    let any = false;
    for (const c of kids) {
      segments.push({ joint: i, a: jointPos[i], b: jointPos[byName.get(c.getName())] });
      any = true;
    }
    if (!any) {
      // Synthetic leaf segments, sized relative to the bind frame: the chibi
      // head is a big rigid blob above its joint; toes extend forward (+Z).
      const p = jointPos[i];
      const dir = name === 'head' ? [0, 0.4 * wristAbove, 0] : [0, 0, 0.05 * wristAbove];
      segments.push({ joint: i, a: p, b: [p[0] + dir[0], p[1] + dir[1], p[2] + dir[2]] });
    }
  }
  const sideGuard = 0.02 * wristAbove;
  const side = (i) => {
    const n = joints[i].getName();
    return n.endsWith('.l') ? 1 : n.endsWith('.r') ? -1 : 0;
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

  // Pass 2: final positions (feet at y=0, centered XZ) + weights.
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
  const built = rawPrims.map((prim, pi) => {
    const rot = rotatedPerPrim[pi];
    const n = rot.length / 3;
    report.verts += n;
    const pos = new Float32Array(rot.length);
    const jointsAttr = new Uint16Array(n * 4);
    const weightsAttr = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const p = [
        (rot[v * 3] - midX) * scale + centerX,
        (rot[v * 3 + 1] - min[1]) * scale + groundY,
        (rot[v * 3 + 2] - midZ) * scale + centerZ,
      ];
      pos[v * 3] = p[0];
      pos[v * 3 + 1] = p[1];
      pos[v * 3 + 2] = p[2];
      // Nearest segments with laterality guard (relative to the body axis).
      const lx = p[0] - centerX;
      const best = []; // {joint, w}
      for (const seg of segments) {
        const s = side(seg.joint);
        if (s === 1 && lx < -sideGuard) continue;
        if (s === -1 && lx > sideGuard) continue;
        const d = distToSegment(p, seg.a, seg.b);
        const w = 1 / (d ** POW + 1e-8);
        best.push({ joint: seg.joint, w });
      }
      best.sort((a, b) => b.w - a.w);
      // Merge duplicate joints among the top hits, then take K.
      const merged = [];
      for (const c of best) {
        const hit = merged.find((m) => m.joint === c.joint);
        if (hit) hit.w += c.w;
        else merged.push({ ...c });
        if (merged.length >= K && merged.length > 8) break;
      }
      merged.sort((a, b) => b.w - a.w);
      const top = merged.slice(0, K);
      const sum = top.reduce((s2, c) => s2 + c.w, 0) || 1;
      for (let k = 0; k < 4; k++) {
        jointsAttr[v * 4 + k] = top[k]?.joint ?? 0;
        weightsAttr[v * 4 + k] = (top[k]?.w ?? 0) / sum;
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
