// Body sculpt: brushes over the bare body meshes. Grab drags along the camera
// plane, inflate pushes along the stroke-start normals, smooth relaxes toward
// the neighbour average. Every stroke is one undo step. Save diffs the touched
// meshes against their loaded REST positions and POSTs per-part
// [restPos, delta] rows (glTF axes) to body_sculpt.json, keyed by POSITION,
// not index, so the Blender rebuild can re-apply them onto its own vertex
// order (and exporter-split duplicates move together for free).

import { current, deselect, state } from '/fit_studio/anchors.js';
import * as character from '/fit_studio/character.js';
import { history } from '/fit_studio/history.js';
import { btn, h, icon, section, segmented, sliderRow, switchRow, toast } from '/fit_studio/ui.js';
import { camera, orbit, renderer, scene } from '/fit_studio/viewport.js';
import { THREE } from '/three.bundle.js';

export const brush = { mode: 'grab', radius: 0.07, strength: 0.6, mirror: true };
export const sculptState = { active: false, dirty: false };

const rest = new Map(); // mesh -> Float32Array copy of the loaded positions
let drag = null;
const raycaster = new THREE.Raycaster();

function sculptMeshes() {
  const out = [];
  for (const part of character.BODY_PARTS) {
    for (const m of character.meshesByStem.get(`${character.charState.gender}_${part}`) ?? [])
      out.push(m);
  }
  return out;
}

function restOf(mesh) {
  if (!rest.has(mesh)) {
    rest.set(mesh, Float32Array.from(mesh.geometry.getAttribute('position').array));
  }
  return rest.get(mesh);
}

// ---------------------------------------------------------------------------
// Brush cursor ring
// ---------------------------------------------------------------------------
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(1, 0.012, 8, 48),
  new THREE.MeshBasicMaterial({
    color: 0xe3b869,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  }),
);
ring.visible = false;
ring.renderOrder = 10;
ring.userData.noFocus = true;
scene.add(ring);

function moveRing(e) {
  if (!sculptState.active) return;
  const hits = pointerRay(e).intersectObjects(sculptMeshes(), false);
  if (!hits.length) {
    ring.visible = false;
    return;
  }
  ring.visible = true;
  ring.position.copy(hits[0].point);
  const n = hits[0].face?.normal
    ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
    : camera.getWorldDirection(new THREE.Vector3()).negate();
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  ring.scale.setScalar(brush.radius);
}

// ---------------------------------------------------------------------------
// Enter / exit
// ---------------------------------------------------------------------------
export function enterSculpt() {
  deselect();
  sculptState.active = true;
  current.kind = 'sculpt';
  current.key = 'body';
  current.dirty = sculptState.dirty;
  character.setAnimation('');
  emit('selection');
}

export function exitSculpt() {
  if (!sculptState.active) return;
  sculptState.active = false;
  ring.visible = false;
  if (current.kind === 'sculpt') {
    current.kind = null;
    current.key = null;
  }
}

// ---------------------------------------------------------------------------
// Adjacency (for smooth): weld duplicated verts by position, neighbours from
// triangles. Built lazily per mesh, on the REST positions.
// ---------------------------------------------------------------------------
/** Weld duplicated verts by (rest) position and read neighbours off the
 *  triangles. Pure, the hair brush builds its own over the sculpt mesh. */
export function weldAdjacency(pos, geometry) {
  const count = pos.length / 3;
  const keyOf = (i) =>
    `${Math.round(pos[3 * i] * 5000)},${Math.round(pos[3 * i + 1] * 5000)},${Math.round(pos[3 * i + 2] * 5000)}`;
  const groupIds = new Map();
  const group = new Int32Array(count);
  const members = [];
  for (let i = 0; i < count; i++) {
    const k = keyOf(i);
    let g = groupIds.get(k);
    if (g === undefined) {
      g = members.length;
      groupIds.set(k, g);
      members.push([]);
    }
    group[i] = g;
    members[g].push(i);
  }
  const neighbors = members.map(() => new Set());
  const index = geometry.index;
  const triCount = index ? index.count / 3 : count / 3;
  const at = (t, c) => (index ? index.getX(3 * t + c) : 3 * t + c);
  for (let t = 0; t < triCount; t++) {
    const a = group[at(t, 0)];
    const b = group[at(t, 1)];
    const c = group[at(t, 2)];
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }
  for (let g = 0; g < neighbors.length; g++) neighbors[g].delete(g);
  return { group, members, neighbors };
}

const adjacency = new Map(); // mesh -> weldAdjacency result
function adjacencyOf(mesh) {
  if (!adjacency.has(mesh)) adjacency.set(mesh, weldAdjacency(restOf(mesh), mesh.geometry));
  return adjacency.get(mesh);
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

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!sculptState.active || e.button !== 0) return;
  const hits = pointerRay(e).intersectObjects(sculptMeshes(), false);
  if (!hits.length) return;
  const hit = hits[0].point.clone();
  const radius = brush.radius;
  const mhit = hit.clone();
  mhit.x = -mhit.x;
  const grab = [];
  const beforeByMesh = new Map();
  for (const mesh of sculptMeshes()) {
    restOf(mesh);
    const pos = mesh.geometry.getAttribute('position');
    const nor = mesh.geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const dD = p.distanceTo(hit);
      const dM = brush.mirror ? p.distanceTo(mhit) : Infinity;
      if (dD >= radius && dM >= radius) continue;
      grab.push({
        mesh,
        i,
        start: p,
        n: new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)),
        wD: falloff(dD, radius),
        wM: falloff(dM, radius),
      });
      if (!beforeByMesh.has(mesh)) {
        beforeByMesh.set(mesh, Float32Array.from(mesh.geometry.getAttribute('position').array));
      }
    }
  }
  if (!grab.length) return;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()).negate(),
    hit,
  );
  drag = { grab, plane, hit, beforeByMesh, inflate: 0, lastY: e.clientY };
  orbit.enabled = false;
  e.preventDefault();
});

function applyGrab(delta) {
  const mDelta = delta.clone();
  mDelta.x = -mDelta.x;
  const touched = new Set();
  for (const g of drag.grab) {
    // direct + mirrored contributions, normalised so the midline never
    // double-moves: at x=0 the two halves average (x cancels, y/z kept once)
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

function applyInflate() {
  const touched = new Set();
  for (const g of drag.grab) {
    const w = Math.max(g.wD, g.wM);
    const amt = drag.inflate * brush.strength * w;
    const pos = g.mesh.geometry.getAttribute('position');
    pos.setXYZ(g.i, g.start.x + g.n.x * amt, g.start.y + g.n.y * amt, g.start.z + g.n.z * amt);
    touched.add(g.mesh);
  }
  for (const m of touched) m.geometry.getAttribute('position').needsUpdate = true;
}

function applySmooth() {
  const k = brush.strength * 0.22;
  const touched = new Set();
  // group by mesh so we read each position buffer once per event
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
    touched.add(mesh);
  }
}

renderer.domElement.addEventListener('pointermove', (e) => {
  moveRing(e);
  if (!drag) return;
  if (brush.mode === 'grab') {
    const p = new THREE.Vector3();
    if (!pointerRay(e).ray.intersectPlane(drag.plane, p)) return;
    applyGrab(p.sub(drag.hit).multiplyScalar(brush.strength));
  } else if (brush.mode === 'inflate') {
    drag.inflate += (drag.lastY - e.clientY) * 0.0006;
    drag.lastY = e.clientY;
    applyInflate();
  } else if (brush.mode === 'smooth') {
    applySmooth();
  }
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const touched = new Set(drag.grab.map((g) => g.mesh));
  for (const m of touched) m.geometry.computeVertexNormals();
  const beforeByMesh = drag.beforeByMesh;
  drag = null;
  orbit.enabled = true;
  const afterByMesh = new Map();
  let changed = false;
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
  sculptState.dirty = true;
  if (current.kind === 'sculpt') current.dirty = true;
  const restore = (byMesh) => {
    for (const [mesh, arr] of byMesh) {
      mesh.geometry.getAttribute('position').array.set(arr);
      mesh.geometry.getAttribute('position').needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
    sculptState.dirty = true;
    if (current.kind === 'sculpt') current.dirty = true;
    emit('dirty');
  };
  history.push({
    label: `sculpt ${brush.mode}`,
    undo: () => restore(beforeByMesh),
    redo: () => restore(afterByMesh),
  });
  emit('dirty');
});

// ---------------------------------------------------------------------------
// Save / clear / re-apply
// ---------------------------------------------------------------------------
export function deltaSummary() {
  let rows = 0;
  const parts = new Set();
  for (const [mesh, r] of rest) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const d =
        Math.abs(pos.getX(i) - r[3 * i]) +
        Math.abs(pos.getY(i) - r[3 * i + 1]) +
        Math.abs(pos.getZ(i) - r[3 * i + 2]);
      if (d >= 5e-4) {
        rows++;
        parts.add(mesh.name.replace(/_\d+$/, ''));
      }
    }
  }
  return { rows, parts: [...parts] };
}

export async function saveSculptNow() {
  const byPart = new Map();
  for (const [mesh, r] of rest) {
    const stem = mesh.name.replace(/_\d+$/, '');
    const pos = mesh.geometry.getAttribute('position');
    const rows = byPart.get(stem) ?? [];
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - r[3 * i];
      const dy = pos.getY(i) - r[3 * i + 1];
      const dz = pos.getZ(i) - r[3 * i + 2];
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 5e-4) continue;
      rows.push([r[3 * i], r[3 * i + 1], r[3 * i + 2], dx, dy, dz]);
    }
    byPart.set(stem, rows);
  }
  let saved = 0;
  for (const [part, entries] of byPart) {
    const res = await fetch('/api/fit/sculpt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part, entries }),
    });
    const out = await res.json();
    if (out.error) {
      toast(`Sculpt save failed: ${out.error}`, 'bad');
      return;
    }
    saved += entries.length;
    if (entries.length) state.sculpt[part] = entries;
    else delete state.sculpt[part];
  }
  sculptState.dirty = false;
  if (current.kind === 'sculpt') current.dirty = false;
  toast(`Sculpt saved, ${saved} vertex deltas. Rebuild applies them.`, 'good');
  emit('selection');
}

export async function clearSculpt() {
  const res = await fetch('/api/fit/sculpt-reset', { method: 'POST' });
  const out = await res.json();
  if (out.error) {
    toast(`Clear failed: ${out.error}`, 'bad');
    return;
  }
  for (const [mesh, r] of rest) {
    mesh.geometry.getAttribute('position').array.set(r);
    mesh.geometry.getAttribute('position').needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
  state.sculpt = {};
  sculptState.dirty = false;
  if (current.kind === 'sculpt') current.dirty = false;
  toast('Sculpt cleared (viewer and body_sculpt.json)');
  emit('selection');
}

/** Re-apply saved sculpt deltas to the freshly loaded body, matching by rest
 *  position, the same rule the Blender side uses. */
export function applySavedSculpt(parts) {
  for (const [part, entries] of Object.entries(parts ?? {})) {
    for (const mesh of character.meshesByStem.get(part) ?? []) {
      const r = restOf(mesh);
      const pos = mesh.geometry.getAttribute('position');
      let n = 0;
      for (const [rx, ry, rz, dx, dy, dz] of entries) {
        for (let i = 0; i < pos.count; i++) {
          if (
            Math.abs(r[3 * i] - rx) < 1.5e-3 &&
            Math.abs(r[3 * i + 1] - ry) < 1.5e-3 &&
            Math.abs(r[3 * i + 2] - rz) < 1.5e-3
          ) {
            pos.setXYZ(i, r[3 * i] + dx, r[3 * i + 1] + dy, r[3 * i + 2] + dz);
            n++;
          }
        }
      }
      if (n) {
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function buildSculptPanel(host) {
  const { rows, parts } = deltaSummary();
  host.append(
    h(
      'div',
      { class: 'selcard' },
      icon('body', 18),
      h('div', {}, h('div', { class: 'kind' }, 'Body'), h('div', { class: 'name' }, 'Sculpt')),
      sculptState.dirty
        ? h('span', { class: 'badge dirty' }, 'unsaved')
        : rows
          ? h('span', { class: 'badge saved' }, `${rows} deltas`)
          : h('span', { class: 'badge new' }, 'untouched'),
    ),
  );

  const bSec = section('sculpt-brush', 'Brush', { open: true });
  const modeSeg = segmented(
    [
      { value: 'grab', label: 'Grab', tip: 'Pull along the view plane' },
      { value: 'inflate', label: 'Inflate', tip: 'Drag up = out, down = in' },
      { value: 'smooth', label: 'Smooth', tip: 'Relax toward neighbours' },
    ],
    brush.mode,
    (v) => (brush.mode = v),
  );
  bSec.body.append(
    h('div', { class: 'row' }, h('label', {}, 'Mode'), h('span', { class: 'grow' }), modeSeg.root),
  );
  bSec.body.append(
    sliderRow({
      label: 'Radius',
      min: 0.02,
      max: 0.2,
      step: 0.005,
      value: brush.radius,
      onInput: (v) => (brush.radius = v),
    }).root,
  );
  bSec.body.append(
    sliderRow({
      label: 'Strength',
      min: 0.05,
      max: 1,
      step: 0.05,
      value: brush.strength,
      onInput: (v) => (brush.strength = v),
    }).root,
  );
  bSec.body.append(
    switchRow({ label: 'Mirror X', value: brush.mirror, onChange: (v) => (brush.mirror = v) }).root,
  );
  bSec.body.append(
    h(
      'div',
      { class: 'note' },
      `Strokes affect the ${character.charState.gender === 'M' ? 'male' : 'female'} body currently shown; deltas are keyed by rest position. Each stroke is one undo step (⌘Z).`,
    ),
  );
  host.append(bSec.root);

  if (parts.length) {
    const pSec = section('sculpt-parts', 'Touched parts', { open: false });
    pSec.body.append(h('div', { class: 'note' }, parts.join(', ')));
    host.append(pSec.root);
  }

  host.append(
    h(
      'div',
      { class: 'actions' },
      btn({ ic: 'save', label: 'Save sculpt', kind: 'primary', onClick: saveSculptNow }),
      btn({
        ic: 'trash',
        label: 'Clear',
        kind: 'danger',
        tip: 'Reset the file and the view',
        onClick: clearSculpt,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const listeners = new Set();
function emit(what) {
  for (const fn of listeners) fn(what);
}
export function onSculptChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
