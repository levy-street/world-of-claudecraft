// Armory inspect preview: a small self-contained WebGL rig for the weapon-skin
// store's inspect panel. Two modes on one canvas: "character" (the player's own
// class body wearing the skin, idle animation, slow orbit) and "weapon" (the
// skin model alone on a showcase turntable with its ground pool). Scene light
// presets (day / dusk / night) come from the shared weapon_vfx SCENE_PRESETS so
// the panel matches the offline inspector's look, and rarity VFX render through
// the same createWeaponVfx rig the world renderer uses. Owns its renderer,
// composer (bloom for the emissive glow), and rAF loop; dispose() releases all.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import { CharacterVisual } from './characters';
import { weaponSkinDisplayModel } from './characters/assets';
import {
  appearanceSignature,
  type PreviewAppearance,
  previewAppearanceVisual,
} from './characters/preview_appearance';
import { disposeOwnedWeaponSkinMaterials } from './characters/weapon_skin_materials';
import { trackWebGLContext } from './context_release';
import {
  createWeaponVfx,
  SCENE_PRESETS,
  TIERS,
  WEAPON_VFX,
  type WeaponVfxHandle,
} from './weapon_vfx';
import { weaponVfxTuningFor } from './weapon_vfx_tuning';

export type ArmorySceneKey = 'day' | 'dusk' | 'night';
export type ArmoryPreviewMode = 'character' | 'weapon';

export interface ArmoryPreviewHandle {
  setActive(active: boolean): void;
  setAppearance(appearance: PreviewAppearance): void;
  setSkin(skinId: string | null): void;
  setMode(mode: ArmoryPreviewMode): void;
  setScene(scene: ArmorySceneKey): void;
  prewarm(skinIds: readonly string[]): Promise<void>;
  dispose(): void;
}

const IDLE_STATE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  sitting: false,
};

const DEFAULT_BLOOM = { strength: 0.38, radius: 0.5, threshold: 0.85 };
// Light rig positions mirror the offline inspector: key, fill, rim, then ambient.
const LIGHT_POSITIONS: [number, number, number][] = [
  [2.5, 4, 3],
  [-3, 2, -1.5],
  [-1.5, 3, -3.5],
];

type CachedWeaponRig = {
  root: THREE.Group;
  model: THREE.Object3D;
  vfx: WeaponVfxHandle | null;
  extras: THREE.Object3D | null;
  float: { bob: number; spin: number; lift: number } | null;
  floatBase: number;
  floatTime: number;
  targetHeight: number;
};

export function createArmoryPreview(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  appearance: PreviewAppearance,
): ArmoryPreviewHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const untrack = trackWebGLContext(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    35,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    100,
  );

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    DEFAULT_BLOOM.strength,
    DEFAULT_BLOOM.radius,
    DEFAULT_BLOOM.threshold,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Lights (relit per scene preset)
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  const fill = new THREE.DirectionalLight(0xffffff, 1.0);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  [key, fill, rim].forEach((light, i) => {
    light.position.set(...LIGHT_POSITIONS[i]);
  });
  scene.add(key, fill, rim, ambient);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(4.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x5a7444, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Character-mode rig: the player's own body wearing the skin.
  const characterGroup = new THREE.Group();
  scene.add(characterGroup);
  let currentAppearance = appearance;
  const pv = previewAppearanceVisual(currentAppearance);
  let appearanceSig = appearanceSignature(appearance);
  let visual = new CharacterVisual(
    pv.visualKey,
    0xffffff,
    appearance.skin,
    pv.weaponItemId,
    pv.weaponOverride,
    pv.offhandItemId,
  );
  characterGroup.add(visual.root);
  // This rig's camera matches the VFX sprite math's native 35 degree fov.
  visual.setWeaponVfxCameraFov(35);
  // The character-mode skin swap is substantially more expensive than the
  // standalone weapon clone: it rebuilds hand attachments, material snapshots
  // and rarity VFX. Keep one bounded rig per catalogue skin after loading-screen
  // prewarm, just as weaponRigs below does for the showcase mode. Switching a
  // card then only reparents an already-built root instead of spending ~30ms in
  // CharacterVisual.setWeaponSkin on the click handler.
  const characterRigs = new Map<string, CharacterVisual>([['', visual]]);

  function createCharacterRig(nextSkinId: string | null): CharacterVisual {
    const nextAppearance = previewAppearanceVisual(currentAppearance);
    const rig = new CharacterVisual(
      nextAppearance.visualKey,
      0xffffff,
      currentAppearance.skin,
      nextAppearance.weaponItemId,
      nextAppearance.weaponOverride,
    );
    rig.setWeaponVfxCameraFov(35);
    if (nextSkinId) rig.setWeaponSkin(nextSkinId);
    return rig;
  }

  function selectCharacterRig(nextSkinId: string | null): void {
    const key = nextSkinId ?? '';
    let next = characterRigs.get(key);
    if (!next) {
      next = createCharacterRig(nextSkinId);
      characterRigs.set(key, next);
    }
    if (next !== visual) {
      visual.root.removeFromParent();
      visual = next;
      characterGroup.add(visual.root);
    }
    visual.setWeaponVfxPixelScale(pixelHeight());
  }

  // Weapon-mode rig: the skin alone on a turntable, with its showcase extras.
  const weaponGroup = new THREE.Group();
  scene.add(weaponGroup);
  // Keep every warmed weapon rig alive for this WebGL context. Disposing a
  // material also releases its linked WebGLProgram in Three, which made a
  // seemingly successful loading-screen warmup compile again on the first
  // real click. Hidden cached rigs retain those programs, textures and geometry
  // while only the selected one participates in rendering.
  const weaponRigs = new Map<string, CachedWeaponRig>();
  let activeWeaponRig: CachedWeaponRig | null = null;

  let mode: ArmoryPreviewMode = 'character';
  let sceneKey: ArmorySceneKey = 'day';
  let skinId: string | null = null;
  let active = false;
  let prewarming = false;
  let disposed = false;
  let renderWidth = Math.max(1, container.clientWidth);
  let renderHeight = Math.max(1, container.clientHeight);

  const pixelHeight = () => Math.max(1, Math.round(canvas.clientHeight * renderer.getPixelRatio()));

  function frameCamera(): void {
    if (mode === 'character') {
      camera.position.set(0, 1.5, 5.4);
      camera.lookAt(0, 1.25, 0);
    } else {
      // Frame the grounded, normalized model (weaponTargetH tall, hovering by
      // the tier float lift), matching the offline inspector's showcase: the
      // whole blade plus the ground pool stay in view at the 35 degree fov.
      const top = (activeWeaponRig?.targetHeight ?? 2) + (activeWeaponRig?.float?.lift ?? 0) + 0.15;
      camera.position.set(0, top * 0.56, top * 1.8);
      camera.lookAt(0, top * 0.5, 0);
    }
  }

  function applyScene(): void {
    const preset = SCENE_PRESETS[sceneKey];
    scene.background = new THREE.Color(preset.bg ?? 0x10141c);
    (ground.material as THREE.MeshStandardMaterial).color.set(preset.ground ?? 0x3c4436);
    const lights = preset.lights ?? [];
    const rig = [key, fill, rim, ambient];
    for (let i = 0; i < rig.length; i++) {
      const [color, intensity] = lights[i] ?? [0xffffff, i === 3 ? 0.8 : 1];
      rig[i].color.set(color);
      rig[i].intensity = intensity;
    }
    const def = skinId ? WEAPON_SKINS[skinId] : null;
    const spec = def ? WEAPON_VFX[def.model] : null;
    const tierBloom = spec ? TIERS[spec.tier]?.bloom : null;
    // The per-weapon saved tuning carries a bloom multiplier (the inspector's
    // bloom slider rides the composer pass, not the VFX handle).
    const bloomTune = def && spec ? (weaponVfxTuningFor(def.model, spec.tier).bloom ?? 1) : 1;
    bloom.strength = (tierBloom?.strength ?? DEFAULT_BLOOM.strength) * bloomTune;
    bloom.radius = tierBloom?.radius ?? DEFAULT_BLOOM.radius;
    bloom.threshold = preset.bloomThreshold ?? tierBloom?.threshold ?? DEFAULT_BLOOM.threshold;
  }

  function ensureWeaponRig(id: string): CachedWeaponRig | null {
    const cached = weaponRigs.get(id);
    if (cached) return cached;
    const model = weaponSkinDisplayModel(id);
    if (!model) return null;
    const def = WEAPON_SKINS[id];
    const spec = def ? WEAPON_VFX[def.model] : null;
    // Normalize exactly like the offline inspector's grounded showcase (scale
    // to the family display height, center x/z, ground min.y at 0) so the
    // weapon-to-rig-to-pool arrangement is 1:1 with what the artist tuned.
    const targetHeight =
      def?.weaponType === 'staff' ? 2.3 : def?.weaponType === 'dagger' ? 1.3 : 2.0;
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y || 1;
    model.scale.setScalar(targetHeight / h);
    model.updateMatrixWorld(true);
    const grounded = new THREE.Box3().setFromObject(model);
    const center = grounded.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= grounded.min.y;
    const root = new THREE.Group();
    root.visible = false;
    root.add(model);
    weaponGroup.add(root);
    let vfx: WeaponVfxHandle | null = null;
    let extras: THREE.Object3D | null = null;
    if (def && spec) {
      vfx = createWeaponVfx(model, spec, { grounded: true });
      vfx.setBackdropVisible(false);
      vfx.setTuning(weaponVfxTuningFor(def.model, spec.tier));
      vfx.setPixelScale(pixelHeight());
      extras = vfx.sceneExtras;
      extras.position.set(0, 0.02, 0);
      root.add(extras);
    }
    const rig: CachedWeaponRig = {
      root,
      model,
      vfx,
      extras,
      float: spec ? (TIERS[spec.tier]?.float ?? null) : null,
      floatBase: model.position.y,
      floatTime: 0,
      targetHeight,
    };
    weaponRigs.set(id, rig);
    return rig;
  }

  function selectSkin(next: string | null): void {
    // Re-selecting the CURRENT skin is a no-op only while its rig exists: a
    // streamed skin clicked before its GLB arrived has skinId set but no rig,
    // and the reselect after arrival is how the weapon finally appears.
    if (disposed || (next === skinId && (next === null || activeWeaponRig !== null))) return;
    if (activeWeaponRig) activeWeaponRig.root.visible = false;
    skinId = next;
    selectCharacterRig(next);
    activeWeaponRig = next ? ensureWeaponRig(next) : null;
    if (activeWeaponRig) {
      activeWeaponRig.root.visible = true;
      activeWeaponRig.vfx?.setPixelScale(pixelHeight());
    }
    applyScene();
    frameCamera();
  }

  function disposeWeaponRigs(): void {
    for (const rig of weaponRigs.values()) {
      rig.vfx?.dispose();
      rig.extras?.removeFromParent();
      disposeOwnedWeaponSkinMaterials(rig.model);
      rig.root.removeFromParent();
    }
    weaponRigs.clear();
    activeWeaponRig = null;
  }

  function applyMode(): void {
    characterGroup.visible = mode === 'character';
    weaponGroup.visible = mode === 'weapon';
    ground.visible = true;
    frameCamera();
  }

  const clock = new THREE.Clock();
  let raf: number | null = null;
  const animate = () => {
    raf = null;
    if (disposed || !active || prewarming) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (mode === 'character') {
      characterGroup.rotation.y += dt * 0.45;
      visual.update(dt, IDLE_STATE, true);
      visual.updateWeaponVfx(dt);
    } else {
      weaponGroup.rotation.y += dt * 0.55;
      // The offline inspector's loot float: a slow hover above the pool. Same
      // formula (lift + half-sine bob); the turntable stands in for its spin.
      const rig = activeWeaponRig;
      if (rig?.float) {
        rig.floatTime += dt;
        rig.model.position.y =
          rig.floatBase +
          rig.float.lift +
          rig.float.bob * (1 + Math.sin(rig.floatTime * 1.1)) * 0.5;
      }
      rig?.vfx?.update(dt);
    }
    composer.render();
    if (active && !disposed && !prewarming) raf = requestAnimationFrame(animate);
  };

  const resize = () => {
    if (disposed || prewarming || !active) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    // A parked/hidden stage can briefly report zero during DOM moves. Keep the
    // last useful buffer instead of shrinking it to 1x1 and reallocating again
    // on the next animation frame.
    if (w <= 0 || h <= 0) return;
    if (w === renderWidth && h === renderHeight) return;
    renderWidth = w;
    renderHeight = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    visual.setWeaponVfxPixelScale(pixelHeight());
    activeWeaponRig?.vfx?.setPixelScale(pixelHeight());
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  applyScene();
  applyMode();

  return {
    setActive(next: boolean): void {
      if (disposed || next === active) return;
      active = next;
      if (!active) {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        clock.stop();
        return;
      }
      resize();
      clock.start();
      if (!prewarming && raf === null) raf = requestAnimationFrame(animate);
    },
    setAppearance(next: PreviewAppearance): void {
      if (disposed) return;
      const nextSig = appearanceSignature(next);
      if (nextSig === appearanceSig) return;
      appearanceSig = nextSig;
      currentAppearance = next;
      for (const rig of characterRigs.values()) rig.dispose();
      characterRigs.clear();
      visual = createCharacterRig(skinId);
      characterRigs.set(skinId ?? '', visual);
      characterGroup.add(visual.root);
      visual.setWeaponVfxPixelScale(pixelHeight());
    },
    setSkin(next: string | null): void {
      selectSkin(next);
    },
    setMode(next: ArmoryPreviewMode): void {
      if (disposed || next === mode) return;
      mode = next;
      applyMode();
    },
    setScene(next: ArmorySceneKey): void {
      if (disposed || next === sceneKey) return;
      sceneKey = next;
      applyScene();
    },
    async prewarm(skinIds: readonly string[]): Promise<void> {
      if (disposed || prewarming) return;
      const unique = [...new Set(skinIds)].filter((id) => WEAPON_SKINS[id]);
      if (unique.length === 0) return;
      const previousSize = new THREE.Vector2();
      renderer.getSize(previousSize);
      const previousPixelRatio = renderer.getPixelRatio();
      const previousAspect = camera.aspect;
      const previousSkin = skinId;
      const previousMode = mode;
      const wasActive = active;
      // Stop the visible loop while compile/upload owns the context. All work
      // happens while the game's loading screen is opaque.
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      active = false;
      clock.stop();
      prewarming = true;
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(480, 380, false);
        renderWidth = 480;
        renderHeight = 380;
        composer.setPixelRatio(1);
        composer.setSize(480, 380);
        camera.aspect = 480 / 380;
        camera.updateProjectionMatrix();
        for (const id of unique) {
          if (disposed) break;
          selectSkin(id);
          visual.setWeaponVfxPixelScale(pixelHeight());
          activeWeaponRig?.vfx?.setPixelScale(pixelHeight());

          // Compile and draw the exact character-mode light/material graph.
          mode = 'character';
          applyMode();
          await renderer.compileAsync(scene, camera);
          composer.render();

          // Then the exact weapon-only graph (ground pool + showcase VFX).
          mode = 'weapon';
          applyMode();
          await renderer.compileAsync(scene, camera);
          composer.render();

          // Keep the loading overlay responsive and avoid turning 29 bounded
          // warmups into one giant main-thread task on browsers whose shader
          // compiler cannot link fully in parallel.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      } finally {
        selectSkin(previousSkin);
        mode = previousMode;
        applyMode();
        renderer.setPixelRatio(previousPixelRatio);
        renderer.setSize(Math.max(1, previousSize.x), Math.max(1, previousSize.y), false);
        renderWidth = Math.max(1, previousSize.x);
        renderHeight = Math.max(1, previousSize.y);
        composer.setPixelRatio(previousPixelRatio);
        composer.setSize(Math.max(1, previousSize.x), Math.max(1, previousSize.y));
        camera.aspect = previousAspect;
        camera.updateProjectionMatrix();
        // Restoring the logical size/DPR replaces the composer's render
        // targets. Force their real GPU allocation while the loading screen is
        // still opaque; leaving this first draw to setActive() made the first
        // Armory skin click block for 70-110ms even though every shader and rig
        // had already been warmed above.
        composer.render();
        prewarming = false;
        active = wasActive;
        if (active && !disposed) {
          resize();
          clock.start();
          raf = requestAnimationFrame(animate);
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      observer.disconnect();
      disposeWeaponRigs();
      for (const rig of characterRigs.values()) rig.dispose();
      characterRigs.clear();
      composer.dispose();
      renderer.dispose();
      // Reclaim the GL context NOW (mirrors CharacterPreview.dispose): browsers
      // cap live contexts, and browsing many skins would otherwise evict the
      // oldest context, potentially the world canvas.
      renderer.forceContextLoss();
      untrack();
    },
  };
}
