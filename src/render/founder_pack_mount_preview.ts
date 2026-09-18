// Founder Pack store: a small standalone WebGL turntable that previews one of
// the three Founder Pack mounts (Cinderjaw Rex, Ancient Devourer, Shiba Inu)
// before the player commits a pick. Scoped-down twin of armory_preview.ts's
// weapon showcase mode: own renderer, own scene, a slow turntable and the
// mount's own idle clip, but no composer/bloom (a mount carries no rarity
// VFX) and no character rig. Owns its renderer and rAF loop; dispose()
// releases all.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { MountKey } from '../sim/content/mounts';
import { loadGltf } from './assets/loader';
import { VISUALS } from './characters/manifest';
import { trackWebGLContext } from './context_release';
import { mountVisualSpec } from './mount_visuals';
import { shaderDebugRequested } from './shader_debug_flag';

export interface FounderPackMountPreviewHandle {
  setActive(active: boolean): void;
  setMount(key: MountKey | null): void;
  dispose(): void;
}

// Light rig positions mirror armory_preview.ts: key, fill, rim, then ambient.
const LIGHT_POSITIONS: [number, number, number][] = [
  [2.5, 4, 3],
  [-3, 2, -1.5],
  [-1.5, 3, -3.5],
];

// Every mount is normalized to roughly this world-unit span (its longest
// bounding-box axis) so the three GLBs, authored at different raw scales,
// fill the same turntable frame.
const FRAME_SPAN = 2.6;

interface MountRig {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
}

export function createFounderPackMountPreview(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
): FounderPackMountPreviewHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
  renderer.debug.checkShaderErrors = shaderDebugRequested();
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
  camera.position.set(0, 1.6, 5.6);
  camera.lookAt(0, 1.2, 0);

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

  const turntable = new THREE.Group();
  scene.add(turntable);

  // Every loaded rig stays cached and hidden rather than disposed, the same
  // reasoning as armory_preview.ts's weaponRigs: disposing a material also
  // frees its linked WebGLProgram, so re-picking a mount would recompile
  // instead of just reparenting.
  const rigs = new Map<MountKey, MountRig>();
  let activeKey: MountKey | null = null;
  let activeRig: MountRig | null = null;
  let loadToken = 0;
  let active = false;
  let disposed = false;
  const clock = new THREE.Clock();

  async function buildRig(mountKey: MountKey): Promise<MountRig | null> {
    const spec = mountVisualSpec(mountKey);
    const def = spec ? VISUALS[spec.visualKey] : undefined;
    if (!spec || !def) return null;
    const token = ++loadToken;
    const gltf = await loadGltf(def.url);
    if (disposed || token !== loadToken) return null;
    const model = cloneSkinned(gltf.scene) as THREE.Group;
    model.rotation.y = def.yaw ?? 0;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const scale = FRAME_SPAN / maxDim;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

    const root = new THREE.Group();
    root.add(model);

    let mixer: THREE.AnimationMixer | null = null;
    const idleClip = gltf.animations.find((clip) => clip.name === def.clips.idle);
    if (idleClip) {
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(idleClip).play();
    }
    return { root, mixer };
  }

  function showMount(mountKey: MountKey | null): void {
    if (activeRig) {
      activeRig.root.removeFromParent();
      activeRig = null;
    }
    activeKey = mountKey;
    if (!mountKey) return;
    const cached = rigs.get(mountKey);
    if (cached) {
      activeRig = cached;
      turntable.add(cached.root);
      return;
    }
    void buildRig(mountKey).then((rig) => {
      if (!rig || disposed) return;
      rigs.set(mountKey, rig);
      if (activeKey === mountKey) {
        activeRig = rig;
        turntable.add(rig.root);
      }
    });
  }

  function renderFrame(): void {
    if (disposed || !active) return;
    const dt = clock.getDelta();
    turntable.rotation.y += dt * 0.5;
    activeRig?.mixer?.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(renderFrame);
  }

  function disposeRig(rig: MountRig): void {
    rig.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else material?.dispose();
    });
  }

  return {
    setActive(nextActive: boolean): void {
      if (disposed || active === nextActive) return;
      active = nextActive;
      if (active) {
        clock.getDelta(); // drop the idle-time delta accrued while hidden
        requestAnimationFrame(renderFrame);
      }
    },
    setMount(key: MountKey | null): void {
      if (disposed) return;
      showMount(key);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      untrack();
      for (const rig of rigs.values()) disposeRig(rig);
      rigs.clear();
      renderer.dispose();
    },
  };
}
