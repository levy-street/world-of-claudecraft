// Placing hair sculpts, jewellery and hair bands on the character: the gizmo,
// the numeric transform panel, ghosts of the current build, the jewel material
// presets, dirty tracking, and save/reset against /api/fit. The matrix stored
// is the composed wrap·inner local matrix in glTF Y-up space,
// hairimp.anchor_matrix does the Blender-side conjugation; nothing here is
// pre-converted.

import * as character from '/fit_studio/character.js';
import { history } from '/fit_studio/history.js';
import {
  btn,
  h,
  icon,
  loadPrefs,
  numField,
  savePrefs,
  section,
  selectRow,
  sliderRow,
  swatchGrid,
  toast,
} from '/fit_studio/ui.js';
import { camera, orbit, renderer, scene } from '/fit_studio/viewport.js';
import { THREE, TransformControls } from '/three.bundle.js';

// ---------------------------------------------------------------------------
// Groups: follow ▸ wrap ▸ inner ▸ piece   (+ follow ▸ mirror for jewels)
// ---------------------------------------------------------------------------
// During animation preview the fitted piece rides the head bone: `follow`
// carries headWorld · headRest⁻¹ (identity when the animation is off), so the
// designer keeps authoring in REST space, the saved anchor never changes,
// while the piece visibly sticks to the moving head the way the skinned
// build will.
export const follow = new THREE.Group();
follow.matrixAutoUpdate = false;
scene.add(follow);
export const wrap = new THREE.Group(); // what the gizmo moves
const inner = new THREE.Group(); // pure translation putting the pivot at the
// piece's own centre, so Rotate turns the HAIR, not some sculpt-file origin
// off by the nose. The anchor saved is the COMPOSED wrap·inner matrix, so
// the pivot convenience never leaks into the stored transform.
wrap.add(inner);
follow.add(wrap);
const mirror = new THREE.Group(); // live preview of the build's left-side mirror
mirror.matrixAutoUpdate = false;
follow.add(mirror);
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

export function effectiveMatrix() {
  wrap.updateMatrix();
  inner.updateMatrix();
  return wrap.matrix.clone().multiply(inner.matrix);
}

/** Set wrap so that wrap·inner equals the given sculpt->character matrix. */
export function setEffectiveMatrix(matrixArray) {
  inner.updateMatrix();
  const m = new THREE.Matrix4().fromArray(matrixArray).multiply(inner.matrix.clone().invert());
  m.decompose(wrap.position, wrap.quaternion, wrap.scale);
  wrap.updateMatrix();
  syncPanel();
}

/** The scripted-hook variant: an explicit set counts as an edit. */
export function setEffectiveMatrixEdited(matrixArray) {
  setEffectiveMatrix(matrixArray);
  onEdited();
}

// ---------------------------------------------------------------------------
// Gizmo
// ---------------------------------------------------------------------------
export const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.85);
const gizmoHelper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
scene.add(gizmoHelper);
// The helper's picker meshes must never catch the double-click-to-focus ray.
gizmoHelper.traverse((o) => (o.userData.noFocus = true));

// `uniform` starts OFF: a sculpt almost always needs to be squashed onto the
// skull on one axis at a time, and locking the three together made the common
// case the one you had to turn a toggle off for. The toolbar button still locks
// them when a style genuinely wants a proportional resize.
export const gizmoState = { mode: 'translate', space: 'world', snap: false, uniform: false };

let dragStart = null; // {scale, matrix}
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (e.value) {
    dragStart = { scale: wrap.scale.clone(), matrix: effectiveMatrix().toArray() };
  } else if (dragStart) {
    const before = dragStart.matrix;
    dragStart = null;
    const after = effectiveMatrix().toArray();
    if (before.some((v, i) => Math.abs(v - after[i]) > 1e-9)) {
      pushTransformHistory('gizmo', before, after);
      onEdited();
    }
  }
});
gizmo.addEventListener('objectChange', () => {
  if (gizmo.mode === 'scale' && gizmoState.uniform && dragStart) {
    // One factor for all three axes, the factor of whichever axis the drag
    // moved furthest, so a squashed saved anchor scales without shearing.
    const s0 = dragStart.scale;
    const r = new THREE.Vector3(
      wrap.scale.x / (s0.x || 1e-9),
      wrap.scale.y / (s0.y || 1e-9),
      wrap.scale.z / (s0.z || 1e-9),
    );
    const f = [r.x, r.y, r.z].reduce(
      (a, b) =>
        Math.abs(Math.log(Math.abs(b) || 1)) > Math.abs(Math.log(Math.abs(a) || 1)) ? b : a,
      1,
    );
    wrap.scale.set(s0.x * f, s0.y * f, s0.z * f);
  }
  syncPanel();
  markDirtyLive();
});

export function setGizmoMode(mode) {
  gizmoState.mode = mode;
  gizmo.setMode(mode);
  emit('gizmo');
}
export function setGizmoSpace(space) {
  gizmoState.space = space;
  gizmo.setSpace(space);
  emit('gizmo');
}
export function setGizmoSnap(on) {
  gizmoState.snap = on;
  gizmo.setTranslationSnap(on ? 0.01 : null);
  gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(5) : null);
  gizmo.setScaleSnap(on ? 0.05 : null);
  emit('gizmo');
}
export function setUniformScale(on) {
  gizmoState.uniform = on;
  emit('gizmo');
}

// ---------------------------------------------------------------------------
// Selection state
// ---------------------------------------------------------------------------
export const current = { kind: null, key: null, dirty: false };
const working = new Map(); // `${kind}/${key}` -> {matrix, sway?, material?, tint?}
export let state = {
  hair: [],
  anchors: { hair: {}, jewel: {}, band: {} },
  characterGlb: null,
  sculpt: {},
  bands: {},
};
export function setState(s) {
  state = s;
}

export function anchorFor(kind, keyName) {
  return state.anchors?.[kind]?.[keyName] ?? null;
}
export function workingFor(kind, keyName) {
  return working.get(`${kind}/${keyName}`) ?? null;
}

const ghostOriginal = new Map(); // mesh -> original material, while ghosted
const hiddenBuilt = new Set(); // built H2 meshes hidden outright while fitting
let jewelPreviewMeshes = [];
let jewelAtlasMats = [];
let swayValue = 'auto';
let underhairValue = 'buzz'; // per-style scalp pattern, saved with the anchor
let jewelMaterial = { material: '', tint: { h: 0, l: 0 } };
let clipboard = null; // {kind, matrix}

// Twinned with UNDERHAIR_STYLES in src/render/characters/modular.ts and the
// allowlist in lib/fit_studio.mjs.
export const UNDERHAIR_OPTIONS = [
  { value: 'none', label: 'None (bare scalp)' },
  { value: 'buzz', label: 'Buzz: classic' },
  { value: 'crew', label: 'Crew: high line' },
  { value: 'solid', label: 'Solid' },
  { value: 'solid_high', label: 'Solid: high line' },
  { value: 'widow', label: 'Widow’s peak' },
  { value: 'receded', label: 'Receded temples' },
  { value: 'low_fade', label: 'Low fade' },
  { value: 'high_fade', label: 'High fade' },
  { value: 'sparse', label: 'Sparse stubble' },
  { value: 'horseshoe', label: 'Horseshoe' },
];

let beforeSelectHook = () => {};
export function setBeforeSelectHook(fn) {
  beforeSelectHook = fn;
}
// Injection points for the hair shape brush (hairbrush.js), wired by main.js
// so this module never has to import it.
let hairLoadedHook = () => {};
export function setHairLoadedHook(fn) {
  hairLoadedHook = fn;
}
let hairPanelExtra = null;
export function setHairPanelExtra(fn) {
  hairPanelExtra = fn;
}
let hairShapeSaver = null;
export function setHairShapeSaver(fn) {
  hairShapeSaver = fn;
}
/** External edits (shape strokes) count as edits of the current selection. */
export function markEdited() {
  onEdited();
}

function currentJewelMaterialState() {
  return { material: jewelMaterial.material, tint: { ...jewelMaterial.tint } };
}

// 'dirty' = values changed (update dots/readout/save button, do NOT rebuild
// panels, a rebuild mid-scrub would replace the field being dragged);
// 'selection' = structure changed (rebuild the Fit panel).
function onEdited() {
  if (!current.key) return;
  current.dirty = true;
  const w = { matrix: effectiveMatrix().toArray() };
  if (current.kind === 'hair') {
    w.sway = swayValue;
    w.underhair = underhairValue;
  }
  if (current.kind === 'jewel') Object.assign(w, currentJewelMaterialState());
  working.set(`${current.kind}/${current.key}`, w);
  updateReadout();
  emit('dirty');
}

// While a gizmo drag is in flight we want the dirty dot live but not a
// working-map write per mouse move.
function markDirtyLive() {
  if (!current.key || current.dirty) return;
  current.dirty = true;
  emit('dirty');
}

function pushTransformHistory(label, before, after) {
  const kind = current.kind;
  const key = current.key;
  history.push({
    label: `${label} ${key}`,
    undo: async () => {
      await ensureSelected(kind, key);
      setEffectiveMatrix(before);
      onEdited();
    },
    redo: async () => {
      await ensureSelected(kind, key);
      setEffectiveMatrix(after);
      onEdited();
    },
  });
}

async function ensureSelected(kind, key) {
  if (current.kind === kind && current.key === key) return;
  if (kind === 'hair') await selectHair(key);
  else if (kind === 'jewel') selectJewel(key);
  else if (kind === 'band') selectBand(key);
}

// ---------------------------------------------------------------------------
// Ghosts
// ---------------------------------------------------------------------------
export const ghostPrefs = {
  visible: loadPrefs().ghostVisible ?? true,
  opacity: loadPrefs().ghostOpacity ?? 0.32,
};

function ghostBuilt(stem, baseOpacity) {
  const meshes = character.meshesByStem.get(stem) ?? [];
  for (const m of meshes) {
    if (!ghostOriginal.has(m)) ghostOriginal.set(m, m.material);
    const src = Array.isArray(m.material) ? m.material[0] : m.material;
    const mat = src.clone();
    mat.name = src.name; // keep the name: appearance tints match by it
    mat.transparent = true;
    mat.opacity = baseOpacity * (ghostPrefs.opacity / 0.32);
    mat.depthWrite = false;
    m.material = mat;
    m.userData.ghostBase = baseOpacity;
    character.visibilityOverrides.set(m, ghostPrefs.visible);
    m.visible = ghostPrefs.visible;
  }
  return meshes.length > 0;
}

export function setGhostVisible(on) {
  ghostPrefs.visible = on;
  savePrefs({ ghostVisible: on });
  for (const m of ghostOriginal.keys()) {
    character.visibilityOverrides.set(m, on);
    m.visible = on;
  }
  emit('ghost');
}

export function setGhostOpacity(v) {
  ghostPrefs.opacity = v;
  savePrefs({ ghostOpacity: v });
  for (const m of ghostOriginal.keys()) {
    m.material.opacity = (m.userData.ghostBase ?? 0.32) * (v / 0.32);
  }
}

function bboxOf(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return box.isEmpty() ? null : box;
}

// ---------------------------------------------------------------------------
// Clear / deselect
// ---------------------------------------------------------------------------
export function clearWrap() {
  for (const [m, mat] of ghostOriginal) {
    m.material = mat;
    character.visibilityOverrides.delete(m);
  }
  ghostOriginal.clear();
  for (const m of hiddenBuilt) character.visibilityOverrides.delete(m);
  hiddenBuilt.clear();
  for (const g of [inner, mirror]) {
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse?.((o) => {
        if (o.isMesh) o.geometry?.dispose?.();
      });
    }
  }
  jewelPreviewMeshes = [];
  jewelAtlasMats = [];
  wrap.position.set(0, 0, 0);
  wrap.quaternion.identity();
  wrap.scale.set(1, 1, 1);
  inner.position.set(0, 0, 0);
  gizmo.detach();
  character.applyVisibility();
}

export function deselect() {
  clearWrap();
  current.kind = null;
  current.key = null;
  current.dirty = false;
  character.setUnderhair('buzz');
  emit('selection');
}

// ---------------------------------------------------------------------------
// Hair selection
// ---------------------------------------------------------------------------
const hairLoader = new THREE.LoadingManager();
export async function selectHair(keyName) {
  beforeSelectHook();
  clearWrap();
  current.kind = 'hair';
  current.key = keyName;
  current.dirty = working.has(`hair/${keyName}`);
  emit('selection');
  const { GLTFLoader } = await import('/three.bundle.js');
  const loader = new GLTFLoader(hairLoader);
  const gltf = await loader.loadAsync(`/repo/tmp/modular/hair_src/${keyName}.glb`);
  if (current.kind !== 'hair' || current.key !== keyName) return; // stale load
  // Show the sculpt the colour it will BE, the mod_hair tint, not Tripo's
  // pale bake. DoubleSide because the raw sculpts are single-sided shells:
  // the build closes them, but here a flat panel of hair would otherwise
  // vanish from behind. Named mod_hair so the appearance wheel recolours it.
  const hairMat = new THREE.MeshStandardMaterial({
    color: character.hslHex(
      character.appearance.hair.h,
      character.appearance.hair.s,
      character.appearance.hair.l,
    ),
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  hairMat.name = 'mod_hair';
  const hairMeshes = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.material = hairMat;
      o.castShadow = true;
      hairMeshes.push(o);
    }
  });
  // Shape brush: snapshot the raw positions and re-apply any saved/working
  // shape deltas BEFORE anything measures the sculpt.
  hairLoadedHook(keyName, hairMeshes, state.hairSculpt?.[keyName] ?? null);
  // Pivot at the sculpt's own centre: rotations turn the hair in place.
  const raw = bboxOf(gltf.scene);
  const rawCenter = raw ? raw.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  inner.position.copy(rawCenter).negate();
  inner.updateMatrix();
  inner.add(gltf.scene);
  // The fresh preview material must wear the picked hair shading too, the
  // scene-wide sweep only runs on appearance changes, not on selection, and
  // it can only see the sculpt once it hangs under `follow` in the scene.
  character.applyHairShading();
  // The OLD style must not linger while the new one is placed (Troy,
  // 2026-08-05): hide the built H2 outright, no translucent ghost. Its bbox
  // is still read below for the first-touch placement.
  const builtMeshes = character.meshesByStem.get(`H2_${keyName}`) ?? [];
  for (const m of builtMeshes) {
    character.visibilityOverrides.set(m, false);
    m.visible = false;
    hiddenBuilt.add(m);
  }
  const hadGhost = builtMeshes.length > 0;

  const kept = working.get(`hair/${keyName}`);
  const saved = anchorFor('hair', keyName);
  if (kept) {
    setEffectiveMatrix(kept.matrix);
    swayValue = kept.sway ?? 'auto';
    underhairValue = kept.underhair ?? saved?.underhair ?? 'buzz';
    current.dirty = true;
  } else if (saved) {
    setEffectiveMatrix(saved.matrix);
    swayValue = saved.sway ?? 'auto';
    underhairValue = saved.underhair ?? 'buzz';
  } else {
    // First touch: land the sculpt roughly where the current build sits (or
    // over the crown when the style has no build yet), so the gizmo starts
    // from "adjust", not "hunt".
    swayValue = 'auto';
    underhairValue = 'buzz';
    const built = hadGhost
      ? bboxOf(
          new THREE.Group().add(
            ...(character.meshesByStem.get(`H2_${keyName}`) ?? []).map((m) => m.clone()),
          ),
        )
      : null;
    if (raw) {
      const rawSize = raw.getSize(new THREE.Vector3());
      let s = 1;
      let target = new THREE.Vector3(0, 1.78, 0);
      if (built) {
        const bSize = built.getSize(new THREE.Vector3());
        s = THREE.MathUtils.clamp(bSize.y / Math.max(1e-6, rawSize.y), 0.2, 6);
        target = built.getCenter(new THREE.Vector3());
      } else {
        s = THREE.MathUtils.clamp(
          1.0 / Math.max(1e-6, Math.max(rawSize.x, rawSize.y, rawSize.z)),
          0.2,
          6,
        );
      }
      wrap.scale.setScalar(s);
      wrap.position.copy(target);
    }
  }
  wrap.updateMatrix();
  gizmo.attach(wrap);
  character.setUnderhair(underhairValue);
  syncPanel();
  emit('selection');
}

// ---------------------------------------------------------------------------
// Jewel selection + materials
// ---------------------------------------------------------------------------
// Preset table twinned with JEWEL_MATERIALS in tmp/modular/jewel.py and the
// allowlist in lib/fit_studio.mjs, keep the three in sync. Colours are the
// LINEAR factors the GLB will carry; three tone-maps them the same way.
export const JEWEL_MATERIALS = {
  gold: { color: [0.83, 0.6, 0.18], metallic: 1.0, rough: 0.34 },
  silver: { color: [0.7, 0.73, 0.77], metallic: 1.0, rough: 0.28 },
  bone: { color: [0.75, 0.68, 0.55], metallic: 0.0, rough: 0.62 },
  iron: { color: [0.13, 0.14, 0.16], metallic: 1.0, rough: 0.52 },
  copper: { color: [0.68, 0.31, 0.17], metallic: 1.0, rough: 0.38 },
  bronze: { color: [0.5, 0.33, 0.14], metallic: 1.0, rough: 0.42 },
  obsidian: { color: [0.025, 0.025, 0.04], metallic: 0.0, rough: 0.1 },
  jade: { color: [0.14, 0.38, 0.22], metallic: 0.0, rough: 0.32 },
  amethyst: { color: [0.34, 0.13, 0.52], metallic: 0.0, rough: 0.16 },
  ruby: { color: [0.45, 0.04, 0.09], metallic: 0.0, rough: 0.16 },
  pearl: { color: [0.87, 0.83, 0.77], metallic: 0.15, rough: 0.22 },
  turquoise: { color: [0.1, 0.5, 0.5], metallic: 0.0, rough: 0.36 },
};

/** The same HSV hue/light tweak jewel.py applies at build time. */
function tintedJewelColor(preset, tint) {
  const [r, g, b] = preset.color;
  const c = new THREE.Color(r, g, b);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + tint.h / 360 + 1) % 1,
    hsl.s,
    Math.max(0.005, Math.min(1, hsl.l * (1 + 0.6 * tint.l))),
  );
  return c;
}

function applyJewelPreviewMaterial() {
  if (!jewelPreviewMeshes.length) return;
  const preset = JEWEL_MATERIALS[jewelMaterial.material];
  jewelPreviewMeshes.forEach((mesh, i) => {
    if (!preset) {
      mesh.material = jewelAtlasMats[i];
      return;
    }
    const m = new THREE.MeshStandardMaterial({
      color: tintedJewelColor(preset, jewelMaterial.tint),
      metalness: preset.metallic,
      roughness: preset.rough,
    });
    if (i === 1) m.side = THREE.DoubleSide; // the mirror's flipped winding
    mesh.material = m;
  });
}

/** Split a jewellery set's geometry into the RIGHT-side piece (gizmoed) and
 *  its mirror preview, matching the build rule in jewel.py: right verts get
 *  the anchor, left verts its X-mirror, the midline the symmetric blend. */
export function selectJewel(keyName) {
  beforeSelectHook();
  clearWrap();
  current.kind = 'jewel';
  current.key = keyName;
  current.dirty = working.has(`jewel/${keyName}`);
  const src = (character.meshesByStem.get(`E2_${keyName}`) ?? [])[0];
  if (!src) {
    toast(`No E2_${keyName} in the character GLB`, 'bad');
    emit('selection');
    return;
  }
  ghostBuilt(`E2_${keyName}`, 0.22);

  const geo = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone();
  const pos = geo.getAttribute('position');
  const rightIdx = [];
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    if (cx > -0.015) rightIdx.push(t, t + 1, t + 2);
  }
  const right = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name);
    const out = new Float32Array(rightIdx.length * a.itemSize);
    for (let i = 0; i < rightIdx.length; i++) {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(rightIdx[i], c);
    }
    right.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  const mat = (Array.isArray(src.material) ? src.material[0] : src.material).clone();
  const rightMesh = new THREE.Mesh(right, mat);
  rightMesh.castShadow = true;
  // Pivot at the piece: the untouched anchor is the identity, so wrap sits AT
  // the piece's centre and inner backs it out.
  right.computeBoundingBox();
  const pieceCenter = right.boundingBox.getCenter(new THREE.Vector3());
  inner.position.copy(pieceCenter).negate();
  inner.updateMatrix();
  inner.add(rightMesh);
  const mirrorMat = mat.clone();
  mirrorMat.side = THREE.DoubleSide; // mirrored winding
  const mirrorMesh = new THREE.Mesh(right, mirrorMat);
  mirror.add(mirrorMesh);
  jewelPreviewMeshes = [rightMesh, mirrorMesh];
  jewelAtlasMats = [mat, mirrorMat];

  const kept = working.get(`jewel/${keyName}`);
  const saved = anchorFor('jewel', keyName);
  if (kept) {
    setEffectiveMatrix(kept.matrix);
    current.dirty = true;
  } else if (saved) {
    setEffectiveMatrix(saved.matrix);
  } else {
    wrap.position.copy(pieceCenter);
  }
  const matState = kept ?? saved ?? {};
  jewelMaterial = {
    material: matState.material ?? '',
    tint: { h: matState.tint?.h ?? 0, l: matState.tint?.l ?? 0 },
  };
  applyJewelPreviewMaterial();
  wrap.updateMatrix();
  gizmo.attach(wrap);
  character.setUnderhair('buzz');
  syncPanel();
  emit('selection');
}

// ---------------------------------------------------------------------------
// Hair bands
// ---------------------------------------------------------------------------
// A band is the metal cuff a tailed style is tied with (tmp/modular/bands.py).
// It is GENERATED rather than imported, so there is no sculpt file to load and
// no origin to be absolute against: the ring is rebuilt here from
// bands_spec.json exactly as the build will emit it, and what the gizmo saves
// is a DELTA on that ring.
//
// Building the preview instead of loading the E2_band_ node out of the
// character GLB is the whole trick. The built node already carries whatever
// delta was saved last time, so gizmoing it would stack this session's move on
// top of the last one and the band would walk further off the tail with every
// save. Rebuilding from the spec makes the screen and the build agree by
// construction.

/** Superellipse-profile torus, twinned with _ring_grid() in bands.py, the
 *  segment counts and exponent must match or the studio previews a ring the
 *  build does not produce. Space is glTF Y-up, same as the spec. */
function bandRingGrid(center, axis, R, tr, ta, seg = 20, prof = 8, exp = 3) {
  const a = axis.clone().normalize();
  const seed = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(seed, a).normalize();
  const v = new THREE.Vector3().crossVectors(a, u);
  const se = (t) => Math.sign(t) * Math.abs(t) ** (2 / exp);
  const grid = [];
  for (let i = 0; i < seg; i++) {
    const phi = (2 * Math.PI * i) / seg;
    const d = u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(v, Math.sin(phi));
    const row = [];
    for (let j = 0; j < prof; j++) {
      const th = (2 * Math.PI * j) / prof;
      const rad = R + tr * se(Math.cos(th));
      row.push(
        center
          .clone()
          .addScaledVector(d, rad)
          .addScaledVector(a, ta * se(Math.sin(th))),
      );
    }
    grid.push(row);
  }
  return grid;
}

function bandRingGeometry(ring) {
  const grid = bandRingGrid(
    new THREE.Vector3(...ring.center),
    new THREE.Vector3(...ring.axis),
    ring.R,
    ring.tr,
    ring.ta,
  );
  const seg = grid.length;
  const prof = grid[0].length;
  const pos = [];
  const push = (p) => pos.push(p.x, p.y, p.z);
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < prof; j++) {
      const A = grid[i][j];
      const B = grid[(i + 1) % seg][j];
      const C = grid[(i + 1) % seg][(j + 1) % prof];
      const D = grid[i][(j + 1) % prof];
      push(A);
      push(B);
      push(C);
      push(A);
      push(C);
      push(D);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The gold the build paints a band (the knight atlas's swatch), so the
 *  preview reads as metal rather than as a grey donut. */
function bandMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 1, roughness: 0.34 });
}

/** The volume a band ties, as a character selection, so picking a band shows
 *  the tail it is meant to bite instead of a bare head. */
function showBandHost(node) {
  if (node.startsWith('H2_')) character.setCharField('builtHair', node.slice(3));
  else if (node.startsWith('BI_')) character.setCharField('beard', node.slice(3));
}

export function selectBand(keyName) {
  beforeSelectHook();
  clearWrap();
  current.kind = 'band';
  current.key = keyName;
  current.dirty = working.has(`band/${keyName}`);
  const spec = state.bands?.[keyName];
  if (!spec) {
    toast(`No ${keyName} in bands_spec.json`, 'bad');
    emit('selection');
    return;
  }
  // Pivot at the FIRST ring's centre: Rotate tilts the cuff on the tail, and
  // an untouched band composes to the identity delta.
  const center = new THREE.Vector3(...spec.rings[0].center);
  inner.position.copy(center).negate();
  inner.updateMatrix();
  // Every authored ring, because the build applies the one delta to all of
  // them, a spec that grows a second cuff further down a braid has to show
  // both here or the gizmo would be moving more than the screen admits. A
  // `mirror` ring is drawn ONCE and reflected: the designer places the
  // right-hand cuff and the twin follows, the same contract jewellery has,
  // which is what stops a pair drifting apart.
  for (const ring of spec.rings) {
    const geo = bandRingGeometry(ring);
    const mesh = new THREE.Mesh(geo, bandMaterial());
    mesh.castShadow = true;
    inner.add(mesh);
    if (ring.mirror) {
      const twin = new THREE.Mesh(geo, bandMaterial());
      twin.material.side = THREE.DoubleSide; // mirrored winding
      mirror.add(twin);
    }
  }
  showBandHost(spec.node);

  const kept = working.get(`band/${keyName}`);
  const saved = anchorFor('band', keyName);
  if (kept) {
    setEffectiveMatrix(kept.matrix);
    current.dirty = true;
  } else if (saved) {
    setEffectiveMatrix(saved.matrix);
  } else {
    wrap.position.copy(center);
  }
  wrap.updateMatrix();
  gizmo.attach(wrap);
  syncPanel();
  emit('selection');
}

// ---------------------------------------------------------------------------
// Save / reset / copy / paste
// ---------------------------------------------------------------------------
export async function saveCurrent() {
  if (!current.key) {
    toast('Pick a style first', 'warn');
    return;
  }
  const body = {
    kind: current.kind,
    key: current.key,
    matrix: effectiveMatrix().toArray(),
  };
  if (current.kind === 'hair' && swayValue !== 'auto') body.sway = swayValue;
  if (current.kind === 'hair' && underhairValue !== 'buzz') body.underhair = underhairValue;
  if (current.kind === 'jewel' && jewelMaterial.material) {
    body.material = jewelMaterial.material;
    body.tint = jewelMaterial.tint;
  }
  const res = await fetch('/api/fit/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (out.error) {
    toast(`Save failed: ${out.error}`, 'bad');
    return;
  }
  state.anchors[current.kind] ??= {};
  state.anchors[current.kind][current.key] = {
    matrix: body.matrix,
    sway: body.sway,
    underhair: body.underhair,
    material: body.material,
    tint: body.tint,
  };
  working.delete(`${current.kind}/${current.key}`);
  // Shape tweaks ride the same Save: one button commits seat AND shape.
  if (current.kind === 'hair' && hairShapeSaver) await hairShapeSaver(current.key);
  current.dirty = false;
  toast(`Saved ${current.kind}/${current.key}, rebuild picks it up`, 'good');
  emit('selection');
}

export async function resetCurrent() {
  if (!current.key) return;
  const res = await fetch('/api/fit/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: current.kind, key: current.key }),
  });
  const out = await res.json();
  if (out.error) {
    toast(`Reset failed: ${out.error}`, 'bad');
    return;
  }
  if (state.anchors[current.kind]) delete state.anchors[current.kind][current.key];
  working.delete(`${current.kind}/${current.key}`);
  const k = current.key;
  toast(`${k}: anchor removed, solver/built position again`);
  if (current.kind === 'hair') selectHair(k);
  else if (current.kind === 'band') selectBand(k);
  else selectJewel(k);
}

export function copyAnchor() {
  if (!current.key) return;
  clipboard = { kind: current.kind, matrix: effectiveMatrix().toArray() };
  toast(`Copied ${current.kind}/${current.key} placement`);
  emit('selection');
}

export function pasteAnchor() {
  if (!current.key || !clipboard) return;
  if (clipboard.kind !== current.kind) {
    toast(`Clipboard holds a ${clipboard.kind} placement`, 'warn');
    return;
  }
  const before = effectiveMatrix().toArray();
  setEffectiveMatrix(clipboard.matrix);
  pushTransformHistory('paste onto', before, clipboard.matrix.slice());
  onEdited();
  toast('Placement pasted');
}

export function hasClipboard() {
  return clipboard !== null;
}

export function reloadSaved() {
  if (!current.key) return;
  const saved = anchorFor(current.kind, current.key);
  if (!saved) {
    toast('No saved anchor for this style yet', 'warn');
    return;
  }
  const before = effectiveMatrix().toArray();
  setEffectiveMatrix(saved.matrix);
  pushTransformHistory('reload saved', before, saved.matrix.slice());
  working.delete(`${current.kind}/${current.key}`);
  current.dirty = false;
  if (current.kind === 'hair') {
    swayValue = saved.sway ?? 'auto';
    underhairValue = saved.underhair ?? 'buzz';
    character.setUnderhair(underhairValue);
  }
  emit('selection');
  toast('Reloaded the saved anchor');
}

// ---------------------------------------------------------------------------
// Nudge (arrow keys)
// ---------------------------------------------------------------------------
export function nudge(dx, dy, dz, fine) {
  if (!current.key) return;
  const kind = current.kind;
  const key = current.key;
  const before = effectiveMatrix().toArray();
  const step = fine ? 0.001 : 0.005;
  wrap.position.x += dx * step;
  wrap.position.y += dy * step;
  wrap.position.z += dz * step;
  wrap.updateMatrix();
  const after = effectiveMatrix().toArray();
  history.push({
    label: `nudge ${key}`,
    merge: `nudge:${kind}/${key}`,
    undo: async () => {
      await ensureSelected(kind, key);
      setEffectiveMatrix(before);
      onEdited();
    },
    redo: async () => {
      await ensureSelected(kind, key);
      setEffectiveMatrix(after);
      onEdited();
    },
  });
  syncPanel();
  onEdited();
}

// ---------------------------------------------------------------------------
// Inspector panel (Fit tab)
// ---------------------------------------------------------------------------
let panelHost = null;
let fields = null; // {px..sz} numFields
let syncing = false;

function transformOf() {
  const e = new THREE.Euler().setFromQuaternion(wrap.quaternion, 'XYZ');
  const d = THREE.MathUtils.radToDeg;
  return {
    px: wrap.position.x,
    py: wrap.position.y,
    pz: wrap.position.z,
    rx: d(e.x),
    ry: d(e.y),
    rz: d(e.z),
    sx: wrap.scale.x,
    sy: wrap.scale.y,
    sz: wrap.scale.z,
  };
}

function applyField(name, v) {
  if (syncing) return;
  const t = transformOf();
  t[name] = v;
  if (gizmoState.uniform && name.startsWith('s')) {
    t.sx = t.sy = t.sz = v;
  }
  wrap.position.set(t.px, t.py, t.pz);
  const r = THREE.MathUtils.degToRad;
  wrap.quaternion.setFromEuler(new THREE.Euler(r(t.rx), r(t.ry), r(t.rz), 'XYZ'));
  wrap.scale.set(t.sx, t.sy, t.sz);
  wrap.updateMatrix();
  if (gizmoState.uniform && name.startsWith('s')) {
    syncing = true;
    fields.sx.set(t.sx);
    fields.sy.set(t.sy);
    fields.sz.set(t.sz);
    syncing = false;
  }
  onEdited();
}

function fieldCommit(name) {
  return (v, old) => {
    const t = transformOf();
    const beforeT = { ...t, [name]: old };
    if (gizmoState.uniform && name.startsWith('s')) {
      beforeT.sx = beforeT.sy = beforeT.sz = old;
    }
    const before = matrixFromT(beforeT);
    const after = effectiveMatrix().toArray();
    pushTransformHistory(`set ${name}`, before, after);
  };
}

function matrixFromT(t) {
  const r = THREE.MathUtils.degToRad;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.px, t.py, t.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r(t.rx), r(t.ry), r(t.rz), 'XYZ')),
    new THREE.Vector3(t.sx, t.sy, t.sz),
  );
  inner.updateMatrix();
  return m.multiply(inner.matrix).toArray();
}

export function syncPanel() {
  if (!fields) return;
  syncing = true;
  const t = transformOf();
  for (const k of Object.keys(fields)) fields[k].set(t[k]);
  syncing = false;
  updateReadout();
}

const readout = document.getElementById('readout');
export function updateReadout() {
  if (!current.key) {
    readout.hidden = true;
    return;
  }
  readout.hidden = false;
  const t = transformOf();
  const f = (n, d = 3) => n.toFixed(d).padStart(8);
  readout.innerHTML = '';
  readout.append(
    h('b', {}, `${current.kind}/${current.key}`),
    current.dirty ? h('span', { class: 'dirty' }, '  ● unsaved') : '',
    document.createTextNode(
      `\npos ${f(t.px)} ${f(t.py)} ${f(t.pz)}` +
        `\nrot ${f(t.rx, 1)} ${f(t.ry, 1)} ${f(t.rz, 1)}` +
        `\nscl ${f(t.sx)} ${f(t.sy)} ${f(t.sz)}`,
    ),
  );
}

function jewelSwatchCss(name) {
  const p = JEWEL_MATERIALS[name];
  const c = new THREE.Color(...p.color).convertLinearToSRGB();
  return c.getStyle();
}

export function buildFitPanel(host) {
  panelHost = host;
  renderFitPanel();
}

export function renderFitPanel() {
  if (!panelHost) return;
  const host = panelHost;
  host.replaceChildren();
  if (!current.key) {
    host.append(
      h(
        'div',
        { class: 'empty' },
        icon('hair', 26),
        h('div', {}, 'Pick a hair style, piercing set or hair band from the library.'),
        h('div', { class: 'note' }, 'Body sculpting lives under Body in the library.'),
      ),
    );
    updateReadout();
    return;
  }
  if (current.kind === 'sculpt') return; // sculpt.js owns the panel

  const saved = anchorFor(current.kind, current.key);
  const badge = current.dirty
    ? h('span', { class: 'badge dirty' }, 'unsaved')
    : saved
      ? h('span', { class: 'badge saved' }, 'anchored')
      : h('span', { class: 'badge new' }, 'no anchor');
  const KIND_LABEL = { hair: 'Hair sculpt', jewel: 'Piercing set', band: 'Hair band' };
  host.append(
    h(
      'div',
      { class: 'selcard' },
      icon(current.kind === 'hair' ? 'hair' : 'gem', 18),
      h(
        'div',
        {},
        h('div', { class: 'kind' }, KIND_LABEL[current.kind] ?? current.kind),
        h('div', { class: 'name' }, current.key),
      ),
      badge,
    ),
  );

  // Transform ------------------------------------------------------------
  const tSec = section('fit-transform', 'Transform', { open: true });
  const t = transformOf();
  fields = {};
  const mk = (name, axis, step, digits, min = -Infinity) =>
    (fields[name] = numField({
      axis,
      value: t[name],
      step,
      digits,
      min,
      onInput: (v) => applyField(name, v),
      onCommit: fieldCommit(name),
    }));
  tSec.body.append(
    h(
      'div',
      { class: 'row3' },
      h('label', {}, 'Position'),
      mk('px', 'x', 0.002, 3).root,
      mk('py', 'y', 0.002, 3).root,
      mk('pz', 'z', 0.002, 3).root,
    ),
    h(
      'div',
      { class: 'row3' },
      h('label', {}, 'Rotation °'),
      mk('rx', 'x', 0.5, 1).root,
      mk('ry', 'y', 0.5, 1).root,
      mk('rz', 'z', 0.5, 1).root,
    ),
    h(
      'div',
      { class: 'row3' },
      h('label', {}, 'Scale'),
      mk('sx', 'x', 0.004, 3, 0.01).root,
      mk('sy', 'y', 0.004, 3, 0.01).root,
      mk('sz', 'z', 0.004, 3, 0.01).root,
    ),
    h('div', { class: 'note' }, 'Drag a field to scrub · click to type · ⇧ fine'),
  );
  host.append(tSec.root);

  // Style-specific --------------------------------------------------------
  if (current.kind === 'hair') {
    // Beards ride the 'hair' kind (same fit machinery, same anchor section) but
    // they are not worn ON a scalp, so the Underhair row has nothing to say
    // about one and the section is left out for them. The sculpt brush below
    // still applies, a beard wants reshaping as much as a fringe does.
    const isBeard = String(current.key).startsWith('beard_');
    const sSec = section('fit-hair', 'Hair options', { open: true });
    // The Sway row is hidden while hair animation is off for the release: there
    // is nothing to preview and no reason to ask the designer for a decision
    // the runtime ignores. `swayValue` is deliberately left wired to load/save
    // below, so any override already in anchors.json still round-trips
    // untouched, putting the row back is the only step to restore the control.
    const underhairSel = selectRow({
      label: 'Underhair',
      options: UNDERHAIR_OPTIONS,
      value: underhairValue,
      onChange: (v) => {
        const before = underhairValue;
        underhairValue = v;
        character.setUnderhair(v);
        onEdited();
        const key = current.key;
        history.push({
          label: `underhair ${v}`,
          undo: async () => {
            await ensureSelected('hair', key);
            underhairValue = before;
            character.setUnderhair(before);
            underhairSel.set(before);
            onEdited();
          },
          redo: async () => {
            await ensureSelected('hair', key);
            underhairValue = v;
            character.setUnderhair(v);
            underhairSel.set(v);
            onEdited();
          },
        });
      },
    });
    sSec.body.append(
      underhairSel.root,
      h(
        'div',
        { class: 'note' },
        'The scalp worn under this style, in game too, saved with the anchor. Solid picks wash the scalp in the hair colour; fades, hairlines and the horseshoe change the line.',
      ),
    );
    if (!isBeard) host.append(sSec.root);
    if (hairPanelExtra) hairPanelExtra(host);
  }

  if (current.kind === 'band') {
    const spec = state.bands?.[current.key];
    const bSec = section('fit-band', 'Band', { open: true });
    bSec.body.append(
      h(
        'div',
        { class: 'row' },
        h('label', {}, 'Ties'),
        h('span', { class: 'grow' }),
        h('b', {}, spec?.node ?? '-'),
      ),
      h(
        'div',
        { class: 'note' },
        spec?.rings?.[0]?.mirror
          ? 'A PAIR: place the right-hand cuff and the build mirrors it onto the left, so the two can never drift apart.'
          : 'Scale along the ring to size the hoop, across it to widen the band.',
      ),
      h(
        'div',
        { class: 'note' },
        'Saved as a delta on the authored ring. Publish to Game rebuilds the bands from it along with the hair.',
      ),
    );
    host.append(bSec.root);
  }

  if (current.kind === 'jewel') {
    const jSec = section('fit-jewel', 'Material', { open: true });
    const items = [
      {
        key: '',
        css: 'linear-gradient(135deg,#8a6d4a 0%,#4a3d2d 100%)',
        tip: 'atlas (default)',
        label: 'A',
      },
      ...Object.keys(JEWEL_MATERIALS).map((n) => ({ key: n, css: jewelSwatchCss(n), tip: n })),
    ];
    const grid = swatchGrid(items, jewelMaterial.material, (key) => {
      const before = { ...jewelMaterial, tint: { ...jewelMaterial.tint } };
      jewelMaterial.material = key;
      applyJewelPreviewMaterial();
      onEdited();
      history.push({
        label: `material ${key || 'atlas'}`,
        undo: async () => {
          await ensureSelected('jewel', current.key);
          jewelMaterial = { ...before, tint: { ...before.tint } };
          applyJewelPreviewMaterial();
          renderFitPanel();
          onEdited();
        },
        redo: async () => {
          await ensureSelected('jewel', current.key);
          jewelMaterial.material = key;
          applyJewelPreviewMaterial();
          renderFitPanel();
          onEdited();
        },
      });
    });
    const hueRow = sliderRow({
      label: 'Hue shift',
      min: -180,
      max: 180,
      step: 5,
      value: jewelMaterial.tint.h,
      digits: 0,
      onInput: (v) => {
        jewelMaterial.tint.h = v;
        applyJewelPreviewMaterial();
        onEdited();
      },
    });
    const lightRow = sliderRow({
      label: 'Light',
      min: -1,
      max: 1,
      step: 0.05,
      value: jewelMaterial.tint.l,
      onInput: (v) => {
        jewelMaterial.tint.l = v;
        applyJewelPreviewMaterial();
        onEdited();
      },
    });
    jSec.body.append(
      grid.root,
      hueRow.root,
      lightRow.root,
      h('div', { class: 'note' }, 'Only the worn set pays for a preset material; atlas is free.'),
    );
    host.append(jSec.root);
  }

  // Actions ---------------------------------------------------------------
  const acts = h(
    'div',
    { class: 'actions' },
    btn({ ic: 'copy', label: 'Copy', tip: 'Copy placement', onClick: copyAnchor }),
    btn({ ic: 'paste', label: 'Paste', tip: 'Paste placement', onClick: pasteAnchor }),
    btn({ ic: 'reset', label: 'Saved', tip: 'Reload the saved anchor', onClick: reloadSaved }),
  );
  const acts2 = h(
    'div',
    { class: 'actions' },
    btn({
      ic: 'trash',
      label: 'Remove anchor',
      kind: 'danger',
      tip: 'Back to the solver seat',
      onClick: resetCurrent,
    }),
  );
  host.append(acts, acts2);
  updateReadout();
}

// ---------------------------------------------------------------------------
// Per-frame: follow the head bone during animation + mirror preview
// ---------------------------------------------------------------------------
const S_TMP = new THREE.Matrix4();
export function tickFollow() {
  if (character.charState.anim && character.headBone) {
    follow.matrix.copy(character.headBone.matrixWorld).multiply(character.headRestInv);
  } else {
    follow.matrix.identity();
  }
  if ((current.kind === 'jewel' || current.kind === 'band') && mirror.children.length) {
    // The mirror group holds the RIGHT-side geometry, so the left preview is
    // reflect(designer transform · p): S · M, an ODD number of reflections.
    // S·M·S is the build-side rule for the ORIGINAL left vertices, applied
    // here it rendered an unmirrored copy drifting off into space.
    mirror.matrix.copy(MIRROR_X).multiply(S_TMP.copy(effectiveMatrix()));
    mirror.visible = true;
  } else {
    mirror.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const listeners = new Set();
function emit(what) {
  for (const fn of listeners) fn(what);
}
export function onAnchorsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
