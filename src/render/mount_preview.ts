// Mount-skin inspect preview: a small self-contained WebGL rig for the WOC
// Store's Machine Stable and the Cosmetics window. Two modes on one canvas:
// "rider" (the player's own class body seated on the mount skin, the same seat
// math the world renderer uses: seat lift, seat bone, straddle ride pose, idle
// bob) and "mount" (the skin alone on a slow turntable). Scene light presets
// (day / dusk / night) come from the shared weapon_vfx SCENE_PRESETS so the
// panel matches the Armory inspect's look, and the mount rig is built by the
// same lazy-GLB path the prewarm lane uses (mount_prewarm), so the rickshaw's
// puller and every other composed mount come out exactly as the world draws
// them. Owns its renderer and rAF loop; dispose() releases the GL context.
//
// Secondary-context contract (src/render/CLAUDE.md): every rig the stage
// draws is LINKED (compileAsync) and UPLOADED (uploadTexturesInSlices) before
// its first draw, with the stage parked below the floor (by POSITION, never
// `visible`, so the light census the compile sees is the census the first
// frame draws) and only the ground painted until the prepare settles; a stale
// prepare (a newer one started, the panel closed) is dropped by its own
// generation guard. The context is disposed with the panel
// rather than parked like the Armory's: parking a second session-long context
// moves the client toward the browser's live-context cap for a panel most
// sessions open once, and the mount GLB stays resident in the character asset
// cache, so a reopen pays a rig build and a link, never a fetch.
//
// This is the second copy of the Armory rig's shell (src/render/armory_preview.ts),
// not a shared abstraction: the two differ in what they stage (a weapon with
// its VFX composer versus a rider on a mount with no bloom pass) and the Armory
// rig is pinned by tests/armory_preview_lifecycle.test.ts. A third preview
// surface earns the extraction.
import * as THREE from 'three';
import { CharacterVisual } from './characters';
import type { AnimState } from './characters/anim_state';
import {
  appearanceSignature,
  type PreviewAppearance,
  previewAppearanceVisual,
} from './characters/preview_appearance';
import { trackWebGLContext } from './context_release';
import { seatRiderOnBone } from './mount_lifecycle';
import { MOUNT_PREVIEW_FOV, mountPreviewFraming } from './mount_preview_framing_core';
import { buildMountPrewarmVisual, type MountPrewarmKey, mountPrewarmSpec } from './mount_prewarm';
import { type MountVisualSpec, mountBobY } from './mount_visuals';
import { previewPixelRatio } from './preview_pixel_ratio';
import { shaderDebugRequested } from './shader_debug_flag';
import {
  collectPrewarmTextures,
  uploadTexturesInSlices,
  yieldToMainThread,
} from './texture_prewarm';
import { SCENE_PRESETS } from './weapon_vfx';

export type MountPreviewSceneKey = 'day' | 'dusk' | 'night';
export type MountPreviewMode = 'rider' | 'mount';

export interface MountPreviewHandle {
  setActive(active: boolean): void;
  setAppearance(appearance: PreviewAppearance): void;
  /** Stage a mount skin (or a catalog mount key); null clears the stage. */
  setMount(key: MountPrewarmKey | null): void;
  setMode(mode: MountPreviewMode): void;
  setScene(scene: MountPreviewSceneKey): void;
  dispose(): void;
}

/** The rider's idle: seated, so the body plays the mounted loop the world uses. */
const RIDER_STATE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: true,
};

/** The mount's own idle (rider-only facts never reach the mount's clips). */
const MOUNT_STATE: AnimState = { ...RIDER_STATE, sitting: false };

// Light rig positions mirror the Armory inspect: key, fill, rim, then ambient.
const LIGHT_POSITIONS: [number, number, number][] = [
  [2.5, 4, 3],
  [-3, 2, -1.5],
  [-1.5, 3, -3.5],
];

/** Where the rider parks while the "mount only" mode shows the skin alone,
 *  and where the whole stage parks while a prepare is in flight. Parked by
 *  POSITION, never by `visible`: a rider wearing a lit Armory skin carries a
 *  point light, three keys `numPointLights` off VISIBLE lights into every
 *  program's cache key, and `compile` gathers those lights with
 *  `traverseVisible`, so a HIDDEN stage would link at a census of zero and
 *  the first shown frame would relink every program (the very stall the
 *  prepare exists to avoid), and a hide/show in mount-only mode would relink
 *  the whole scene inside a live frame (src/render/CLAUDE.md, program-key
 *  changes). */
const PARK_Y = -1000;

/** Build the rig, or null when a rig throws (a lazy body or skin asset that
 *  never landed): the context is released before the throw escapes, so a
 *  failed open never leaks a live GL context (context_release.ts). */
export function createMountPreview(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  appearance: PreviewAppearance,
): MountPreviewHandle | null {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
  renderer.debug.checkShaderErrors = shaderDebugRequested();
  const untrack = trackWebGLContext(renderer);
  try {
    return buildMountPreview(renderer, untrack, container, canvas, appearance);
  } catch (err) {
    renderer.dispose();
    renderer.forceContextLoss();
    untrack();
    console.error('mount preview unavailable:', err);
    return null;
  }
}

function buildMountPreview(
  renderer: THREE.WebGLRenderer,
  untrack: () => void,
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  appearance: PreviewAppearance,
): MountPreviewHandle {
  renderer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    MOUNT_PREVIEW_FOV,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    100,
  );

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

  // One turntable group carries the mount root and the rider root, exactly as
  // the world's entity group carries both, so the seat-bone rebase math holds.
  const stage = new THREE.Group();
  scene.add(stage);

  const pixelHeight = () => Math.max(1, Math.round(canvas.clientHeight * renderer.getPixelRatio()));

  let currentAppearance = appearance;
  let appearanceSig = appearanceSignature(appearance);
  let rider: CharacterVisual = createRider();
  stage.add(rider.root);

  let mountKey: MountPrewarmKey | null = null;
  let mountSpec: MountVisualSpec | null = null;
  let mount: CharacterVisual | null = null;
  const seatCache: { mountSeatBone: THREE.Object3D | null } = { mountSeatBone: null };
  // The async build and the prepare that follows it are keyed by a generation
  // so a stale arrival (the player clicked another card while the first GLB
  // was still fetching, or closed the panel) is dropped.
  let buildGeneration = 0;
  // Prepares carry their own generation: an appearance change landing during
  // an in-flight mount build must not cancel that build, yet only the newest
  // prepare may unpark the stage (each one links the whole scene, so the
  // newest always covers what the stale one was linking).
  let prepareGeneration = 0;

  let mode: MountPreviewMode = 'rider';
  let sceneKey: MountPreviewSceneKey = 'day';
  let active = false;
  let disposed = false;
  let time = 0;
  let renderWidth = Math.max(1, container.clientWidth);
  let renderHeight = Math.max(1, container.clientHeight);

  function createRider(): CharacterVisual {
    const pv = previewAppearanceVisual(currentAppearance);
    const visual = new CharacterVisual(
      pv.visualKey,
      0xffffff,
      currentAppearance.skin,
      pv.weaponItemId,
      pv.weaponOverride,
      pv.offhandItemId,
    );
    const skin = currentAppearance.weaponSkinId;
    if (skin) visual.setWeaponSkin(skin);
    // This rig's camera matches the VFX sprite math's native fov.
    visual.setWeaponVfxCameraFov(MOUNT_PREVIEW_FOV);
    visual.setWeaponVfxPixelScale(pixelHeight());
    return visual;
  }

  const bounds = new THREE.Box3();
  const size = new THREE.Vector3();

  function frameCamera(): void {
    // Measure the whole stage (mount plus rider when shown) at rest, so the
    // camera fits whatever is actually drawn rather than a guessed height.
    stage.rotation.y = 0;
    // Seat the rider first so the measurement sees him on the saddle, not on
    // the ground under the mount.
    if (mode === 'rider') seatRider(mountSpec?.groundLift ?? 0);
    stage.updateMatrixWorld(true);
    bounds.makeEmpty();
    if (mount) bounds.expandByObject(mount.root);
    if (mode === 'rider') bounds.expandByObject(rider.root);
    if (bounds.isEmpty()) {
      bounds.min.set(-0.6, 0, -0.6);
      bounds.max.set(0.6, 2.2, 0.6);
    }
    bounds.getSize(size);
    const framing = mountPreviewFraming({ width: size.x, height: size.y, depth: size.z });
    camera.position.set(0, framing.y, framing.z);
    camera.lookAt(0, framing.lookY, 0);
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
  }

  function applyMode(): void {
    rider.setRidePose(mode === 'rider' && mountSpec ? mountSpec.ride : null);
    if (mode !== 'rider') {
      rider.root.position.set(0, PARK_Y, 0);
      rider.root.quaternion.identity();
    }
    frameCamera();
  }

  /** Link every program and upload every texture the stage carries BEFORE the
   *  stage is drawn, so the first visible frame pays no link inside the rAF.
   *  The stage parks below the floor meanwhile (the ground still draws over
   *  it): parked by position, a lit weapon skin's point light stays VISIBLE,
   *  so the light census the compile links against is the one the first
   *  frame draws (see PARK_Y). */
  async function prepareStage(): Promise<void> {
    const generation = ++prepareGeneration;
    stage.position.y = PARK_Y;
    const stale = () => disposed || generation !== prepareGeneration;
    const textures = new Set<THREE.Texture>();
    collectPrewarmTextures(stage, textures);
    await uploadTexturesInSlices(renderer, textures, {
      yieldToMain: yieldToMainThread,
      isCancelled: stale,
    });
    if (stale()) return;
    await renderer.compileAsync(scene, camera);
    if (stale()) return;
    stage.position.y = 0;
  }

  function dropMount(): void {
    if (mount) {
      mount.root.removeFromParent();
      mount.dispose();
      mount = null;
    }
    seatCache.mountSeatBone = null;
    mountSpec = null;
  }

  /** Put the rider on the seat for this frame: the seat bone when the mount
   *  carries one, else the authored lift and forward shift over the bob. */
  function seatRider(lift: number): void {
    if (
      mount &&
      mountSpec &&
      seatRiderOnBone(stage, rider.root, mount.root, mountSpec, seatCache)
    ) {
      return;
    }
    rider.root.position.x = 0;
    rider.root.position.y = mountSpec ? mountSpec.seat + lift : 0;
    rider.root.position.z = mountSpec ? mountSpec.seatFwd : 0;
    rider.root.quaternion.identity();
  }

  function stageMount(next: MountPrewarmKey | null): void {
    if (disposed || next === mountKey) return;
    mountKey = next;
    dropMount();
    const generation = ++buildGeneration;
    if (!next) {
      applyMode();
      return;
    }
    const spec = mountPrewarmSpec(next);
    void buildMountPrewarmVisual(next).then((visual) => {
      if (disposed || generation !== buildGeneration) {
        // A stale arrival (re-targeted or closed mid-fetch) is a fully built
        // rig nobody will draw: release its mixer, skeletons and puller now.
        visual?.dispose();
        return;
      }
      if (!visual) {
        // The asset never arrived in time: unlatch the key so the next click
        // on the same card retries, and hand the rider back its own legs.
        mountKey = null;
        applyMode();
        return;
      }
      // The prewarm builder parks its rig off-screen under the prewarm
      // diagnostics category; this stage draws it for real, at the rest
      // height the animate loop will hold it at.
      visual.root.position.set(0, spec.groundLift, 0);
      delete visual.root.userData.renderCategory;
      mount = visual;
      mountSpec = spec;
      stage.add(visual.root);
      // Advance one zero-length frame so a rigged mount rests in its idle pose
      // before the camera measures it.
      visual.update(0, MOUNT_STATE, true);
      applyMode();
      void prepareStage();
    });
  }

  function applyAppearance(next: PreviewAppearance): void {
    const nextSig = appearanceSignature(next);
    if (nextSig === appearanceSig) return;
    appearanceSig = nextSig;
    currentAppearance = next;
    rider.root.removeFromParent();
    rider.dispose();
    rider = createRider();
    stage.add(rider.root);
    applyMode();
    void prepareStage();
  }

  // THREE.Timer, not the r183-deprecated Clock (see armory_preview.ts).
  const timer = new THREE.Timer();
  let raf: number | null = null;
  const animate = () => {
    raf = null;
    if (disposed || !active) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    time += dt;
    stage.rotation.y += dt * 0.45;
    let lift = 0;
    if (mount && mountSpec) {
      lift = mountSpec.groundLift + mountBobY(mountSpec, time, false);
      mount.root.position.y = lift;
      mount.update(dt, MOUNT_STATE, true);
    }
    if (mode === 'rider') {
      rider.update(dt, RIDER_STATE, true);
      rider.updateWeaponVfx(dt);
      seatRider(lift);
    }
    renderer.render(scene, camera);
    if (active && !disposed) raf = requestAnimationFrame(animate);
  };

  const resize = () => {
    if (disposed || !active) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    // A parked/hidden stage can briefly report zero during DOM moves; keep the
    // last useful buffer rather than shrinking to 1x1.
    if (w <= 0 || h <= 0) return;
    if (w === renderWidth && h === renderHeight) return;
    renderWidth = w;
    renderHeight = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    rider.setWeaponVfxPixelScale(pixelHeight());
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  applyScene();
  applyMode();
  void prepareStage();

  return {
    setActive(next: boolean): void {
      if (disposed || next === active) return;
      active = next;
      if (!active) {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        return;
      }
      resize();
      timer.reset();
      if (raf === null) raf = requestAnimationFrame(animate);
    },
    setAppearance(next: PreviewAppearance): void {
      if (disposed) return;
      applyAppearance(next);
    },
    setMount(next: MountPrewarmKey | null): void {
      stageMount(next);
    },
    setMode(next: MountPreviewMode): void {
      if (disposed || next === mode) return;
      mode = next;
      applyMode();
    },
    setScene(next: MountPreviewSceneKey): void {
      if (disposed || next === sceneKey) return;
      sceneKey = next;
      applyScene();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      buildGeneration++;
      if (raf !== null) cancelAnimationFrame(raf);
      observer.disconnect();
      dropMount();
      rider.dispose();
      renderer.dispose();
      // Reclaim the GL context NOW (mirrors the Armory rig): browsers cap live
      // contexts, and evicting the oldest could take the world canvas with it.
      renderer.forceContextLoss();
      untrack();
    },
  };
}
