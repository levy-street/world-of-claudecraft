// The modular character: loading the GLB, the stem registry, what is worn
// (gender, armor, face variants, beard, built hair), the morph sliders, the
// appearance tints (the same HSL-wheel model the game stores), and animation
// preview. The character is the loaded GLB scene itself with per-node
// visibility, not re-baked meshes, so the raw authoring export and the
// shipped KTX/meshopt GLB both display correctly.

import { history } from '/fit_studio/history.js';
import { MATCAP_PRESETS, matcapSwatchCss, matcapTexture } from '/fit_studio/matcap.js';
import {
  btn,
  h,
  icon,
  loadPrefs,
  savePrefs,
  section,
  segmented,
  selectRow,
  sliderRow,
  swatchGrid,
  switchRow,
  toast,
} from '/fit_studio/ui.js';
import { renderer, scene } from '/fit_studio/viewport.js';
import {
  buildStubbleDecal,
  GLTFLoader,
  HairSwayDriver,
  KTX2Loader,
  MeshoptDecoder,
  THREE,
} from '/three.bundle.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
loader.setKTX2Loader(ktx2);

export const BODY_PARTS = [
  'Torso',
  'ArmL',
  'ArmR',
  'HandL',
  'HandR',
  'LegL',
  'LegR',
  'FootL',
  'FootR',
];

/** node-stem -> meshes (GLTFLoader suffixes multi-primitive nodes `_1`).
 *  A mesh registers under its OWN stem and its parent group's: three names
 *  multi-primitive children after the mesh DATABLOCK, which on imported
 *  armour can still be a source name (RAW_paladin_ArmLeft002) no gate
 *  recognises, the node name lives on the parent Group. */
export const meshesByStem = new Map();
export const meshStems = new Map(); // mesh -> [stems]
/** anchors.js parks ghost/preview visibility decisions here so
 *  applyVisibility never fights the ghosting. mesh -> boolean */
export const visibilityOverrides = new Map();

export let characterRoot = null;
export let characterClips = [];
export let mixer = null;
export let headBone = null;
export const headRestInv = new THREE.Matrix4();
const boneRest = new Map();

function stemOf(name) {
  return name.replace(/_\d+$/, '');
}

// ---------------------------------------------------------------------------
// What is worn, drives applyVisibility()
// ---------------------------------------------------------------------------
export const charState = {
  gender: 'M',
  armor: '',
  helm: false,
  underwear: true,
  beard: 'none',
  builtHair: 'none',
  ear: 'round',
  brow: 'soft',
  eyeShape: 'almond',
  lashes: false, // default follows gender; flips when gender does unless touched
  lashesTouched: false,
  mouth: 'neutral',
  // The under-hair growth every non-bald style wears in game (the buzz decal,
  // built by the game's own stubble.ts bundled into /three.bundle.js). ON by
  // default: a hair fit has to be judged against the scalp it will sit over.
  scalpStubble: true,
  anim: '',
  animSpeed: 1,
  animPaused: false,
};

export function variantOptions() {
  const g = charState.gender;
  const strip = (prefix) =>
    [...meshesByStem.keys()]
      .filter((s) => s.startsWith(prefix))
      .map((s) => s.slice(prefix.length))
      .sort();
  return {
    armor: [
      ...new Set(
        [...meshesByStem.keys()].filter((s) => s.startsWith('Armor_')).map((s) => s.split('_')[1]),
      ),
    ].sort(),
    // Built beards are Fit Studio sculpts (BI_*); tolerate any leftover
    // parametric B2_* in an old GLB so the picker never goes blank.
    beard: [...new Set([...strip('BI_'), ...strip('B2_')])].sort(),
    builtHair: strip('H2_'),
    ear: strip(`${g}_Ear_`),
    brow: strip(`${g}_Brow_`),
    eyeShape: strip(`${g}_Eye_`),
    mouth: strip(`${g}_Mouth_`),
    // Hair bands ride the E2_ prefix too (it is what routes them through the
    // jewel material path in game, see bands.py), but they are a different
    // slot with a different library section, so they are not piercing sets.
    jewel: strip('E2_').filter((s) => !s.startsWith('band_')),
  };
}

function displayStems() {
  const g = charState.gender;
  const stems = ['Head', ...BODY_PARTS].map((p) => `${g}_${p}`);
  stems.push(
    `${g}_Ear_${charState.ear}`,
    `${g}_Brow_${charState.brow}`,
    `${g}_Eye_${charState.eyeShape}`,
    `${g}_Mouth_${charState.mouth}`,
  );
  if (charState.lashes) stems.push(`${g}_Lash_${charState.eyeShape}`);
  if (charState.underwear) stems.push(`${g}_Loin`, `${g}_Top`);
  if (charState.beard !== 'none') {
    const b = charState.beard;
    stems.push(meshesByStem.has(`BI_${b}`) ? `BI_${b}` : `B2_${b}`);
  }
  if (charState.builtHair !== 'none') stems.push(`H2_${charState.builtHair}`);
  if (charState.armor) {
    for (const stem of meshesByStem.keys()) {
      if (!stem.startsWith(`Armor_${charState.armor}_`)) continue;
      const piece = stem.slice(`Armor_${charState.armor}_`.length);
      if (piece.startsWith('Head') && !charState.helm) continue;
      stems.push(stem);
    }
  }
  return new Set(stems);
}

export function applyVisibility() {
  const want = displayStems();
  for (const [mesh, stems] of meshStems) {
    if (visibilityOverrides.has(mesh)) {
      mesh.visible = visibilityOverrides.get(mesh);
      continue;
    }
    mesh.visible = stems.some((s) => want.has(s));
  }
  // The scalp decal follows its own head (it is not a registered part).
  for (const [g, decal] of scalpDecals) {
    const head = (meshesByStem.get(`${g}_Head`) ?? [])[0];
    decal.visible = !!head?.visible && charState.scalpStubble;
  }
  // A freshly-shown part must pick up the x-ray, or toggling armour on while
  // it is enabled brings that piece back at full opacity.
  if (xrayPrefs.on) applyXray();
  emit('visibility');
}

// ---------------------------------------------------------------------------
// X-ray: see the piece you are fitting THROUGH the body
// ---------------------------------------------------------------------------
// Seating a hairline means working exactly where the skull sits between the
// camera and the strands, and an opaque head hides the vertices being moved.
// This fades the CHARACTER only: the piece being fitted hangs under anchors'
// `follow` group, a separate subtree from characterRoot, so what you are
// editing never dims with what you are editing it against.
//
// Materials are mutated in place rather than swapped for clones, because the
// ghost system already swaps `m.material` and a second swapping layer on top
// of it fights for the same slot. Each material's own values are remembered
// once and restored on the way out, so a ghost stays a ghost afterwards.
export const xrayPrefs = {
  on: loadPrefs().xray ?? false,
  opacity: loadPrefs().xrayOpacity ?? 0.22,
};
const xrayOriginal = new Map(); // material -> its own transparent/opacity/depthWrite

/** Re-assert the x-ray over every character material, adopting any that
 *  appeared since the last pass (a ghost clone, a swapped variant). */
export function applyXray() {
  if (!characterRoot) return;
  const live = new Set();
  characterRoot.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      live.add(m);
      if (!xrayOriginal.has(m)) {
        xrayOriginal.set(m, {
          transparent: m.transparent,
          opacity: m.opacity,
          depthWrite: m.depthWrite,
        });
      }
      const base = xrayOriginal.get(m);
      if (xrayPrefs.on) {
        m.transparent = true;
        // Scaled from the material's OWN opacity, not assigned flat, so a
        // ghost still reads fainter than a solid part at the same strength.
        m.opacity = base.opacity * xrayPrefs.opacity;
        // Without this the body still occludes itself and the hair behind it
        // in the depth buffer, which is the whole problem being solved.
        m.depthWrite = false;
      } else {
        m.transparent = base.transparent;
        m.opacity = base.opacity;
        m.depthWrite = base.depthWrite;
      }
      m.needsUpdate = true;
    }
  });
  // Drop materials that have left the character so a long session's ghost
  // clones cannot pile up in here.
  for (const m of [...xrayOriginal.keys()]) if (!live.has(m)) xrayOriginal.delete(m);
}

export function setXray(on) {
  xrayPrefs.on = on;
  savePrefs({ xray: on });
  applyXray();
  emit('xray');
}

export function setXrayOpacity(v) {
  xrayPrefs.opacity = v;
  savePrefs({ xrayOpacity: v });
  if (xrayPrefs.on) applyXray();
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
export async function loadCharacter(repoPath) {
  const gltf = await loader.loadAsync(`/repo/${repoPath}`);
  characterRoot = gltf.scene;
  characterClips = gltf.animations ?? [];
  characterRoot.traverse((o) => {
    if (o.isBone)
      boneRest.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const stems = [stemOf(o.name)];
    const parent = o.parent;
    if (parent && !parent.isScene && !parent.isBone && parent.name) {
      const ps = stemOf(parent.name);
      if (!stems.includes(ps)) stems.push(ps);
    }
    for (const stem of stems) {
      if (!meshesByStem.has(stem)) meshesByStem.set(stem, []);
      meshesByStem.get(stem).push(o);
    }
    meshStems.set(o, stems);
    o.visible = false;
    o.frustumCulled = false;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  scene.add(characterRoot);
  characterRoot.updateMatrixWorld(true);
  headBone = characterRoot.getObjectByName('head');
  if (headBone) headRestInv.copy(headBone.matrixWorld).invert();
  mixer = new THREE.AnimationMixer(characterRoot);
  attachScalpDecals();
  collectMorphs();
  swayDriver.build(characterRoot);
  captureMaterialDefaults();
  const prefs = loadPrefs();
  if (prefs.appearance) Object.assign(appearance, prefs.appearance);
  applyAppearance();
  charState.lashes = charState.gender === 'F';
  applyVisibility();
  // Restore a saved x-ray AFTER the first visibility pass, so it captures the
  // materials as they actually load rather than as the loader left them.
  if (xrayPrefs.on) applyXray();
}

// ---------------------------------------------------------------------------
// Scalp underhair, the game's own decal, worn under every fitted style
// ---------------------------------------------------------------------------
// buildStubbleDecal is the game's stubble.ts bundled verbatim: a subdivided
// copy of the head's surface lifted a fraction of a millimetre, bound to the
// same skeleton and morph dictionary, wearing the generated pattern texture.
// Its material is named mod_stubble, so the hair wheel recolours it exactly
// as recolored() does in game. WHICH pattern shows follows the selected
// style's per-anchor choice, anchors.js calls setUnderhair on select/save.
const scalpDecals = new Map(); // gender -> decal mesh
let underhairPattern = 'buzz';

function attachScalpDecals() {
  if (underhairPattern === 'none') return;
  for (const g of ['M', 'F']) {
    const head = (meshesByStem.get(`${g}_Head`) ?? [])[0];
    if (!head?.isSkinnedMesh) continue;
    try {
      const decal = buildStubbleDecal(head, { scalp: underhairPattern, beard: null });
      if (!decal) continue;
      decal.visible = false;
      head.parent?.add(decal);
      scalpDecals.set(g, decal);
    } catch (err) {
      console.warn(`scalp decal (${g}):`, err);
    }
  }
}

/** Swap the previewed under-hair pattern. Patterns are the game's own,
 *  materials and textures come from stubble.ts's caches, so they are never
 *  disposed here; only the cut-surface geometry is ours to free. */
export function setUnderhair(pattern) {
  if (pattern === underhairPattern) return;
  underhairPattern = pattern;
  for (const decal of scalpDecals.values()) {
    decal.parent?.remove(decal);
    decal.geometry?.dispose?.();
  }
  scalpDecals.clear();
  attachScalpDecals();
  // Fresh decal meshes need to rejoin the morph registry and rewear the
  // current slider values, ear shape, tint and visibility.
  collectMorphs();
  for (const [name, v] of morphValues) setMorph(name, v);
  applyEarShapeMorphs();
  captureMaterialDefaults();
  applyAppearance();
  applyVisibility();
}

export function underhair() {
  return underhairPattern;
}

/** The live scalp decals (one per gender that has a head). The painter needs
 *  the meshes themselves: both wear the SAME azimuthal unwrap, so one painted
 *  mask drives the male and female heads at once. */
export function scalpDecalList() {
  return [...scalpDecals.values()];
}

// ---------------------------------------------------------------------------
// Rest pose + animation
// ---------------------------------------------------------------------------
export function restoreRestPose() {
  for (const [bone, rest] of boneRest) {
    bone.position.copy(rest.p);
    bone.quaternion.copy(rest.q);
    bone.scale.copy(rest.s);
  }
  characterRoot?.updateMatrixWorld(true);
}

let activeAction = null;
export function setAnimation(name) {
  charState.anim = name;
  mixer?.stopAllAction();
  activeAction = null;
  if (!name) {
    // Stopping leaves the last sampled pose in the bones; the designer
    // anchors against the REST pose, so put it back exactly.
    restoreRestPose();
    // The sway driver owned the sway morphs while the clip played, hand
    // them back to the panel sliders and settle the wobble.
    mini.phase = 0;
    mini.lat = 0;
    mini.latVel = 0;
    mini.back = 0;
    swaySignal.lat = 0;
    swaySignal.back = 0;
    for (const n of SWAY) setRawMorph(n, morphValues.get(n) ?? 0);
    emit('anim');
    return;
  }
  const clip = characterClips.find((c) => c.name === name);
  if (!clip || !mixer) return;
  activeAction = mixer.clipAction(clip);
  activeAction.setLoop(THREE.LoopRepeat, Infinity);
  activeAction.paused = charState.animPaused;
  activeAction.play();
  emit('anim');
}

export function setAnimSpeed(v) {
  charState.animSpeed = v;
  if (mixer) mixer.timeScale = v;
}

// ---------------------------------------------------------------------------
// Hair sway during animation preview
// ---------------------------------------------------------------------------
// The game's own driver runs the BUILT styles' hair_sway morphs; a parallel
// copy of its spring (same constants, the driver keeps its state private)
// feeds `swaySignal`, which anchors.js turns into a crown-pivot wobble on the
// RAW sculpt being fitted, so the piece in hand moves with the gait too.
const swayDriver = new HairSwayDriver();

/** Synthetic gait per clip, yd/s against the driver's full-run reference 7. */
const CLIP_SPEEDS = [
  [/^Running_A/, 7],
  [/^Running_Strafe/, 5.5],
  [/^Walking_A/, 2.6],
  [/^Walking_Backwards/, 2.2],
  [/^Jump/, 3],
];
function clipSpeed(name) {
  for (const [re, v] of CLIP_SPEEDS) if (re.test(name)) return v;
  return 0;
}

export const swaySignal = { lat: 0, back: 0 };
const mini = { phase: 0, lat: 0, latVel: 0, back: 0 };
/** Hair animation is off for the release, so the raw sculpt in hand must sit
 *  still too, the game driver is already switched off at the source
 *  (hair_sway.ts HAIR_SWAY_ENABLED), and this is its twin for the piece being
 *  fitted. Left at 0 the crown wobble in anchors.js is a no-op. */
const SWAY_PREVIEW_ENABLED = false;
function tickSwaySignal(dt, speed) {
  if (!SWAY_PREVIEW_ENABLED) {
    swaySignal.lat = 0;
    swaySignal.back = 0;
    return;
  }
  // Twin of HairSwayDriver.update (hair_sway.ts), keep the constants in sync.
  const moving = speed > 0.2;
  const gait = Math.min(1, speed / 7);
  mini.phase += dt * (2.2 + (8.4 - 2.2) * gait);
  const targetLat = (moving ? 0.045 + (0.5 - 0.045) * gait : 0.045) * Math.sin(mini.phase);
  mini.latVel += ((targetLat - mini.lat) * 30 - mini.latVel * 7.5) * dt;
  mini.lat += mini.latVel * dt;
  const targetBack = moving ? 0.62 * gait : 0;
  mini.back += (targetBack - mini.back) * Math.min(1, dt * 5);
  swaySignal.lat = mini.lat;
  swaySignal.back = mini.back;
}

/** Per-frame: advance the clip and refresh world matrices (the follow group
 *  and mirror preview in anchors.js read them right after). */
export function tickAnimation(dt) {
  if (!charState.anim || !mixer) return;
  mixer.update(dt);
  const speed = clipSpeed(charState.anim) * (charState.animPaused ? 0 : 1);
  swayDriver.update(dt, { speed, moving: speed > 0.2, dead: false, swimming: false });
  tickSwaySignal(dt, speed);
  characterRoot.updateMatrixWorld(true);
}

export function setAnimPaused(on) {
  charState.animPaused = on;
  if (activeAction) activeAction.paused = on;
}

// ---------------------------------------------------------------------------
// Morphs
// ---------------------------------------------------------------------------
// The GLB ships pairs (name_up / name_dn) that the game drives with one
// -1..1 slider each, plus 0..1 singles (expressions, hair sway, ear shapes).
const morphMeshes = new Map(); // morph name -> [{mesh, index}]
export const morphValues = new Map(); // ui name -> value

const FACE_PAIRS = ['ears', 'jaw', 'cheeks', 'chin', 'brow', 'nose', 'eyes', 'smirk'];
const BODY_PAIRS = [
  'body_shoulders',
  'body_chest',
  'body_hips',
  'body_hands',
  'body_elbows',
  'body_knees',
  'body_feet',
];
const EXPRESSIONS = ['mouth_smile', 'mouth_frown', 'mouth_wide', 'mouth_pout', 'mouth_open'];
const SWAY = ['hair_sway_l', 'hair_sway_r', 'hair_sway_b'];
const EAR_SHAPE = { pointed: 'ear_pointed', small: 'ear_small', wide: 'ear_wide' };

function collectMorphs() {
  morphMeshes.clear();
  characterRoot.traverse((o) => {
    if (!o.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(o.morphTargetDictionary)) {
      if (!morphMeshes.has(name)) morphMeshes.set(name, []);
      morphMeshes.get(name).push({ mesh: o, index });
    }
  });
}

function setRawMorph(name, v) {
  for (const { mesh, index } of morphMeshes.get(name) ?? []) {
    mesh.morphTargetInfluences[index] = v;
  }
}

/** Pairs get -1..1 (drives base_up / base_dn); singles get 0..1. */
export function setMorph(name, v) {
  morphValues.set(name, v);
  if (morphMeshes.has(`${name}_up`) || morphMeshes.has(`${name}_dn`)) {
    setRawMorph(`${name}_up`, Math.max(0, v));
    setRawMorph(`${name}_dn`, Math.max(0, -v));
  } else {
    setRawMorph(name, v);
  }
  emit('morph');
}

export function morphValue(name) {
  return morphValues.get(name) ?? 0;
}

/** The ear STYLE also has a morph twin so piercings follow the chosen ear,
 *  see the morph gate in jewel.py. */
function applyEarShapeMorphs() {
  for (const m of Object.values(EAR_SHAPE)) setRawMorph(m, 0);
  const m = EAR_SHAPE[charState.ear];
  if (m) setRawMorph(m, 1);
}

export function resetMorphs({ body = true, face = true } = {}) {
  const names = [
    ...(face ? [...FACE_PAIRS, ...EXPRESSIONS] : []),
    ...(body ? BODY_PAIRS : []),
    ...SWAY,
  ];
  for (const n of names) setMorph(n, 0);
  emit('morph');
}

// ---------------------------------------------------------------------------
// Appearance, the game's HSL wheels, applied to the mod_* materials
// ---------------------------------------------------------------------------
export const appearance = {
  // DEFAULT_APPEARANCE in src/render/characters/modular.ts
  skin: { h: 27, s: 0.46, l: 0.68 },
  hair: { h: 26, s: 0.5, l: 0.24 },
  eye: { h: 28, s: 0.42, l: 0.18 },
  lash: { h: 26, s: 0.5, l: 0.15 },
};

const APPEARANCE_TARGETS = {
  skin: ['mod_skin', 'mod_skin_detail'],
  // mod_stubble is the scalp decal, the game's recolour sweep paints it the
  // hair colour, so the wheel here does the same.
  hair: ['mod_hair', 'mod_stubble'],
  eye: ['mod_eye'],
  lash: ['mod_lash'],
};

const materialDefaults = new Map(); // material -> original color (linear)
function captureMaterialDefaults() {
  characterRoot.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m?.color && !materialDefaults.has(m)) materialDefaults.set(m, m.color.clone());
    }
  });
}

/** Identical math to hslToHex in modular.ts (standard HSL), then setHex's
 *  sRGB->linear conversion, the exact colour the game would render. */
export function hslHex(hh, ss, ll) {
  const c = new THREE.Color();
  c.setHSL((((hh % 360) + 360) % 360) / 360, ss, ll, THREE.SRGBColorSpace);
  return c;
}

/** Tint by material NAME across the whole scene, so ghost clones (which keep
 *  the name) and the hair-sculpt preview follow the wheels too. */
export function applyAppearance() {
  const byName = new Map();
  for (const [ch, names] of Object.entries(APPEARANCE_TARGETS)) {
    const { h: hh, s, l } = appearance[ch];
    for (const n of names) byName.set(n, hslHex(hh, s, l));
  }
  scene.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const want = m && byName.get(m.name);
      if (want) m.color.copy(want);
    }
  });
  savePrefs({ appearance: JSON.parse(JSON.stringify(appearance)) });
  // Hair meshes may have (re)loaded since the last pass, re-assert the
  // matcap swap so a fresh standard material never lingers under it.
  applyHairShading();
  emit('appearance');
}

// ---------------------------------------------------------------------------
// Hair shading, optional matcap looks over every mod_hair mesh
// ---------------------------------------------------------------------------
// Preview-only for now: 'standard' is the game's lit material; a matcap key
// swaps every mod_hair mesh (built styles, beards, the raw sculpt preview)
// onto a MeshMatcapMaterial wearing a baked-in-page texture. The swap layer
// stays clear of the two existing material systems: ghosting only ever wraps
// E2 jewels (never mod_hair), and x-ray mutates whatever material is live,
// so we re-run applyXray after swapping to let it adopt the new one.
export const hairShadingState = { key: loadPrefs().hairShading ?? 'standard' };
const matcapMats = new Map(); // `${key}|${side}|${vertexColors}` -> material
const matcapOriginal = new Map(); // mesh -> its standard material, while shaded

function matcapMatFor(key, side, vertexColors) {
  const id = `${key}|${side}|${vertexColors}`;
  let m = matcapMats.get(id);
  if (!m) {
    m = new THREE.MeshMatcapMaterial({ matcap: matcapTexture(key), side, vertexColors });
    // Named mod_hair so applyAppearance's tint-by-name sweep dyes it too.
    m.name = 'mod_hair';
    matcapMats.set(id, m);
  }
  m.color.copy(hslHex(appearance.hair.h, appearance.hair.s, appearance.hair.l));
  return m;
}

export function applyHairShading() {
  const key = hairShadingState.key;
  const live = new Set();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (Array.isArray(o.material)) return; // hair meshes are single-material
    const isHair = o.material?.name === 'mod_hair' || matcapOriginal.has(o);
    if (!isHair) return;
    live.add(o);
    if (key === 'standard') {
      const orig = matcapOriginal.get(o);
      if (orig) {
        o.material = orig;
        matcapOriginal.delete(o);
      }
      return;
    }
    if (!matcapOriginal.has(o)) matcapOriginal.set(o, o.material);
    const orig = matcapOriginal.get(o);
    // The sculpt preview is a one-sided shell shown DoubleSide; built hair
    // carries the COLOR_0 cavity bake, both survive the swap.
    o.material = matcapMatFor(key, orig.side, !!o.geometry?.getAttribute('color'));
  });
  // A style that unloaded takes its swap record with it.
  for (const m of [...matcapOriginal.keys()]) if (!live.has(m)) matcapOriginal.delete(m);
  if (xrayPrefs.on) applyXray();
}

export function setHairShading(key) {
  hairShadingState.key = key;
  savePrefs({ hairShading: key });
  applyHairShading();
  emit('shading');
}

export function resetAppearance() {
  appearance.skin = { h: 27, s: 0.46, l: 0.68 };
  appearance.hair = { h: 26, s: 0.5, l: 0.24 };
  appearance.eye = { h: 28, s: 0.42, l: 0.18 };
  appearance.lash = { h: 26, s: 0.5, l: 0.15 };
  for (const [m, color] of materialDefaults) m.color.copy(color);
  applyAppearance();
}

// ---------------------------------------------------------------------------
// State setters
// ---------------------------------------------------------------------------
export function setCharField(field, value) {
  charState[field] = value;
  if (field === 'gender' && !charState.lashesTouched) charState.lashes = value === 'F';
  if (field === 'lashes') charState.lashesTouched = true;
  if (field === 'ear') applyEarShapeMorphs();
  applyVisibility();
  emit('char');
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const optNone = (xs) => ['none', ...xs];

export function buildCharacterPanel(host) {
  const opts = variantOptions();

  const bodySec = section('char-body', 'Body', { open: true });
  const genderSeg = segmented(
    [
      { value: 'M', label: 'Male' },
      { value: 'F', label: 'Female' },
    ],
    charState.gender,
    (v) => {
      setCharField('gender', v);
      rebuildFaceSelects();
      lashSwitch.set(charState.lashes);
    },
  );
  bodySec.body.append(
    h(
      'div',
      { class: 'row' },
      h('label', {}, 'Gender'),
      h('span', { class: 'grow' }),
      genderSeg.root,
    ),
  );
  const underSwitch = switchRow({
    label: 'Underclothes',
    value: charState.underwear,
    onChange: (v) => setCharField('underwear', v),
  });
  const stubbleSwitch = switchRow({
    label: 'Scalp stubble',
    value: charState.scalpStubble,
    onChange: (v) => setCharField('scalpStubble', v),
  });
  bodySec.body.append(
    underSwitch.root,
    stubbleSwitch.root,
    h('div', { class: 'note' }, 'The under-hair growth every non-bald style wears in game.'),
  );

  const wornSec = section('char-worn', 'Worn', { open: true });
  const armorSel = selectRow({
    label: 'Armor',
    options: ['none', ...opts.armor],
    value: charState.armor || 'none',
    onChange: (v) => setCharField('armor', v === 'none' ? '' : v),
  });
  const helmSwitch = switchRow({
    label: 'Helm',
    value: charState.helm,
    onChange: (v) => setCharField('helm', v),
  });
  const beardSel = selectRow({
    label: 'Beard',
    options: optNone(opts.beard),
    value: charState.beard,
    onChange: (v) => setCharField('beard', v),
  });
  const hairSel = selectRow({
    label: 'Built hair',
    options: optNone(opts.builtHair),
    value: charState.builtHair,
    onChange: (v) => setCharField('builtHair', v),
  });
  wornSec.body.append(
    armorSel.root,
    helmSwitch.root,
    beardSel.root,
    hairSel.root,
    h(
      'div',
      { class: 'note' },
      'Built hair shows a finished style for context, handy while placing piercings.',
    ),
  );

  const faceSec = section('char-face', 'Face parts', { open: false });
  const faceSelects = {};
  let lashSwitch;
  function rebuildFaceSelects() {
    const o = variantOptions();
    faceSec.body.replaceChildren();
    for (const [field, list, label] of [
      ['ear', o.ear, 'Ears'],
      ['brow', o.brow, 'Brows'],
      ['eyeShape', o.eyeShape, 'Eyes'],
      ['mouth', o.mouth, 'Mouth'],
    ]) {
      faceSelects[field] = selectRow({
        label,
        options: list,
        value: charState[field],
        onChange: (v) => setCharField(field, v),
      });
      faceSec.body.append(faceSelects[field].root);
    }
    lashSwitch = switchRow({
      label: 'Lashes',
      value: charState.lashes,
      onChange: (v) => setCharField('lashes', v),
    });
    faceSec.body.append(lashSwitch.root);
  }
  rebuildFaceSelects();

  // Keep the controls honest when state changes from outside the panel
  // (scripted hooks, keyboard, gender flip rebuilding face options).
  onCharacterChange((what) => {
    if (what !== 'char' && what !== 'anim') return;
    genderSeg.set(charState.gender);
    underSwitch.set(charState.underwear);
    stubbleSwitch.set(charState.scalpStubble);
    armorSel.set(charState.armor || 'none');
    helmSwitch.set(charState.helm);
    beardSel.set(charState.beard);
    hairSel.set(charState.builtHair);
    animSel.set(charState.anim);
    for (const [field, row] of Object.entries(faceSelects)) row.set(charState[field]);
    lashSwitch?.set(charState.lashes);
  });

  const animSec = section('char-anim', 'Animation', { open: true });
  const animSel = selectRow({
    label: 'Clip',
    options: [{ value: '', label: 'off: rest pose' }, ...characterClips.map((c) => c.name)],
    value: charState.anim,
    onChange: (v) => setAnimation(v),
  });
  const speed = sliderRow({
    label: 'Speed',
    min: 0.1,
    max: 2,
    step: 0.05,
    value: charState.animSpeed,
    onInput: (v) => setAnimSpeed(v),
  });
  const pauseBtn = btn({
    ic: 'pause',
    label: 'Pause',
    onClick: () => {
      setAnimPaused(!charState.animPaused);
      pauseBtn.replaceChildren(
        icon(charState.animPaused ? 'play' : 'pause'),
        charState.animPaused ? 'Resume' : 'Pause',
      );
    },
  });
  animSec.body.append(animSel.root, speed.root, h('div', { class: 'actions' }, pauseBtn));

  host.append(bodySec.root, wornSec.root, faceSec.root, animSec.root);
}

function hslSliders(hostSec, channel, onAny) {
  const a = appearance[channel];
  const hue = sliderRow({
    label: 'Hue',
    min: 0,
    max: 360,
    step: 1,
    value: a.h,
    digits: 0,
    hue: true,
    onInput: (v) => {
      a.h = v;
      onAny();
    },
  });
  const sat = sliderRow({
    label: 'Saturation',
    min: 0,
    max: 1,
    step: 0.01,
    value: a.s,
    onInput: (v) => {
      a.s = v;
      onAny();
    },
  });
  const light = sliderRow({
    label: 'Lightness',
    min: 0.02,
    max: 0.95,
    step: 0.01,
    value: a.l,
    onInput: (v) => {
      a.l = v;
      onAny();
    },
  });
  hostSec.append(hue.root, sat.root, light.root);
  return { hue, sat, light };
}

const css = (h1, s, l) => `hsl(${h1} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

export function buildAppearancePanel(host) {
  const defs = [
    [
      'skin',
      'Skin',
      [
        [27, 0.35, 0.82],
        [27, 0.46, 0.68],
        [28, 0.5, 0.55],
        [25, 0.55, 0.42],
        [22, 0.5, 0.3],
        [18, 0.42, 0.2],
        [95, 0.28, 0.5],
      ],
    ],
    [
      'hair',
      'Hair',
      [
        [0, 0, 0.07],
        [26, 0.5, 0.24],
        [18, 0.55, 0.34],
        [45, 0.62, 0.6],
        [16, 0.78, 0.45],
        [0, 0, 0.88],
        [275, 0.45, 0.45],
      ],
    ],
    [
      'eye',
      'Eyes',
      [
        [28, 0.42, 0.18],
        [35, 0.5, 0.3],
        [120, 0.38, 0.34],
        [210, 0.5, 0.42],
        [210, 0.12, 0.55],
        [42, 0.7, 0.42],
        [0, 0.65, 0.38],
      ],
    ],
    [
      'lash',
      'Lashes',
      [
        [26, 0.5, 0.15],
        [0, 0, 0.06],
        [18, 0.5, 0.3],
        [45, 0.55, 0.55],
        [275, 0.45, 0.45],
        [210, 0.45, 0.45],
        [330, 0.55, 0.55],
      ],
    ],
  ];
  for (const [channel, label, swatchHsl] of defs) {
    const sec = section(`app-${channel}`, label, {
      open: channel === 'skin' || channel === 'hair',
    });
    const sliders = hslSliders(sec.body, channel, () => applyAppearance());
    const grid = swatchGrid(
      swatchHsl.map(([h1, s, l]) => ({ key: `${h1},${s},${l}`, css: css(h1, s, l) })),
      null,
      (key) => {
        const [h1, s, l] = key.split(',').map(Number);
        Object.assign(appearance[channel], { h: h1, s, l });
        sliders.hue.set(h1);
        sliders.sat.set(s);
        sliders.light.set(l);
        applyAppearance();
      },
    );
    sec.body.append(grid.root);
    if (channel === 'hair') {
      sec.body.append(h('div', { class: 'row' }, h('label', {}, 'Shading')));
      const shadeGrid = swatchGrid(
        [
          {
            key: 'standard',
            css: 'radial-gradient(circle at 35% 30%, #8a8f98, #34383f)',
            tip: "Standard: the game's lit material",
          },
          ...MATCAP_PRESETS.map((p) => ({ key: p.key, css: matcapSwatchCss(p.key), tip: p.tip })),
        ],
        hairShadingState.key,
        (key) => setHairShading(key),
      );
      sec.body.append(
        shadeGrid.root,
        h(
          'div',
          { class: 'note' },
          'Matcap looks are studio-only previews, they ignore the Scene lights. Standard is what ships in game.',
        ),
      );
      onCharacterChange((what) => {
        if (what === 'shading') shadeGrid.set(hairShadingState.key);
      });
    }
    host.append(sec.root);
  }
  const resetB = btn({
    ic: 'reset',
    label: 'Reset appearance',
    onClick: () => {
      resetAppearance();
      toast('Appearance reset to game defaults');
      host.replaceChildren();
      buildAppearancePanel(host);
    },
  });
  host.append(h('div', { class: 'actions' }, resetB));
}

function morphSlider(name, label, { min = -1, max = 1 } = {}) {
  const row = sliderRow({
    label,
    min,
    max,
    step: 0.01,
    value: morphValue(name),
    onInput: (v) => setMorph(name, v),
    onCommit: (v, old) =>
      history.push({
        label: `morph ${label}`,
        merge: `morph:${name}`,
        undo: () => {
          setMorph(name, old);
          row.set(old);
        },
        redo: () => {
          setMorph(name, v);
          row.set(v);
        },
      }),
  });
  morphUiRows.set(name, row);
  return row.root;
}
const morphUiRows = new Map();

export function buildMorphsPanel(host) {
  morphUiRows.clear();
  const face = section('morph-face', 'Face', { open: true });
  for (const p of FACE_PAIRS) face.body.append(morphSlider(p, cap(p)));
  const expr = section('morph-expr', 'Expression', { open: false });
  for (const p of EXPRESSIONS)
    expr.body.append(morphSlider(p, cap(p.replace('mouth_', '')), { min: 0 }));
  const body = section('morph-body', 'Body', { open: true });
  for (const p of BODY_PAIRS) body.body.append(morphSlider(p, cap(p.replace('body_', ''))));
  const sway = section('morph-sway', 'Hair sway (preview)', { open: false });
  for (const p of SWAY)
    sway.body.append(morphSlider(p, p.replace('hair_sway_', 'Sway ').toUpperCase(), { min: 0 }));
  sway.body.append(
    h(
      'div',
      { class: 'note' },
      'Sway morphs only exist on hanging styles, pick one as Built hair to see them.',
    ),
  );

  const actions = h(
    'div',
    { class: 'actions' },
    btn({
      ic: 'dice',
      label: 'Random face',
      onClick: () => {
        for (const p of FACE_PAIRS) {
          const v = Math.round((Math.random() * 1.6 - 0.8) * 100) / 100;
          setMorph(p, v);
          morphUiRows.get(p)?.set(v);
        }
      },
    }),
    btn({
      ic: 'reset',
      label: 'Reset all',
      onClick: () => {
        resetMorphs();
        for (const [n, row] of morphUiRows) row.set(morphValue(n));
      },
    }),
  );
  host.append(face.root, expr.root, body.root, sway.root, actions);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const listeners = new Set();
function emit(what) {
  for (const fn of listeners) fn(what);
}
export function onCharacterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
