// Standalone external HTML Spell & VFX Studio (/dev/spell_studio.html).
//
// Lets the developer browse all 9 classes, inspect each class's 3 specializations,
// filter by spec/kit/talents/basics, and click any spell to watch the dressed WOC
// character model play its cast loop, release/strike animation, and full AbilityVfx
// presentation against a target dummy on a dedicated 3D stage.

import * as THREE from 'three';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import type { AnimState } from '../src/render/characters/anim_state';
import { directBuildAssetsResident, visualAssetsResident } from '../src/render/characters/assets';
import { VISUALS } from '../src/render/characters/manifest';
import { CharacterVisual } from '../src/render/characters/visual';
import { wocKitResident } from '../src/render/characters/woc_armor_dressing';
import { ensureWocHeadForAppearance } from '../src/render/characters/woc_head_packs';
import { initGfxTier } from '../src/render/gfx';
import {
  buildAllClassSpellCatalogs,
  buildClassSpellCatalog,
  type ClassSpellCatalog,
  filterSpellCatalogEntries,
  SPELL_LAB_LOADOUT_PRESETS,
  type SpellLabEntry,
  type SpellLabFilterTab,
  type SpellLabLoadoutPresetId,
} from '../src/render/spell_lab/spell_lab_catalog_core';
import { SCHOOL_COLORS, Vfx } from '../src/render/vfx';
import { createOffsetVfxAnchor, createVfxAnchor } from '../src/render/vfx_anchor';
import { sampleWarriorPowerBone } from '../src/render/warrior_power_anchor';
import { sampleHandAnchor, weaponTrailAnchor } from '../src/render/weapon_trail_anchor';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';

const CASTER_ID = 1;
const DUMMY_ID = 2;
const CASTER_POS = new THREE.Vector3(-1.45, 0, 0);
const DUMMY_POS = new THREE.Vector3(1.55, 0, 0);
const CASTER_YAW = Math.PI * 0.5;
const DUMMY_YAW = -Math.PI * 0.5;

let selectedClass: PlayerClass = 'warrior';
let selectedTab: SpellLabFilterTab = 'all';
let selectedLoadout: SpellLabLoadoutPresetId = 'default';
let selectedFit: 'male' | 'female' = 'male';
let searchQuery = '';
let selectedEntryId: string | null = null;
let currentCasterVisualKey = '';

const allDefaultCatalogs = buildAllClassSpellCatalogs('default');

function currentCatalog(): ClassSpellCatalog {
  if (selectedLoadout === 'default') {
    return allDefaultCatalogs[selectedClass];
  }
  return buildClassSpellCatalog(selectedClass, selectedLoadout);
}

function currentVisibleEntries(): SpellLabEntry[] {
  const catalog = currentCatalog();
  return filterSpellCatalogEntries(catalog.entries, {
    tab: selectedTab,
    query: searchQuery,
  });
}

// ---------------------------------------------------------------------------
// 3D Stage Setup (with WebGL domain-block auto-recovery)
// ---------------------------------------------------------------------------

function canCreateWebGLContext(): boolean {
  try {
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('webgl2') || probe.getContext('webgl');
    return ctx !== null;
  } catch {
    return false;
  }
}

if (!canCreateWebGLContext() && window.location.hostname === 'localhost') {
  window.location.replace(window.location.href.replace('://localhost:', '://127.0.0.1:'));
}

const canvas = document.getElementById('studio-canvas') as HTMLCanvasElement;
const canvasWrap = document.getElementById('canvas-wrap') as HTMLElement;
const loadingEl = document.getElementById('stage-loading') as HTMLElement;

let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  initGfxTier(renderer);
} catch (err) {
  console.warn('[spell-studio] WebGL context creation failed:', err);
  loadingEl.style.display = 'block';
  loadingEl.style.pointerEvents = 'auto';
  const altUrl = window.location.href.replace('://localhost:', '://127.0.0.1:');
  loadingEl.innerHTML = `<div style="max-width:360px;line-height:1.5;">
    <div style="margin-bottom:8px;color:#fca5a5;">Browser blocked WebGL on this origin after an earlier GPU reset.</div>
    <a href="${altUrl}" style="display:inline-block;padding:6px 12px;background:#f3c969;color:#0f172a;border-radius:6px;text-decoration:none;font-weight:700;">Open on 127.0.0.1:5173</a>
  </div>`;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c111d);
scene.fog = new THREE.FogExp2(0x0c111d, 0.022);

const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 160);

// Studio lighting
const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xfff4dc, 1.85);
keyLight.position.set(6, 11, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 32;
const shadowBounds = 8;
keyLight.shadow.camera.left = -shadowBounds;
keyLight.shadow.camera.right = shadowBounds;
keyLight.shadow.camera.top = shadowBounds;
keyLight.shadow.camera.bottom = -shadowBounds;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.85);
rimLight.position.set(-7, 6, -6);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xfde68a, 0.45);
fillLight.position.set(0, 4, 9);
scene.add(fillLight);

// Arena floor disc + subtle measurement grid
const floorGeo = new THREE.CircleGeometry(14, 64);
floorGeo.rotateX(-Math.PI / 2);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x151d2e,
  roughness: 0.86,
  metalness: 0.08,
});
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const gridHelper = new THREE.GridHelper(24, 24, 0x334155, 0x1e293b);
gridHelper.position.y = 0.005;
scene.add(gridHelper);

function makePadRing(x: number, z: number, color: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.68, 0.78, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0.012, z);
  scene.add(mesh);
  return mesh;
}

const casterRing = makePadRing(CASTER_POS.x, CASTER_POS.z, 0xf3c969);
const dummyRing = makePadRing(DUMMY_POS.x, DUMMY_POS.z, 0xf87171);

function stageDummyAtX(x: number): void {
  DUMMY_POS.x = x;
  dummyRing.position.x = x;
  const dummyVis = views.get(DUMMY_ID);
  if (dummyVis) {
    dummyVis.root.position.x = x;
  }
}

// Transient AoE ground ring flash for spells that call spawnAoeRing
const aoeFlashGeo = new THREE.RingGeometry(0.88, 1.0, 48);
aoeFlashGeo.rotateX(-Math.PI / 2);
const aoeFlashMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const aoeFlashMesh = new THREE.Mesh(aoeFlashGeo, aoeFlashMat);
aoeFlashMesh.position.y = 0.025;
aoeFlashMesh.visible = false;
scene.add(aoeFlashMesh);
let aoeFlashTimer = 0;

function triggerAoeFlash(
  x: number,
  z: number,
  radius: number,
  school: string,
  colorHex?: number,
): void {
  aoeFlashMesh.position.set(x, 0.025, z);
  aoeFlashMesh.scale.setScalar(Math.max(1, radius));
  aoeFlashMat.color.setHex(colorHex ?? SCHOOL_COLORS[school] ?? 0xf3c969);
  aoeFlashMat.opacity = 0.65;
  aoeFlashMesh.visible = true;
  aoeFlashTimer = 0.65;
}

// ---------------------------------------------------------------------------
// Orbit / Pan / Zoom Camera Controller (aspect-aware framing)
// ---------------------------------------------------------------------------

const camTarget = new THREE.Vector3(0, 1.05, 0);
let camYaw = 0.16;
let camPitch = 0.32;
let camDist = 6.8;

function updateCameraTransform(): void {
  const aspectFactor = 1 / Math.min(1, Math.max(0.5, camera.aspect * 0.92));
  const effDist = camDist * aspectFactor;
  const cosP = Math.cos(camPitch);
  const sinP = Math.sin(camPitch);
  const sinY = Math.sin(camYaw);
  const cosY = Math.cos(camYaw);
  camera.position.set(
    camTarget.x + effDist * cosP * sinY,
    camTarget.y + effDist * sinP,
    camTarget.z + effDist * cosP * cosY,
  );
  camera.lookAt(camTarget);
}
updateCameraTransform();

let dragMode: 'none' | 'orbit' | 'pan' = 'none';
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragMode === 'none') return;
  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  if (dragMode === 'orbit') {
    camYaw -= dx * 0.007;
    camPitch = Math.max(0.05, Math.min(1.38, camPitch + dy * 0.007));
  } else {
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    camTarget.addScaledVector(right, -dx * 0.01);
    camTarget.y = Math.max(0.2, Math.min(3.5, camTarget.y + dy * 0.01));
  }
  updateCameraTransform();
});
canvas.addEventListener('pointerup', (e) => {
  dragMode = 'none';
  if (canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camDist = Math.max(2.6, Math.min(18, camDist + e.deltaY * 0.006));
    updateCameraTransform();
  },
  { passive: false },
);

function setCameraPreset(preset: string): void {
  if (preset === 'studio') {
    camTarget.set(0, 1.05, 0);
    camYaw = 0.16;
    camPitch = 0.32;
    camDist = 6.8;
  } else if (preset === 'side') {
    camTarget.set(0, 1.0, 0);
    camYaw = 0;
    camPitch = 0.16;
    camDist = 6.4;
  } else if (preset === 'caster') {
    camTarget.set(CASTER_POS.x + 0.25, 1.1, CASTER_POS.z);
    camYaw = 0.65;
    camPitch = 0.24;
    camDist = 3.8;
  } else if (preset === 'overhead') {
    camTarget.set(0, 0.6, 0);
    camYaw = 0.08;
    camPitch = 1.18;
    camDist = 9.2;
  }
  updateCameraTransform();
}

// ---------------------------------------------------------------------------
// Live Views & Real AbilityVfx / AbilityVfxFx / Vfx Engine
// ---------------------------------------------------------------------------

const views = new Map<number, CharacterVisual>();

const fillPose = (
  id: number,
  out: { x: number; y: number; z: number; height: number; yaw?: number; scale?: number },
): boolean => {
  const vis = views.get(id);
  const pos = id === CASTER_ID ? CASTER_POS : id === DUMMY_ID ? DUMMY_POS : null;
  if (!pos) return false;
  out.x = vis ? vis.root.position.x : pos.x;
  out.y = vis ? vis.root.position.y : pos.y;
  out.z = vis ? vis.root.position.z : pos.z;
  out.height = vis?.height ?? 1.85;
  out.yaw = vis ? vis.root.rotation.y : id === CASTER_ID ? CASTER_YAW : DUMMY_YAW;
  out.scale = 1;
  return true;
};

const vfxAnchor = createVfxAnchor(fillPose);
const offsetVfxAnchor = createOffsetVfxAnchor(fillPose);
const vfx = new Vfx(scene, vfxAnchor, offsetVfxAnchor, () => 0);

function isMorphFormEntry(entry?: SpellLabEntry | null): boolean {
  if (!entry || entry.kind !== 'ability') return false;
  return (
    entry.id === 'shadowform' ||
    entry.id === 'moonkin_form' ||
    entry.id === 'divine_ascension' ||
    entry.id === 'metamorphosis' ||
    entry.id === 'avatar' ||
    entry.id === 'ghost_wolf' ||
    entry.id === 'bear_form' ||
    entry.id === 'cat_form' ||
    entry.id === 'travel_form'
  );
}

const abilityFx = new AbilityVfxFx(
  scene,
  camera,
  vfxAnchor,
  () => 0,
  (id) =>
    views.get(id)?.root.rotation.y ??
    (id === CASTER_ID ? CASTER_YAW : id === DUMMY_ID ? DUMMY_YAW : null),
  (id, hand) => {
    const root = views.get(id)?.root;
    return root ? weaponTrailAnchor(root, hand) : null;
  },
  (id, hand, out) => {
    const root = views.get(id)?.root;
    return root ? sampleHandAnchor(root, hand, out) : false;
  },
  () => true,
  (id, piece, out) => {
    const root = views.get(id)?.root;
    return root ? sampleWarriorPowerBone(root, piece, out) : false;
  },
  (id, hand) => {
    if (id !== CASTER_ID) return false;
    const cat = currentCatalog();
    return hand === 0 ? Boolean(cat.mainhandItemId) : Boolean(cat.offhandItemId);
  },
);

const abilityVfx = new AbilityVfx({
  vfx,
  fx: abilityFx,
  anchor: (id, heightFrac) => vfxAnchor(id, heightFrac),
  spawnAoeRing: (x, z, radius, school, colorHex) => triggerAoeFlash(x, z, radius, school, colorHex),
  triggerAttack: (entityId, abilityId) => {
    views.get(entityId)?.playAttack(abilityId, true);
  },
  setAuraGlow: (entityId, colorHex, intensity) => {
    if (entityId !== CASTER_ID) return;
    if (intensity > 0.01 && !isMorphFormEntry(activePlayback?.entry)) return;
    views.get(entityId)?.setAuraGlow(colorHex, intensity);
  },
  playShoutAnim: (entityId) => {
    const rig = views.get(entityId);
    if (rig && !rig.isMidOneShot) rig.playShout(1);
  },
  isMob: (entityId) => entityId === DUMMY_ID,
  castingAbilityOf: (entityId) =>
    entityId === CASTER_ID && activePlayback?.phase === 'cast' ? activePlayback.entry.id : null,
  isMidOneShot: (entityId) => Boolean(views.get(entityId)?.isMidOneShot),
  localPlayerId: () => CASTER_ID,
  isWarrior: (entityId) => entityId === CASTER_ID && selectedClass === 'warrior',
  isLivingWarrior: (entityId) => entityId === CASTER_ID && selectedClass === 'warrior',
  warriorSpecOf: (entityId) => {
    if (entityId !== CASTER_ID) return null;
    if (
      selectedTab !== 'all' &&
      selectedTab !== 'base' &&
      selectedTab !== 'talents' &&
      selectedTab !== 'basic'
    ) {
      return selectedTab;
    }
    return activePlayback?.entry.specIds[0] ?? null;
  },
  hasGestureClip: (entityId, abilityId) =>
    views.get(entityId)?.hasAttackClipOverride(abilityId) ?? false,
  isInstantAbility: (abilityId) => {
    const def = ABILITIES[abilityId];
    return !def || (def.castTime <= 0 && !def.channel && !def.empowerStages);
  },
  animHold: (entityId, scale, dur) => views.get(entityId)?.holdFrame(scale, dur),
  bodyLean: (entityId, amount) => views.get(entityId)?.setWindupLean(amount),
});

function resizeStage(): void {
  const rect = canvasWrap.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer?.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateCameraTransform();
  vfx.setViewportScale(h * pr, camera.fov);
  abilityFx.setViewportScale(h * pr, camera.fov, h);
}
window.addEventListener('resize', resizeStage);
resizeStage();

// ---------------------------------------------------------------------------
// Character Visual Loader (Caster + Target Dummy + Druid Shapeshift Forms)
// ---------------------------------------------------------------------------

let buildToken = 0;

function desiredCasterVisualKey(entry?: SpellLabEntry | null): string {
  if (selectedClass === 'druid' && entry) {
    if (entry.id === 'bear_form' || entry.id === 'bear_charge' || entry.requiresForm === 'bear')
      return 'form_bear';
    if (entry.id === 'cat_form' || entry.requiresForm === 'cat') return 'form_cat';
    if (entry.id === 'travel_form') return 'form_travel';
  }
  const baseKey = `player_${selectedClass}`;
  const femaleKey = `${baseKey}_female`;
  return selectedFit === 'female' && VISUALS[femaleKey] ? femaleKey : baseKey;
}

function isVisualReadyToConstruct(
  visualKey: string,
  mainhandItemId: string | null,
  offhandItemId: string | null,
): boolean {
  const def = VISUALS[visualKey];
  if (!def) return false;
  const bodyReady = directBuildAssetsResident(visualKey, mainhandItemId, offhandItemId);
  if (!def.wocCharacter) return bodyReady;
  const kitReady = wocKitResident(def.wocCharacter);
  const headReady = ensureWocHeadForAppearance(def.wocCharacter.fit, null);
  return bodyReady && kitReady && headReady;
}

async function waitUntilVisualReady(
  visualKey: string,
  mainhandItemId: string | null,
  offhandItemId: string | null,
  token: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (token !== buildToken) return false;
    if (isVisualReadyToConstruct(visualKey, mainhandItemId, offhandItemId)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return token === buildToken;
}

async function ensureDummyVisual(): Promise<void> {
  if (views.has(DUMMY_ID)) return;
  const resolvedKey = VISUALS.mob_training_dummy ? 'mob_training_dummy' : 'player_warrior';
  while (!visualAssetsResident(resolvedKey)) {
    await new Promise((r) => setTimeout(r, 40));
  }
  if (views.has(DUMMY_ID)) return;
  if (VISUALS[resolvedKey]?.wocCharacter) {
    await waitUntilVisualReady(resolvedKey, null, null, buildToken);
  }
  const dummyVis = new CharacterVisual(resolvedKey, 0xd4a373, 0);
  dummyVis.root.position.copy(DUMMY_POS);
  dummyVis.root.rotation.y = DUMMY_YAW;
  scene.add(dummyVis.root);
  views.set(DUMMY_ID, dummyVis);
}

async function rebuildCasterVisual(overrideKey?: string): Promise<void> {
  if (!renderer) return;
  const token = ++buildToken;
  loadingEl.style.display = 'block';

  await ensureDummyVisual();

  const visualKey = overrideKey ?? desiredCasterVisualKey(activePlayback?.entry);
  const catalog = currentCatalog();
  const isForm = visualKey.startsWith('form_');
  const mainhand = isForm ? null : catalog.mainhandItemId;
  const offhand = isForm ? null : catalog.offhandItemId;

  (casterRing.material as THREE.MeshBasicMaterial).color.set(catalog.classColor);

  const ok = await waitUntilVisualReady(visualKey, mainhand, offhand, token);
  if (!ok) return;

  const prev = views.get(CASTER_ID);
  if (prev) {
    scene.remove(prev.root);
    prev.dispose();
    views.delete(CASTER_ID);
  }

  const cdef = CLASSES[selectedClass];
  const casterVis = new CharacterVisual(visualKey, cdef.color, 0, mainhand, null, offhand);
  casterVis.root.position.copy(CASTER_POS);
  casterVis.root.rotation.y = CASTER_YAW;
  scene.add(casterVis.root);
  views.set(CASTER_ID, casterVis);
  currentCasterVisualKey = visualKey;

  loadingEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Playback State Machine (Cast Loop -> Release/Strike + AbilityVfx)
// ---------------------------------------------------------------------------

interface ActivePlayback {
  entry: SpellLabEntry;
  phase: 'cast' | 'strike' | 'hold';
  phaseElapsed: number;
  castDuration: number;
  strikeDuration: number;
  channelTickAccum: number;
}

let activePlayback: ActivePlayback | null = null;
let playbackSpeed = 1;
let fastCasts = true;
let sequenceTimer: number | null = null;
let sequenceIndex = 0;

function playStudioReleaseAnimation(casterVis: CharacterVisual, entry: SpellLabEntry): void {
  if (entry.id === 'whirlwind' || entry.id === 'bladestorm' || entry.id === 'dawnfall') {
    casterVis.playWhirl(entry.id);
    return;
  }
  if (entry.resolvedClip === 'Woc_Shout') {
    casterVis.playEmote('roar');
    return;
  }
  if (
    entry.passive ||
    entry.resolvedClip === 'Woc_Combat_Idle_1H' ||
    entry.resolvedClip === 'Woc_Combat_Idle_Dual' ||
    entry.resolvedClip === 'Run'
  ) {
    return;
  }
  if (casterVis.hasAttackClipOverride(entry.id)) {
    casterVis.playAttack(entry.id, false);
    return;
  }
  if (entry.resolvedClip === 'Woc_Cast_Shoot') {
    casterVis.playAttack(undefined, false, 'wand');
    return;
  }
  if (entry.resolvedClip === 'Woc_Cast_Omni_Release') {
    const vdef = VISUALS[currentCasterVisualKey];
    const clips = vdef?.clips;
    if (clips) {
      const prevMap = clips.attackByAbility;
      const hadPrev = prevMap && Object.hasOwn(prevMap, entry.id);
      const prevVal = prevMap?.[entry.id];
      clips.attackByAbility ??= {};
      const map = clips.attackByAbility;
      map[entry.id] = 'Woc_Cast_Omni_Release';
      casterVis.playAttack(entry.id, true);
      if (hadPrev && prevVal !== undefined) {
        map[entry.id] = prevVal;
      } else {
        delete map[entry.id];
      }
      return;
    }
  }
  casterVis.playAttack(entry.id, false);
}

function triggerReleaseImpact(entry: SpellLabEntry): void {
  const casterVis = views.get(CASTER_ID);
  const dummyVis = views.get(DUMMY_ID);

  if (entry.kind === 'basic') {
    if (entry.id === '__auto_melee') {
      casterVis?.playAttack(undefined, false, 'melee');
      vfx.meleeSpark(DUMMY_ID, false);
      dummyVis?.playHit();
    } else if (entry.id === '__auto_ranged') {
      casterVis?.playAttack();
      vfx.projectile(CASTER_ID, DUMMY_ID, 'physical', 1);
      dummyVis?.playHit();
    } else if (entry.id === '__auto_wand') {
      casterVis?.playAttack(undefined, false, 'wand');
      vfx.projectile(CASTER_ID, DUMMY_ID, entry.school, 1);
      dummyVis?.playHit();
    } else if (entry.id === '__pose_hit') {
      casterVis?.playHit();
    }
    return;
  }

  const def = ABILITIES[entry.id];
  if (!def) return;

  if (casterVis) {
    playStudioReleaseAnimation(casterVis, entry);
  }

  const selfCentered =
    def.selfCentered === true ||
    !def.requiresTarget ||
    def.targetType === 'friendly' ||
    def.range === 0;
  const targetId = selfCentered ? CASTER_ID : DUMMY_ID;
  const targetPos = selfCentered ? CASTER_POS : DUMMY_POS;

  // Bespoke Paladin VFX methods (wired directly in renderer.ts lines 7434-7472)
  if (def.id === 'final_edict') {
    vfx.paladinFinalEdict(CASTER_ID, DUMMY_ID);
    dummyVis?.playHit();
    return;
  }
  if (def.id === 'dawnfall') {
    vfx.paladinDawnfall(CASTER_ID, 6);
    vfx.paladinDawnfallImpact(DUMMY_ID);
    dummyVis?.playHit();
    return;
  }
  if (def.id === 'bastion_sweep') {
    vfx.paladinBastionSweep(CASTER_ID, 6, 180, CASTER_YAW);
    vfx.paladinBastionSweepImpact(DUMMY_ID);
    dummyVis?.playHit();
    return;
  }
  if (def.id === 'sunward_disc') {
    vfx.paladinSunwardDisc(CASTER_ID, DUMMY_ID, 0, 3);
    vfx.paladinSunwardDiscImpact(CASTER_ID, DUMMY_ID, 0, 3);
    dummyVis?.playHit();
    return;
  }
  if (def.id === 'holy_shock' || def.id === 'solar_invocation') {
    vfx.paladinHolyShock(CASTER_ID, DUMMY_ID, 'damage');
    dummyVis?.playHit();
    return;
  }
  if (def.id === 'divine_ascension') {
    vfx.paladinAscensionImpact(CASTER_ID, CASTER_ID, 'area');
    vfx.buffSwirl(CASTER_ID);
    return;
  }

  const fxKind: string =
    def.projectileFx ??
    def.castFx ??
    (def.castTime > 0
      ? 'projectile'
      : entry.vfxArchetype === 'nova' || entry.vfxArchetype === 'shout'
        ? 'nova'
        : 'selfCast');

  if (def.targetMode === 'position') {
    const handledAt = abilityVfx.handleSpellfxAt({
      x: targetPos.x,
      z: targetPos.z,
      school: def.school,
      fx: fxKind,
      ability: def.id,
      radius: 5,
      sourceId: CASTER_ID,
    });
    if (!handledAt) {
      triggerAoeFlash(targetPos.x, targetPos.z, 5, def.school);
    }
  }

  const claimed = abilityVfx.handleSpellfx({
    sourceId: CASTER_ID,
    targetId,
    school: def.school,
    fx: fxKind,
    ability: def.id,
  });

  if (!claimed) {
    if (fxKind === 'projectile' || fxKind === 'heavyBolt') {
      vfx.projectile(CASTER_ID, targetId, def.school, fxKind === 'heavyBolt' ? 1.35 : 1);
    } else if (fxKind === 'lightning') {
      vfx.lightningProjectile(CASTER_ID, targetId);
    } else if (fxKind === 'beam') {
      vfx.beam(CASTER_ID, targetId, def.school);
    } else if (fxKind === 'nova' || fxKind === 'shout') {
      vfx.nova(CASTER_ID, def.school);
    } else if (def.targetType === 'friendly') {
      vfx.healGlow(CASTER_ID);
    } else {
      vfx.buffSwirl(CASTER_ID);
    }
  }

  if (!def.passive && !selfCentered) {
    abilityVfx.onDamage({
      sourceId: CASTER_ID,
      targetId: DUMMY_ID,
      school: def.school,
      ability: def.id,
      abilityId: def.id,
      kind: 'hit',
      crit: true,
      amount: 380,
    });
    dummyVis?.playHit();
  }
}

function playSpellEntry(entry: SpellLabEntry): void {
  selectedEntryId = entry.id;
  highlightSelectedSpellCard();

  const isMeleeRange =
    entry.id === '__auto_melee' ||
    entry.id === 'dawnfall' ||
    entry.id === 'whirlwind' ||
    entry.id === 'bladestorm' ||
    entry.id === 'bastion_sweep' ||
    (entry.range > 0 && entry.range <= 8);
  stageDummyAtX(isMeleeRange ? 0.05 : 1.65);

  const wantedKey = desiredCasterVisualKey(entry);
  if (renderer && wantedKey !== currentCasterVisualKey) {
    void rebuildCasterVisual(wantedKey).then(() => {
      if (selectedEntryId === entry.id) {
        startPlaybackNow(entry);
      }
    });
    updateActiveSpellHudForEntry(entry);
    return;
  }

  startPlaybackNow(entry);
}

function startPlaybackNow(entry: SpellLabEntry): void {
  const casterVis = views.get(CASTER_ID);
  const dummyVis = views.get(DUMMY_ID);
  if (casterVis) {
    casterVis.setShadowform(entry.id === 'shadowform');
    casterVis.setMoonkin(entry.id === 'moonkin_form');
    casterVis.setAscended(entry.id === 'divine_ascension');
    casterVis.setGhosted(entry.id === 'stealth' || entry.id === 'vanish', 'stealth');
    if (!isMorphFormEntry(entry)) {
      casterVis.setAuraGlow(0xffffff, 0);
    }
  }
  dummyVis?.setAuraGlow(0xffffff, 0);

  const hasPrep = entry.castTime > 0 || entry.channeled;
  const rawPrep = entry.channeled ? Math.max(1.1, entry.channelDuration) : entry.castTime;
  const castDuration = hasPrep ? (fastCasts ? Math.min(rawPrep, 0.55) : rawPrep) : 0;
  const strikeDuration = entry.id === '__pose_combat_idle' ? 2.0 : 1.05;

  activePlayback = {
    entry,
    phase: castDuration > 0 ? 'cast' : 'strike',
    phaseElapsed: 0,
    castDuration,
    strikeDuration,
    channelTickAccum: 0,
  };

  if (castDuration === 0) {
    triggerReleaseImpact(entry);
  }

  updateActiveSpellHud();
}

function buildCasterAnimState(): AnimState {
  const isCasting = Boolean(activePlayback && activePlayback.phase === 'cast');
  const isRunningForm = activePlayback?.entry.id === 'travel_form';
  return {
    speed: isRunningForm ? 7 : 0,
    moving: isRunningForm,
    running: isRunningForm,
    airborne: false,
    backwards: false,
    dead: false,
    casting: isCasting,
    castingAbility:
      isCasting && activePlayback?.entry.kind === 'ability' ? activePlayback.entry.id : null,
    combat: true,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
  };
}

function buildDummyAnimState(): AnimState {
  return {
    speed: 0,
    moving: false,
    running: false,
    airborne: false,
    backwards: false,
    dead: false,
    casting: false,
    combat: true,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
  };
}

// ---------------------------------------------------------------------------
// UI State & DOM Rendering
// ---------------------------------------------------------------------------

const classGridEl = document.getElementById('class-grid') as HTMLElement;
const specListEl = document.getElementById('spec-list') as HTMLElement;
const categoryListEl = document.getElementById('category-list') as HTMLElement;
const activeClassLabelEl = document.getElementById('active-class-label') as HTMLElement;
const activeSpecLabelEl = document.getElementById('active-spec-label') as HTMLElement;
const rightTitleEl = document.getElementById('right-title') as HTMLElement;
const rightCountEl = document.getElementById('right-count') as HTMLElement;
const spellListEl = document.getElementById('spell-list') as HTMLElement;
const spellSearchEl = document.getElementById('spell-search') as HTMLInputElement;
const loadoutSelectEl = document.getElementById('loadout-select') as HTMLSelectElement;
const resolvedLoadoutBadgeEl = document.getElementById('resolved-loadout-badge') as HTMLElement;

const hudSpellNameEl = document.getElementById('hud-spell-name') as HTMLElement;
const hudSpellIdEl = document.getElementById('hud-spell-id') as HTMLElement;
const hudPhaseLabelEl = document.getElementById('hud-phase-label') as HTMLElement;
const hudProgressFillEl = document.getElementById('hud-progress-fill') as HTMLElement;
const hudSpellDescEl = document.getElementById('hud-spell-desc') as HTMLElement;
const hudMetaRowEl = document.getElementById('hud-meta-row') as HTMLElement;

function populateLoadoutSelect(): void {
  loadoutSelectEl.innerHTML = '';
  for (const preset of SPELL_LAB_LOADOUT_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    loadoutSelectEl.appendChild(opt);
  }
  loadoutSelectEl.value = selectedLoadout;
}

function renderClassGrid(): void {
  classGridEl.innerHTML = '';
  for (const cls of ALL_CLASSES) {
    const cat = allDefaultCatalogs[cls];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `class-btn${cls === selectedClass ? ' active' : ''}`;
    btn.style.setProperty('--cls-color', cat.classColor);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'class-btn-name';
    nameSpan.textContent = cat.className;

    const countSpan = document.createElement('span');
    countSpan.className = 'class-btn-count';
    countSpan.textContent = `${cat.entries.length} spells`;

    btn.append(nameSpan, countSpan);
    btn.addEventListener('click', () => {
      if (selectedClass === cls) return;
      stopSequence();
      selectedClass = cls;
      selectedTab = 'all';
      document.documentElement.style.setProperty('--accent', cat.classColor);
      renderLeftPanels();
      renderSpellList();
      void rebuildCasterVisual().then(() => {
        const first =
          currentVisibleEntries().find((e) => e.isSpecSignature) ?? currentVisibleEntries()[0];
        if (first) playSpellEntry(first);
      });
    });
    classGridEl.appendChild(btn);
  }
}

function renderLeftPanels(): void {
  const catalog = currentCatalog();
  document.documentElement.style.setProperty('--accent', catalog.classColor);
  activeClassLabelEl.textContent = catalog.className;
  activeClassLabelEl.style.color = catalog.classColor;
  resolvedLoadoutBadgeEl.textContent = `loadout: ${catalog.resolvedLoadout ?? '1h'}`;

  renderClassGrid();

  // Specializations
  specListEl.innerHTML = '';
  for (const spec of catalog.specs) {
    const specEntries = filterSpellCatalogEntries(catalog.entries, { tab: spec.id });
    const sigDef = ABILITIES[spec.signature];

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `spec-card${selectedTab === spec.id ? ' active' : ''}`;

    const top = document.createElement('div');
    top.className = 'spec-card-top';

    const nameEl = document.createElement('span');
    nameEl.className = 'spec-card-name';
    nameEl.textContent = spec.name;

    const roleEl = document.createElement('span');
    roleEl.className = `spec-role-badge role-${spec.role}`;
    roleEl.textContent = spec.role;

    top.append(nameEl, roleEl);

    const descEl = document.createElement('div');
    descEl.className = 'spec-card-desc';
    descEl.textContent = spec.description;

    const sigEl = document.createElement('div');
    sigEl.className = 'spec-card-sig';
    sigEl.innerHTML = `<span>Signature: ${sigDef ? sigDef.name : spec.signature}</span><span>${specEntries.length} spells</span>`;

    card.append(top, descEl, sigEl);
    card.addEventListener('click', () => {
      stopSequence();
      selectedTab = selectedTab === spec.id ? 'all' : spec.id;
      renderLeftPanels();
      renderSpellList();
      const first =
        currentVisibleEntries().find((e) => e.isSpecSignature) ?? currentVisibleEntries()[0];
      if (first) playSpellEntry(first);
    });
    specListEl.appendChild(card);
  }

  // Category filter buttons
  categoryListEl.innerHTML = '';
  const categories: { tab: SpellLabFilterTab; label: string }[] = [
    { tab: 'all', label: 'All Class Spells' },
    { tab: 'base', label: 'Base Class Kit' },
    { tab: 'talents', label: 'Talent Row Grants' },
    { tab: 'basic', label: 'Basics & Stances' },
  ];

  for (const c of categories) {
    const count = filterSpellCatalogEntries(catalog.entries, { tab: c.tab }).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-btn${selectedTab === c.tab ? ' active' : ''}`;
    btn.innerHTML = `<span>${c.label}</span><span>${count}</span>`;
    btn.addEventListener('click', () => {
      stopSequence();
      selectedTab = c.tab;
      renderLeftPanels();
      renderSpellList();
    });
    categoryListEl.appendChild(btn);
  }

  const specObj = catalog.specs.find((s) => s.id === selectedTab);
  if (specObj) {
    activeSpecLabelEl.textContent = specObj.name;
  } else {
    const catObj = categories.find((c) => c.tab === selectedTab);
    activeSpecLabelEl.textContent = catObj ? catObj.label : 'All Spells';
  }
}

function formatOriginBadge(
  entry: SpellLabEntry,
  catalog: ClassSpellCatalog,
): { text: string; cls: string } {
  if (entry.isSpecSignature) {
    const specName = catalog.specs.find((s) => entry.specIds.includes(s.id))?.name ?? 'Spec';
    return { text: `${specName} Signature`, cls: 'origin-sig' };
  }
  if (entry.category === 'spec') {
    const specNames = entry.specIds
      .map((id) => catalog.specs.find((s) => s.id === id)?.name ?? id)
      .join(' / ');
    return { text: `${specNames} Spec`, cls: 'origin-spec' };
  }
  if (entry.category === 'talent') {
    return {
      text: entry.talentRowLevel ? `Talent Lv${entry.talentRowLevel}` : 'Talent Grant',
      cls: 'origin-talent',
    };
  }
  if (entry.category === 'basic') {
    return { text: 'Basic Action', cls: 'origin-base' };
  }
  return { text: 'Base Kit', cls: 'origin-base' };
}

function createPill(text: string, variant = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `meta-pill${variant ? ` ${variant}` : ''}`;
  span.textContent = text;
  return span;
}

function renderSpellList(): void {
  const catalog = currentCatalog();
  const entries = currentVisibleEntries();

  rightTitleEl.textContent = `${catalog.className} / ${activeSpecLabelEl.textContent}`;
  rightCountEl.textContent = `${entries.length} ${entries.length === 1 ? 'spell' : 'spells'}`;

  spellListEl.innerHTML = '';

  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = `spell-card${entry.id === selectedEntryId ? ' active' : ''}`;
    card.dataset.entryId = entry.id;

    const header = document.createElement('div');
    header.className = 'spell-card-header';

    const titleWrap = document.createElement('div');
    const nameEl = document.createElement('span');
    nameEl.className = 'spell-card-name';
    nameEl.textContent = entry.name;
    const idEl = document.createElement('span');
    idEl.className = 'spell-card-id';
    idEl.textContent = entry.id;
    titleWrap.append(nameEl, idEl);

    const origin = formatOriginBadge(entry, catalog);
    const badgeEl = document.createElement('span');
    badgeEl.className = `origin-badge ${origin.cls}`;
    badgeEl.textContent = origin.text;

    header.append(titleWrap, badgeEl);

    // Timing & Range summary line
    const timingRow = document.createElement('div');
    timingRow.className = 'spell-timing-row';
    const castLabel = entry.passive
      ? 'Passive'
      : entry.channeled
        ? `Channeled (${entry.channelDuration}s)`
        : entry.castTime > 0
          ? `${entry.castTime}s Cast`
          : 'Instant';
    const cdLabel = entry.cooldown > 0 ? `${entry.cooldown}s CD` : 'No CD';
    const rangeLabel = entry.range > 0 ? `${entry.range} yd Range` : 'Self / PBAoE';
    timingRow.textContent = `${castLabel}  |  ${cdLabel}  |  ${rangeLabel}  |  School: ${entry.school}`;

    // Plain-English Tooltip Description
    const descEl = document.createElement('div');
    descEl.className = 'spell-desc';
    descEl.textContent = entry.description;

    // Animation & VFX pills
    const pills = document.createElement('div');
    pills.className = 'pill-row';

    if (entry.castLoopClip) {
      pills.appendChild(createPill(`Loop: ${entry.castLoopClip}`, 'loop'));
    }
    const clipText =
      entry.resolvedClip !== entry.baseClip
        ? `Clip: ${entry.resolvedClip} (base: ${entry.baseClip})`
        : `Clip: ${entry.resolvedClip}`;
    pills.appendChild(createPill(clipText, 'clip'));
    pills.appendChild(createPill(`VFX: ${entry.vfxArchetype}`, 'vfx'));

    if (entry.requiresForm) {
      pills.appendChild(createPill(`Form: ${entry.requiresForm}`, 'req'));
    }
    if (entry.requiresStealth) {
      pills.appendChild(createPill('Stealth', 'req'));
    }
    if (entry.requiresShield) {
      pills.appendChild(createPill('Requires Shield', 'req'));
    }
    if (entry.transformedFromId) {
      pills.appendChild(createPill(`Transforms: ${entry.transformedFromId}`, 'req'));
    }

    card.append(header, timingRow, descEl, pills);
    card.addEventListener('click', () => {
      stopSequence();
      playSpellEntry(entry);
    });
    spellListEl.appendChild(card);
  }
}

function highlightSelectedSpellCard(): void {
  const cards = spellListEl.querySelectorAll<HTMLElement>('.spell-card');
  for (const card of cards) {
    const active = card.dataset.entryId === selectedEntryId;
    card.classList.toggle('active', active);
  }
}

function updateActiveSpellHudForEntry(entry: SpellLabEntry): void {
  hudSpellNameEl.textContent = entry.name;
  hudSpellIdEl.textContent = `(${entry.id})`;
  hudSpellDescEl.textContent = entry.description;

  hudMetaRowEl.innerHTML = '';
  if (entry.castLoopClip) {
    hudMetaRowEl.appendChild(createPill(`Cast Loop: ${entry.castLoopClip}`, 'loop'));
  }
  hudMetaRowEl.appendChild(createPill(`Release Clip: ${entry.resolvedClip}`, 'clip'));
  hudMetaRowEl.appendChild(
    createPill(`VFX Archetype: ${entry.vfxArchetype} [${entry.vfxSchool}]`, 'vfx'),
  );
  for (const motif of entry.vfxMotifs) {
    hudMetaRowEl.appendChild(createPill(`motif:${motif}`));
  }
}

function updateActiveSpellHud(): void {
  if (!activePlayback) return;
  updateActiveSpellHudForEntry(activePlayback.entry);
}

// ---------------------------------------------------------------------------
// Sequence Auto-Player & Toolbar Controls
// ---------------------------------------------------------------------------

const sequenceBtn = document.getElementById('sequence-btn') as HTMLButtonElement;

function stopSequence(): void {
  if (sequenceTimer !== null) {
    window.clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
  sequenceBtn.classList.remove('playing');
  sequenceBtn.textContent = 'Play Spec Sequence';
}

function stepSequence(): void {
  const entries = currentVisibleEntries().filter((e) => !e.passive);
  if (entries.length === 0) {
    stopSequence();
    return;
  }
  if (sequenceIndex >= entries.length) {
    sequenceIndex = 0;
  }
  const entry = entries[sequenceIndex++];
  playSpellEntry(entry);
  const card = spellListEl.querySelector<HTMLElement>(`[data-entry-id="${entry.id}"]`);
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const waitMs = Math.max(1200, ((entry.castTime > 0 ? 0.55 : 0) + 1.25) * 1000);
  sequenceTimer = window.setTimeout(stepSequence, waitMs);
}

sequenceBtn.addEventListener('click', () => {
  if (sequenceTimer !== null) {
    stopSequence();
    return;
  }
  sequenceIndex = 0;
  sequenceBtn.classList.add('playing');
  sequenceBtn.textContent = 'Stop Sequence';
  stepSequence();
});

document.getElementById('replay-btn')?.addEventListener('click', () => {
  const entries = currentVisibleEntries();
  const current = entries.find((e) => e.id === selectedEntryId) ?? entries[0];
  if (current) playSpellEntry(current);
});

const fitMaleBtn = document.getElementById('fit-male-btn') as HTMLButtonElement;
const fitFemaleBtn = document.getElementById('fit-female-btn') as HTMLButtonElement;

fitMaleBtn.addEventListener('click', () => {
  if (selectedFit === 'male') return;
  selectedFit = 'male';
  fitMaleBtn.classList.add('active');
  fitFemaleBtn.classList.remove('active');
  void rebuildCasterVisual();
});

fitFemaleBtn.addEventListener('click', () => {
  if (selectedFit === 'female') return;
  selectedFit = 'female';
  fitFemaleBtn.classList.add('active');
  fitMaleBtn.classList.remove('active');
  void rebuildCasterVisual();
});

loadoutSelectEl.addEventListener('change', () => {
  selectedLoadout = loadoutSelectEl.value as SpellLabLoadoutPresetId;
  renderLeftPanels();
  renderSpellList();
  void rebuildCasterVisual().then(() => {
    const entries = currentVisibleEntries();
    const current = entries.find((e) => e.id === selectedEntryId) ?? entries[0];
    if (current) playSpellEntry(current);
  });
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  btn.addEventListener('click', () => {
    playbackSpeed = Number(btn.dataset.speed || '1');
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      b.classList.toggle('active', b === btn);
    }
  });
}

const fastCastsBtn = document.getElementById('fast-casts-btn') as HTMLButtonElement;
fastCastsBtn.addEventListener('click', () => {
  fastCasts = !fastCasts;
  fastCastsBtn.classList.toggle('active', fastCasts);
  fastCastsBtn.textContent = fastCasts ? 'Fast Casts: ON' : 'Fast Casts: OFF';
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-cam]')) {
  btn.addEventListener('click', () => {
    setCameraPreset(btn.dataset.cam || 'studio');
  });
}

spellSearchEl.addEventListener('input', () => {
  searchQuery = spellSearchEl.value;
  renderSpellList();
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement === spellSearchEl) return;
  if (e.code === 'Space') {
    e.preventDefault();
    const entries = currentVisibleEntries();
    const current = entries.find((item) => item.id === selectedEntryId) ?? entries[0];
    if (current) playSpellEntry(current);
  } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
    e.preventDefault();
    stopSequence();
    const entries = currentVisibleEntries();
    if (entries.length === 0) return;
    const idx = entries.findIndex((item) => item.id === selectedEntryId);
    const nextIdx =
      e.code === 'ArrowDown'
        ? Math.min(entries.length - 1, idx + 1)
        : Math.max(0, idx <= 0 ? 0 : idx - 1);
    const next = entries[nextIdx];
    if (next) {
      playSpellEntry(next);
      const card = spellListEl.querySelector<HTMLElement>(`[data-entry-id="${next.id}"]`);
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

// ---------------------------------------------------------------------------
// Main Animation & VFX Frame Loop
// ---------------------------------------------------------------------------

let lastFrameTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const rawDt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  const dt = rawDt * playbackSpeed;

  if (aoeFlashTimer > 0) {
    aoeFlashTimer = Math.max(0, aoeFlashTimer - dt);
    aoeFlashMat.opacity = (aoeFlashTimer / 0.65) * 0.65;
    if (aoeFlashTimer <= 0) {
      aoeFlashMesh.visible = false;
    }
  }

  const catalog = currentCatalog();

  if (activePlayback) {
    activePlayback.phaseElapsed += dt;
    const { entry, phase, phaseElapsed, castDuration, strikeDuration } = activePlayback;

    if (phase === 'cast') {
      if (entry.kind === 'ability') {
        abilityVfx.syncEntity(
          {
            id: CASTER_ID,
            kind: 'player',
            templateId: selectedClass,
            mainhandItemId: catalog.mainhandItemId,
            offhandItemId: catalog.offhandItemId,
            castingAbility: entry.id,
            castRemaining: Math.max(0.01, castDuration - phaseElapsed),
            castTotal: castDuration,
            auras: [],
          },
          true,
        );
        vfx.castSparkle(CASTER_ID, entry.school, dt, abilityVfx.sparkleColorFor(entry.id));
      }

      if (entry.channeled && entry.kind === 'ability') {
        activePlayback.channelTickAccum += dt;
        if (activePlayback.channelTickAccum >= 0.25) {
          activePlayback.channelTickAccum = 0;
          abilityVfx.handleSpellfx({
            sourceId: CASTER_ID,
            targetId: DUMMY_ID,
            school: entry.school,
            fx: ABILITIES[entry.id]?.castFx ?? 'beam',
            ability: entry.id,
          });
        }
      }

      const pct = castDuration > 0 ? Math.min(100, (phaseElapsed / castDuration) * 100) : 100;
      hudProgressFillEl.style.width = `${pct.toFixed(1)}%`;
      hudPhaseLabelEl.textContent = `${entry.channeled ? 'Channeling' : 'Casting'}: ${entry.castLoopClip ?? 'Woc_Cast'} (${phaseElapsed.toFixed(2)}s / ${castDuration.toFixed(2)}s)`;

      if (phaseElapsed >= castDuration) {
        activePlayback.phase = 'strike';
        activePlayback.phaseElapsed = 0;
        triggerReleaseImpact(entry);
      }
    } else if (phase === 'strike') {
      const morphAuras = isMorphFormEntry(entry) ? [{ id: entry.id }] : [];
      abilityVfx.syncEntity(
        {
          id: CASTER_ID,
          kind: 'player',
          templateId: selectedClass,
          mainhandItemId: catalog.mainhandItemId,
          offhandItemId: catalog.offhandItemId,
          castingAbility: null,
          castRemaining: 0,
          castTotal: 0,
          auras: morphAuras,
        },
        true,
      );

      const pct = Math.min(100, (phaseElapsed / strikeDuration) * 100);
      hudProgressFillEl.style.width = `${pct.toFixed(1)}%`;
      hudPhaseLabelEl.textContent = `Release / Strike: ${entry.resolvedClip} (${phaseElapsed.toFixed(2)}s)`;

      if (phaseElapsed >= strikeDuration) {
        activePlayback.phase = 'hold';
        activePlayback.phaseElapsed = 0;
      }
    } else {
      const morphAuras = isMorphFormEntry(entry) ? [{ id: entry.id }] : [];
      abilityVfx.syncEntity(
        {
          id: CASTER_ID,
          kind: 'player',
          templateId: selectedClass,
          mainhandItemId: catalog.mainhandItemId,
          offhandItemId: catalog.offhandItemId,
          castingAbility: null,
          castRemaining: 0,
          castTotal: 0,
          auras: morphAuras,
        },
        true,
      );
      hudProgressFillEl.style.width = '100%';
      hudPhaseLabelEl.textContent = `Combat Idle (${entry.resolvedClip} complete)`;
    }
  }

  const casterVis = views.get(CASTER_ID);
  if (casterVis) {
    const isCasting = Boolean(activePlayback && activePlayback.phase === 'cast');
    const castClip = activePlayback?.entry.castLoopClip;
    const castAbilityId = activePlayback?.entry.id;
    const vdef = VISUALS[currentCasterVisualKey];
    const clips = vdef?.clips;
    if (isCasting && castClip && castAbilityId && clips) {
      const prevMap = clips.castByAbility;
      const hadPrev = prevMap && Object.hasOwn(prevMap, castAbilityId);
      const prevVal = prevMap?.[castAbilityId];
      clips.castByAbility ??= {};
      const map = clips.castByAbility;
      map[castAbilityId] = castClip;
      casterVis.update(dt, buildCasterAnimState(), true);
      if (hadPrev && prevVal !== undefined) {
        map[castAbilityId] = prevVal;
      } else {
        delete map[castAbilityId];
      }
    } else {
      casterVis.update(dt, buildCasterAnimState(), true);
    }
  }
  const dummyVis = views.get(DUMMY_ID);
  if (dummyVis) {
    dummyVis.update(dt, buildDummyAnimState(), true);
  }

  abilityVfx.update(dt, false);
  vfx.update(dt, false);
  vfx.prepareDraw(camera);

  renderer?.render(scene, camera);
}

// Initialize UI and 3D stage
populateLoadoutSelect();
renderLeftPanels();
renderSpellList();
void rebuildCasterVisual().then(() => {
  const first =
    currentVisibleEntries().find((e) => e.isSpecSignature) ?? currentVisibleEntries()[0];
  if (first) playSpellEntry(first);
});
requestAnimationFrame(animate);
