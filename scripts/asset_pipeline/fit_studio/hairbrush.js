// Shape brushes for the SELECTED hair sculpt: grab (drag along the view
// plane) and smooth (relax toward neighbours), mirrored across the sculpt's
// own midline. Every sculpt in the set mirrors about its local x=0 (measured
// in hairimp.py), so symmetry is a plain x-flip in SCULPT-LOCAL space, the
// brush works in that space throughout, converting the world-space hit and
// drag through the live anchor transform.
//
// Edits are stored as per-style rows of [restX, restY, restZ, dX, dY, dZ] in
// the sculpt's local glTF axes, keyed by rest position (the body_sculpt.json
// contract): Save posts them to /api/fit/hair-sculpt and hairimp.py's
// apply_hair_sculpt reshapes the imported sculpt before the seat/cut chain,
// so the game builds exactly what the brush showed.

import * as anchors from '/fit_studio/anchors.js';
import * as character from '/fit_studio/character.js';
import { history } from '/fit_studio/history.js';
import { weldAdjacency } from '/fit_studio/sculpt.js';
import { btn, h, section, segmented, sliderRow, switchRow, toast } from '/fit_studio/ui.js';
import { camera, orbit, renderer, scene } from '/fit_studio/viewport.js';
import { THREE } from '/three.bundle.js';

export const hairBrush = {
  active: false,
  mode: 'grab',
  radius: 0.05,
  strength: 0.6,
  symmetry: true,
};

let style = null; // the selected hair style the meshes belong to
let meshes = [];
const rests = new Map(); // mesh -> Float32Array of RAW loaded positions
/** mesh -> Float32Array of the sculpt's OWN loaded normals, so a deform can
 *  put them back instead of inventing new ones (see refreshNormals). */
const restNormals = new Map();
const adjacency = new Map(); // mesh -> weldAdjacency over the rest positions
const workingShape = new Map(); // style -> rows, unsaved edits kept across switches
export const shapeDirty = new Set(); // styles with unsaved shape edits
let drag = null;
const raycaster = new THREE.Raycaster();

// ---------------------------------------------------------------------------
// Selection lifecycle (wired via anchors.setHairLoadedHook)
// ---------------------------------------------------------------------------
export function onHairLoaded(styleKey, list, savedRows) {
  style = styleKey;
  meshes = list;
  rests.clear();
  adjacency.clear();
  drag = null;
  resetDeform();
  restNormals.clear();
  for (const m of meshes) {
    rests.set(m, Float32Array.from(m.geometry.getAttribute('position').array));
    const n = m.geometry.getAttribute('normal');
    if (n) restNormals.set(m, Float32Array.from(n.array));
  }
  const rows = workingShape.get(styleKey) ?? savedRows;
  if (rows?.length) {
    const n = applyRows(rows);
    if (n) toast(`${styleKey}: shape tweak applied (${rows.length} deltas)`);
  }
  if (hairBrush.active) suppressGizmo(true);
}

/** Re-apply rows onto the freshly loaded mesh by rest-position match, the
 *  same bucketed rule apply_hair_sculpt uses in Blender. */
function applyRows(rows, tol = 2e-3) {
  const cell = tol * 2;
  let applied = 0;
  for (const mesh of meshes) {
    const rest = rests.get(mesh);
    const pos = mesh.geometry.getAttribute('position');
    const buckets = new Map();
    const keyOf = (x, y, z) =>
      `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
    for (let i = 0; i < pos.count; i++) {
      const k = keyOf(rest[3 * i], rest[3 * i + 1], rest[3 * i + 2]);
      let arr = buckets.get(k);
      if (!arr) {
        arr = [];
        buckets.set(k, arr);
      }
      arr.push(i);
    }
    for (const [rx, ry, rz, dx, dy, dz] of rows) {
      const bx = Math.round(rx / cell);
      const by = Math.round(ry / cell);
      const bz = Math.round(rz / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            for (const i of buckets.get(`${bx + ox},${by + oy},${bz + oz}`) ?? []) {
              if (
                Math.abs(rest[3 * i] - rx) < tol &&
                Math.abs(rest[3 * i + 1] - ry) < tol &&
                Math.abs(rest[3 * i + 2] - rz) < tol
              ) {
                pos.setXYZ(i, rest[3 * i] + dx, rest[3 * i + 1] + dy, rest[3 * i + 2] + dz);
                applied++;
              }
            }
          }
        }
      }
    }
    if (applied) {
      pos.needsUpdate = true;
      refreshNormals(mesh);
    }
  }
  return applied;
}

/** Keep the sculpt's OWN normals, whatever the brush did to the positions.
 *
 *  Measured on a freshly loaded sculpt, the authored normals and what
 *  computeVertexNormals() produces from the same topology disagree by up to
 *  1.26 per component -- on unit vectors that is close to opposite. So there
 *  is no version of "recompute" that is cheap here:
 *
 *    - recomputing the WHOLE mesh re-shades every untouched strand at once,
 *      which is what made a single dab turn the style pale and flat;
 *    - recomputing only the moved vertices leaves authored normals meeting
 *      computed ones mid-face, and a ~1.26 step across one triangle is a
 *      blown-out white facet -- the same bug, smaller and sharper.
 *
 *  Since these normals are display-only in the studio (the saved rows are
 *  position deltas, and hairimp.py computes its own at build time), the honest
 *  answer is to leave the artist's normals alone. Lighting then does not
 *  follow a large deformation exactly, but brush edits here are fit tweaks,
 *  and a slightly stale highlight beats a mesh that changes colour. Only a
 *  sculpt that shipped with no normals at all has to have some invented. */
function refreshNormals(mesh) {
  const authored = restNormals.get(mesh);
  const attr = mesh.geometry.getAttribute('normal');
  if (!authored || !attr || authored.length !== attr.array.length) {
    mesh.geometry.computeVertexNormals();
    return;
  }
  attr.array.set(authored);
  attr.needsUpdate = true;
}

/** Diff the current positions against rest → save rows (sculpt-local). */
function diffRows() {
  const rows = [];
  for (const mesh of meshes) {
    const rest = rests.get(mesh);
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - rest[3 * i];
      const dy = pos.getY(i) - rest[3 * i + 1];
      const dz = pos.getZ(i) - rest[3 * i + 2];
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-4) continue;
      rows.push([rest[3 * i], rest[3 * i + 1], rest[3 * i + 2], dx, dy, dz]);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Activation, the gizmo yields while the brush is live
// ---------------------------------------------------------------------------
function suppressGizmo(on) {
  anchors.gizmo.enabled = !on;
  const helper = anchors.gizmo.getHelper ? anchors.gizmo.getHelper() : anchors.gizmo;
  helper.visible = !on;
}

export function setActive(on) {
  if (on && anchors.current.kind !== 'hair') return;
  hairBrush.active = on;
  suppressGizmo(on);
  if (!on) {
    ring.visible = false;
    drag = null;
  }
  anchors.renderFitPanel();
}

// ---------------------------------------------------------------------------
// Brush ring
// ---------------------------------------------------------------------------
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(1, 0.014, 8, 48),
  new THREE.MeshBasicMaterial({
    color: 0x74c9c1,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  }),
);
ring.visible = false;
ring.renderOrder = 10;
ring.userData.noFocus = true;
scene.add(ring);

function moveRing(hit) {
  if (!hit) {
    ring.visible = false;
    return;
  }
  ring.visible = true;
  ring.position.copy(hit.point);
  const n = hit.face?.normal
    ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    : camera.getWorldDirection(new THREE.Vector3()).negate();
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  ring.scale.setScalar(hairBrush.radius);
}

// ---------------------------------------------------------------------------
// Stroke
// ---------------------------------------------------------------------------
function pointerRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster;
}

const falloff = (d, radius) => {
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return t * t * (3 - 2 * t);
};

function castHair(e) {
  if (!meshes.length) return null;
  scene.updateMatrixWorld(true);
  const hits = pointerRay(e).intersectObjects(meshes, false);
  return hits.length ? hits[0] : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!hairBrush.active || anchors.current.kind !== 'hair' || e.button !== 0) return;
  if (character.charState.anim) {
    toast('Stop the animation to sculpt hair', 'warn');
    return;
  }
  const hit = castHair(e);
  if (!hit) return;
  const mesh = hit.object;
  const inv = mesh.matrixWorld.clone().invert();
  const worldScale = mesh.getWorldScale(new THREE.Vector3());
  const scale = Math.max(
    1e-6,
    (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3,
  );
  const hitLocal = hit.point.clone().applyMatrix4(inv);
  const mirrorLocal = hitLocal.clone();
  mirrorLocal.x = -mirrorLocal.x;
  const localRadius = hairBrush.radius / scale;
  const grab = [];
  const beforeByMesh = new Map();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const dD = p.distanceTo(hitLocal);
      const dM = hairBrush.symmetry ? p.distanceTo(mirrorLocal) : Infinity;
      if (dD >= localRadius && dM >= localRadius) continue;
      grab.push({
        mesh: m,
        i,
        start: p,
        wD: falloff(dD, localRadius),
        wM: falloff(dM, localRadius),
      });
      if (!beforeByMesh.has(m)) {
        beforeByMesh.set(m, Float32Array.from(m.geometry.getAttribute('position').array));
      }
    }
  }
  if (!grab.length) return;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()).negate(),
    hit.point,
  );
  drag = { grab, plane, hitWorld: hit.point.clone(), hitLocal, inv, localRadius, beforeByMesh };
  orbit.enabled = false;
  e.preventDefault();
});

function applyGrab(worldPoint) {
  // World drag → sculpt-local delta, exactly (rotation AND scale), by mapping
  // both endpoints through the same inverse matrix.
  const movedLocal = worldPoint.clone().applyMatrix4(drag.inv);
  const delta = movedLocal.sub(drag.hitLocal).multiplyScalar(hairBrush.strength);
  const mDelta = delta.clone();
  mDelta.x = -mDelta.x;
  const touched = new Set();
  for (const g of drag.grab) {
    // direct + mirrored contributions, normalised so the midline never
    // double-moves (the body brush's rule)
    const wSum = g.wD + g.wM || 1e-9;
    const wMax = Math.max(g.wD, g.wM);
    const dx = ((g.wD * delta.x + g.wM * mDelta.x) / wSum) * wMax;
    const dy = ((g.wD * delta.y + g.wM * mDelta.y) / wSum) * wMax;
    const dz = ((g.wD * delta.z + g.wM * mDelta.z) / wSum) * wMax;
    const pos = g.mesh.geometry.getAttribute('position');
    pos.setXYZ(g.i, g.start.x + dx, g.start.y + dy, g.start.z + dz);
    touched.add(g.mesh);
  }
  for (const m of touched) m.geometry.getAttribute('position').needsUpdate = true;
}

function adjacencyOf(mesh) {
  if (!adjacency.has(mesh)) adjacency.set(mesh, weldAdjacency(rests.get(mesh), mesh.geometry));
  return adjacency.get(mesh);
}

function applySmooth() {
  const k = hairBrush.strength * 0.2;
  const byMesh = new Map();
  for (const g of drag.grab) {
    if (!byMesh.has(g.mesh)) byMesh.set(g.mesh, []);
    byMesh.get(g.mesh).push(g);
  }
  for (const [mesh, list] of byMesh) {
    const adj = adjacencyOf(mesh);
    const pos = mesh.geometry.getAttribute('position');
    const next = [];
    for (const g of list) {
      const gi = adj.group[g.i];
      const ns = adj.neighbors[gi];
      if (!ns.size) continue;
      const avg = new THREE.Vector3();
      for (const ng of ns) {
        const j = adj.members[ng][0];
        avg.x += pos.getX(j);
        avg.y += pos.getY(j);
        avg.z += pos.getZ(j);
      }
      avg.multiplyScalar(1 / ns.size);
      const w = Math.max(g.wD, g.wM) * k;
      next.push([
        g.i,
        THREE.MathUtils.lerp(pos.getX(g.i), avg.x, w),
        THREE.MathUtils.lerp(pos.getY(g.i), avg.y, w),
        THREE.MathUtils.lerp(pos.getZ(g.i), avg.z, w),
      ]);
    }
    for (const [i, x, y, z] of next) pos.setXYZ(i, x, y, z);
    pos.needsUpdate = true;
  }
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!hairBrush.active || anchors.current.kind !== 'hair') return;
  if (!drag) {
    moveRing(castHair(e));
    return;
  }
  if (hairBrush.mode === 'grab') {
    const p = new THREE.Vector3();
    if (!pointerRay(e).ray.intersectPlane(drag.plane, p)) return;
    moveRing(null);
    applyGrab(p);
  } else {
    applySmooth();
  }
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const beforeByMesh = drag.beforeByMesh;
  const touched = new Set(drag.grab.map((g) => g.mesh));
  drag = null;
  orbit.enabled = true;
  for (const m of touched) refreshNormals(m);
  let changed = false;
  const afterByMesh = new Map();
  for (const [mesh, before] of beforeByMesh) {
    const now = mesh.geometry.getAttribute('position').array;
    afterByMesh.set(mesh, Float32Array.from(now));
    if (!changed) {
      for (let i = 0; i < now.length; i++) {
        if (Math.abs(now[i] - before[i]) > 1e-7) {
          changed = true;
          break;
        }
      }
    }
  }
  if (!changed) return;
  const styleAt = style;
  const rowsBefore = workingShape.get(styleAt) ?? null;
  const dirtyBefore = shapeDirty.has(styleAt);
  workingShape.set(styleAt, diffRows());
  shapeDirty.add(styleAt);
  anchors.markEdited();
  const rowsAfter = workingShape.get(styleAt);
  // Undo restores BOTH the live vertex arrays (when this style is still the
  // selection) and the working-row maps (always), so undoing a stroke after
  // switching styles still takes effect the moment the style is reopened.
  const restore = (byMesh, rows, dirty) => {
    if (style === styleAt) {
      for (const [mesh, arr] of byMesh) {
        mesh.geometry.getAttribute('position').array.set(arr);
        mesh.geometry.getAttribute('position').needsUpdate = true;
        refreshNormals(mesh);
      }
      anchors.markEdited();
    }
    if (rows) workingShape.set(styleAt, rows);
    else workingShape.delete(styleAt);
    if (dirty) shapeDirty.add(styleAt);
    else shapeDirty.delete(styleAt);
  };
  history.push({
    label: `hair ${hairBrush.mode} ${styleAt}`,
    undo: () => restore(beforeByMesh, rowsBefore, dirtyBefore),
    redo: () => restore(afterByMesh, rowsAfter, true),
  });
});

// ---------------------------------------------------------------------------
// Save / reset (wired via anchors.setHairShapeSaver + the panel)
// ---------------------------------------------------------------------------
export async function saveShape(styleKey) {
  settleDeform(); // sway must never bake into the saved rows
  if (!shapeDirty.has(styleKey)) return;
  const entries = workingShape.get(styleKey) ?? [];
  const res = await fetch('/api/fit/hair-sculpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style: styleKey, entries }),
  });
  const out = await res.json();
  if (out.error) {
    toast(`Shape save failed: ${out.error}`, 'bad');
    return;
  }
  if (entries.length) anchors.state.hairSculpt[styleKey] = entries;
  else delete anchors.state.hairSculpt[styleKey];
  workingShape.delete(styleKey);
  shapeDirty.delete(styleKey);
  if (entries.length) toast(`Shape saved, ${entries.length} vertex deltas`, 'good');
}

export async function resetShape() {
  settleDeform();
  const styleKey = style;
  if (!styleKey) return;
  const res = await fetch('/api/fit/hair-sculpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style: styleKey, entries: [] }),
  });
  const out = await res.json();
  if (out.error) {
    toast(`Reset failed: ${out.error}`, 'bad');
    return;
  }
  for (const mesh of meshes) {
    mesh.geometry.getAttribute('position').array.set(rests.get(mesh));
    mesh.geometry.getAttribute('position').needsUpdate = true;
    refreshNormals(mesh);
  }
  workingShape.delete(styleKey);
  shapeDirty.delete(styleKey);
  delete anchors.state.hairSculpt[styleKey];
  toast(`${styleKey}: shape back to the raw sculpt`);
  anchors.renderFitPanel();
}

// ---------------------------------------------------------------------------
// Sway deformation during animation preview
// ---------------------------------------------------------------------------
// NOT a rigid wobble (that read as a tilting helmet): a per-vertex bend that
// leaves the scalp untouched and ramps toward the tips, the same shape the
// baked hair_sway morphs give built styles. Weights follow the game's rule,
// zero above character height RAMP_TOP, rising to 1 at the sculpt's lowest
// point, and a style with too little hanging length doesn't move at all.
// A no-clip guard keeps displaced verts from entering the head/neck/torso:
// each vertex may never end up DEEPER inside a guard sphere than it started.
const RAMP_TOP = 1.52; // character height the bend starts below (the game's)
const LOW_Y = 1.34; // a style needs enough verts below this to sway at all
const MIN_LOW_VERTS = 24;
const TIP_EXP = 1.8; // weight curve, the very tips carry most of the motion
const LAT_AMP = 0.05; // metres of lateral drift at a full-run swing, at the tip
const BACK_AMP = 0.09; // metres of backward stream at full run, at the tip
const GUARDS = [
  { c: new THREE.Vector3(0, 1.8, 0.02), r: 0.66 }, // skull
  { c: new THREE.Vector3(0, 1.38, 0.1), r: 0.54 }, // face/jaw
  { c: new THREE.Vector3(0, 0.95, 0.05), r: 0.46 }, // neck/chest
];

const deform = {
  active: false,
  key: '', // effectiveMatrix fingerprint the cache was built for
  eligible: false,
  base: new Map(), // mesh -> Float32Array local positions at deform start
  charRest: new Map(), // mesh -> Float32Array rest positions in character space
  weights: new Map(), // mesh -> Float32Array per-vertex tip weights
  inv: new Map(), // mesh -> Matrix4 character->local
};

function resetDeform() {
  deform.active = false;
  deform.key = '';
  deform.eligible = false;
  deform.base.clear();
  deform.charRest.clear();
  deform.weights.clear();
  deform.inv.clear();
}

/** Restore the un-deformed positions (post-brush state). Called before any
 *  diff/save and when the clip stops, so sway never bakes into anything. */
export function settleDeform() {
  if (!deform.active) return;
  for (const [mesh, arr] of deform.base) {
    const pos = mesh.geometry.getAttribute('position');
    pos.array.set(arr);
    pos.needsUpdate = true;
  }
  deform.active = false;
}

const D_M = new THREE.Matrix4();
const D_V = new THREE.Vector3();

function buildDeformCache(key) {
  deform.key = key;
  deform.charRest.clear();
  deform.weights.clear();
  deform.inv.clear();
  scene.updateMatrixWorld(true);
  const invFollow = D_M.copy(anchors.follow.matrix).invert();
  let minY = Infinity;
  let lowCount = 0;
  const charAll = [];
  for (const mesh of meshes) {
    const toChar = invFollow.clone().multiply(mesh.matrixWorld);
    const base = deform.base.get(mesh) ?? mesh.geometry.getAttribute('position').array;
    const n = base.length / 3;
    const char = new Float32Array(base.length);
    for (let i = 0; i < n; i++) {
      D_V.set(base[3 * i], base[3 * i + 1], base[3 * i + 2]).applyMatrix4(toChar);
      char[3 * i] = D_V.x;
      char[3 * i + 1] = D_V.y;
      char[3 * i + 2] = D_V.z;
      if (D_V.y < minY) minY = D_V.y;
      if (D_V.y < LOW_Y) lowCount++;
    }
    deform.charRest.set(mesh, char);
    deform.inv.set(mesh, toChar.clone().invert());
    charAll.push([mesh, char]);
  }
  const hangDen = RAMP_TOP - minY;
  deform.eligible = lowCount >= MIN_LOW_VERTS && hangDen > 0.12;
  if (!deform.eligible) return;
  for (const [mesh, char] of charAll) {
    const n = char.length / 3;
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = (RAMP_TOP - char[3 * i + 1]) / hangDen;
      w[i] = t <= 0 ? 0 : Math.min(1, t) ** TIP_EXP;
    }
    deform.weights.set(mesh, w);
  }
}

/** Per-frame: bend the fitted sculpt's hanging length with the gait. */
export function tickHairSway() {
  const animOn = !!character.charState.anim;
  if (!animOn || anchors.current.kind !== 'hair' || !meshes.length || drag) {
    settleDeform();
    return;
  }
  const m0 = anchors.effectiveMatrix().elements;
  const key = m0.map((v) => Math.round(v * 1e5)).join(',');
  if (!deform.active) {
    // First deformed frame: snapshot the positions to restore later.
    deform.base.clear();
    for (const mesh of meshes) {
      deform.base.set(mesh, Float32Array.from(mesh.geometry.getAttribute('position').array));
    }
    deform.active = true;
    deform.key = '';
  }
  if (deform.key !== key) buildDeformCache(key);
  if (!deform.eligible) return;
  const lat = (character.swaySignal.lat / 0.5) * LAT_AMP;
  const back = (character.swaySignal.back / 0.62) * BACK_AMP;
  for (const mesh of meshes) {
    const char = deform.charRest.get(mesh);
    const w = deform.weights.get(mesh);
    const inv = deform.inv.get(mesh);
    const pos = mesh.geometry.getAttribute('position');
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const wi = w[i];
      if (wi <= 0) continue;
      let x = char[3 * i] + lat * wi;
      let y = char[3 * i + 1];
      let z = char[3 * i + 2] - back * wi;
      // No-clip: never deeper inside a guard sphere than the rest position.
      for (const g of GUARDS) {
        const dx = x - g.c.x;
        const dy = y - g.c.y;
        const dz = z - g.c.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rx = char[3 * i] - g.c.x;
        const ry = char[3 * i + 1] - g.c.y;
        const rz = char[3 * i + 2] - g.c.z;
        const dRest = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const dMin = Math.min(dRest, g.r);
        if (d < dMin && d > 1e-6) {
          const s = dMin / d;
          x = g.c.x + dx * s;
          y = g.c.y + dy * s;
          z = g.c.z + dz * s;
        }
      }
      D_V.set(x, y, z).applyMatrix4(inv);
      pos.setXYZ(i, D_V.x, D_V.y, D_V.z);
    }
    pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Panel (wired via anchors.setHairPanelExtra)
// ---------------------------------------------------------------------------
export function buildPanel(host) {
  const sec = section('fit-shape', 'Sculpt shape', { open: hairBrush.active });
  const toggle = btn({
    ic: 'brush',
    label: hairBrush.active ? 'Done sculpting' : 'Edit shape',
    kind: hairBrush.active ? 'primary' : '',
    onClick: () => setActive(!hairBrush.active),
  });
  sec.body.append(h('div', { class: 'actions' }, toggle));
  if (hairBrush.active) {
    const modeSeg = segmented(
      [
        { value: 'grab', label: 'Grab', tip: 'Pull along the view plane' },
        { value: 'smooth', label: 'Smooth', tip: 'Relax toward neighbours' },
      ],
      hairBrush.mode,
      (v) => (hairBrush.mode = v),
    );
    sec.body.append(
      h(
        'div',
        { class: 'row' },
        h('label', {}, 'Mode'),
        h('span', { class: 'grow' }),
        modeSeg.root,
      ),
    );
    sec.body.append(
      sliderRow({
        label: 'Radius',
        min: 0.01,
        max: 0.22,
        step: 0.005,
        value: hairBrush.radius,
        onInput: (v) => (hairBrush.radius = v),
      }).root,
    );
    sec.body.append(
      sliderRow({
        label: 'Strength',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: hairBrush.strength,
        onInput: (v) => (hairBrush.strength = v),
      }).root,
    );
    sec.body.append(
      switchRow({
        label: 'Symmetry',
        value: hairBrush.symmetry,
        onChange: (v) => (hairBrush.symmetry = v),
      }).root,
    );
    sec.body.append(
      h(
        'div',
        { class: 'note' },
        'Mirrored across the sculpt’s own midline. Each stroke is one undo step (⌘Z); the gizmo comes back when you’re done. Save commits seat and shape together.',
      ),
    );
  }
  const savedRows = anchors.state.hairSculpt?.[style]?.length ?? 0;
  const workRows = workingShape.get(style)?.length ?? 0;
  if (savedRows || workRows || shapeDirty.has(style)) {
    sec.body.append(
      h(
        'div',
        { class: 'note' },
        shapeDirty.has(style)
          ? `${workRows} unsaved shape deltas`
          : `${savedRows} shape deltas saved, the rebuild applies them`,
      ),
    );
    sec.body.append(
      h(
        'div',
        { class: 'actions' },
        btn({
          ic: 'trash',
          label: 'Reset shape',
          kind: 'danger',
          tip: 'Back to the raw sculpt (writes the file)',
          onClick: resetShape,
        }),
      ),
    );
  }
  host.append(sec.root);
}
