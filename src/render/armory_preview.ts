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
import { type PreviewAppearance, previewAppearanceVisual } from './characters/preview_appearance';
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
  setSkin(skinId: string | null): void;
  setMode(mode: ArmoryPreviewMode): void;
  setScene(scene: ArmorySceneKey): void;
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
  const pv = previewAppearanceVisual(appearance);
  const visual = new CharacterVisual(
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

  // Weapon-mode rig: the skin alone on a turntable, with its showcase extras.
  const weaponGroup = new THREE.Group();
  scene.add(weaponGroup);
  let weaponModel: THREE.Object3D | null = null;
  let weaponVfx: WeaponVfxHandle | null = null;
  let weaponExtras: THREE.Object3D | null = null;
  // Loot-inspect float state (mirrors the offline inspector's grounded showcase).
  let weaponFloat: { bob: number; spin: number; lift: number } | null = null;
  let weaponFloatBase = 0;
  let weaponFloatTime = 0;
  let weaponTargetH = 2.0;

  let mode: ArmoryPreviewMode = 'character';
  let sceneKey: ArmorySceneKey = 'day';
  let skinId: string | null = null;
  let disposed = false;

  const pixelHeight = () => Math.max(1, Math.round(canvas.clientHeight * renderer.getPixelRatio()));

  function frameCamera(): void {
    if (mode === 'character') {
      camera.position.set(0, 1.5, 5.4);
      camera.lookAt(0, 1.25, 0);
    } else {
      // Frame the grounded, normalized model (weaponTargetH tall, hovering by
      // the tier float lift), matching the offline inspector's showcase: the
      // whole blade plus the ground pool stay in view at the 35 degree fov.
      const top = weaponTargetH + (weaponFloat?.lift ?? 0) + 0.15;
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

  function clearWeaponRig(): void {
    if (weaponVfx) {
      weaponVfx.dispose();
      weaponVfx = null;
    }
    if (weaponExtras) {
      weaponExtras.removeFromParent();
      weaponExtras = null;
    }
    if (weaponModel) {
      disposeOwnedWeaponSkinMaterials(weaponModel);
      weaponModel.removeFromParent();
      weaponModel = null;
    }
    weaponFloat = null;
  }

  function buildWeaponRig(): void {
    clearWeaponRig();
    if (!skinId) return;
    weaponModel = weaponSkinDisplayModel(skinId);
    if (!weaponModel) return;
    const def = WEAPON_SKINS[skinId];
    const spec = def ? WEAPON_VFX[def.model] : null;
    // Normalize exactly like the offline inspector's grounded showcase (scale
    // to the family display height, center x/z, ground min.y at 0) so the
    // weapon-to-rig-to-pool arrangement is 1:1 with what the artist tuned.
    weaponTargetH = def?.weaponType === 'staff' ? 2.3 : def?.weaponType === 'dagger' ? 1.3 : 2.0;
    const box = new THREE.Box3().setFromObject(weaponModel);
    const h = box.max.y - box.min.y || 1;
    weaponModel.scale.setScalar(weaponTargetH / h);
    weaponModel.updateMatrixWorld(true);
    const grounded = new THREE.Box3().setFromObject(weaponModel);
    const center = grounded.getCenter(new THREE.Vector3());
    weaponModel.position.x -= center.x;
    weaponModel.position.z -= center.z;
    weaponModel.position.y -= grounded.min.y;
    weaponFloatBase = weaponModel.position.y;
    weaponFloatTime = 0;
    weaponFloat = spec ? (TIERS[spec.tier]?.float ?? null) : null;
    weaponGroup.add(weaponModel);
    if (def && spec) {
      weaponVfx = createWeaponVfx(weaponModel, spec, { grounded: true });
      weaponVfx.setBackdropVisible(false);
      weaponVfx.setTuning(weaponVfxTuningFor(def.model, spec.tier));
      weaponVfx.setPixelScale(pixelHeight());
      weaponExtras = weaponVfx.sceneExtras;
      weaponExtras.position.set(0, 0.02, 0);
      weaponGroup.add(weaponExtras);
    }
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
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (mode === 'character') {
      characterGroup.rotation.y += dt * 0.45;
      visual.update(dt, IDLE_STATE, true);
      visual.updateWeaponVfx(dt);
    } else {
      weaponGroup.rotation.y += dt * 0.55;
      // The offline inspector's loot float: a slow hover above the pool. Same
      // formula (lift + half-sine bob); the turntable stands in for its spin.
      if (weaponModel && weaponFloat) {
        weaponFloatTime += dt;
        weaponModel.position.y =
          weaponFloatBase +
          weaponFloat.lift +
          weaponFloat.bob * (1 + Math.sin(weaponFloatTime * 1.1)) * 0.5;
      }
      weaponVfx?.update(dt);
    }
    composer.render();
  };

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    visual.setWeaponVfxPixelScale(pixelHeight());
    weaponVfx?.setPixelScale(pixelHeight());
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  applyScene();
  applyMode();
  animate();

  return {
    setSkin(next: string | null): void {
      if (disposed || next === skinId) return;
      skinId = next;
      visual.setWeaponSkin(next);
      visual.setWeaponVfxPixelScale(pixelHeight());
      buildWeaponRig();
      applyScene();
      // The display height is per weapon family: re-frame in weapon mode so a
      // dagger-to-sword swap does not keep the old framing.
      frameCamera();
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
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      observer.disconnect();
      clearWeaponRig();
      visual.dispose();
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
