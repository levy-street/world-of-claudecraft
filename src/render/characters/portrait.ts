import * as THREE from 'three';
import type { PlayerClass } from '../../sim/types';
import { assetsReady } from '../assets/preload';
import { trackWebGLContext } from '../context_release';
import {
  collectPrewarmTextures,
  uploadTexturesInSlices,
  yieldToMainThread,
} from '../texture_prewarm';
import { ensureSkinTexture } from './assets';
import { VISUALS } from './manifest';
import { type ModularLook, modularSignature } from './modular';
import { type PortraitFraming, portraitFrameParams } from './portrait_framing';
import { runPortraitPrewarm } from './portrait_prewarm_core';
import { CharacterVisual } from './visual';

export type { PortraitFraming } from './portrait_framing';

// ---------------------------------------------------------------------------
// Portrait factory — a 2D "profile photo" rendered from the real 3D character
// model. One tiny offscreen WebGL context renders a head-and-shoulders headshot
// of a (class, skin) pair, captures it as a transparent PNG, and caches the
// data URL. The exact same model/skin data is available client-side for every
// player (entity.templateId + entity.skin), so the same portraits render for
// other players' profiles with no server round-trip.
// ---------------------------------------------------------------------------

// Square render resolution. Crisp at the ~44px list thumbnails and the larger
// profile-window portrait on 2x displays; downscaled by CSS at each call site.
const PORTRAIT_SIZE = 256;

// Idle pose to settle the rig into before the single capture frame (mirrors the
// preview turntable's neutral stance, but with no movement).
const PORTRAIT_ANIM_STATE = {
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
  sitting: false,
};

// Models stand at the origin facing +Z, but their rigs differ in
// height/proportion, so the camera is fit to each model's own bounding box
// (rather than fixed coords), per the fov/target/extent fractions from
// portraitFrameParams (see portrait_framing.ts for the per-framing values).
const scratchBox = new THREE.Box3();
const scratchCenter = new THREE.Vector3();
const scratchSize = new THREE.Vector3();

// The offscreen rig's pieces are always created and torn down together
// (ensureRig / resetPortraitRendererForGraphicsRebuild).
interface PortraitRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mount: THREE.Group;
}

let rig: PortraitRig | null = null;
let unregisterContext: (() => void) | null = null;

const cache = new Map<string, string>();
const readyListeners = new Set<() => void>();
const updateListeners = new Set<(visualKey: string, skin: number) => void>();
const pendingAtlases = new Map<string, Promise<void>>();
let assetsAreReady = false;
void assetsReady()
  .then(() => {
    assetsAreReady = true;
    for (const cb of readyListeners) cb();
    readyListeners.clear();
  })
  .catch(() => {
    /* asset failure surfaces through the main loading screen; portraits just
       keep falling back to the class crest. */
  });

// The x-center of a visual's BODY meshes (userData.bodyMesh, tagged in
// assembleModel), ignoring held props. Null when the visual carries no tagged
// body mesh, so callers fall back to the full-box center.
const bodyScratchBox = new THREE.Box3();
const bodyMeshBox = new THREE.Box3();
function bodyCenterXOf(root: THREE.Object3D): number | null {
  bodyScratchBox.makeEmpty();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.userData.bodyMesh) return;
    bodyMeshBox.setFromObject(mesh);
    if (!bodyMeshBox.isEmpty()) bodyScratchBox.union(bodyMeshBox);
  });
  if (bodyScratchBox.isEmpty()) return null;
  return (bodyScratchBox.min.x + bodyScratchBox.max.x) / 2;
}

function ensureRig(): PortraitRig {
  if (rig) return rig;

  const canvas = document.createElement('canvas');
  const newRenderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  newRenderer.setPixelRatio(1);
  newRenderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
  newRenderer.shadowMap.enabled = false;
  // Hand this offscreen context back on page teardown (see context_release.ts).
  unregisterContext = trackWebGLContext(newRenderer);

  const newScene = new THREE.Scene();
  // fov/position/aim are recomputed per-model per-framing from its bounding
  // box in the capture (see portraitFrameParams); the constructor fov is a
  // placeholder, always overwritten before the first render.
  const newCamera = new THREE.PerspectiveCamera(portraitFrameParams('headshot').fov, 1, 0.1, 100);

  const newMount = new THREE.Group();
  newScene.add(newMount);

  // Soft, even key/fill so faces read clearly at thumbnail size.
  newScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2.5, 4, 4);
  newScene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-3, 2, -2);
  newScene.add(fill);

  rig = { renderer: newRenderer, scene: newScene, camera: newCamera, mount: newMount };
  return rig;
}

/**
 * A transparent-PNG headshot for a (class, skin), or null if the character
 * GLBs are not preloaded yet. Cached after the first render. Callers should
 * fall back to a class crest while null and upgrade via {@link onPortraitsReady}.
 */
export function playerPortraitDataUrl(
  cls: PlayerClass,
  skin = 0,
  framing: PortraitFraming = 'headshot',
): string | null {
  return visualPortraitDataUrl(`player_${cls}`, skin, framing);
}

/**
 * As {@link playerPortraitDataUrl} but for any visual key (e.g. `player_mech`),
 * so cosmetic-only bodies can be previewed as swatch thumbnails. The asset must
 * already be loaded (callers preload first); returns null until then.
 */
export function visualPortraitDataUrl(
  visualKey: string,
  skin = 0,
  framing: PortraitFraming = 'headshot',
): string | null {
  const key = `${visualKey}:${skin}:${framing}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!assetsAreReady) return null;

  if (trackSkinAtlasPending(visualKey, skin)) return null;

  return capture(key, visualKey, () => new CharacterVisual(visualKey, 0xffffff, skin), framing);
}

/** Tight-memory iOS hosts defer the boot skin-atlas sweep (assets.ts), so a
 *  non-default skin's atlas may not be resident yet. Do not capture the
 *  embedded default as if it were the requested chroma: true means "still
 *  streaming, use the fallback"; mounted consumers are notified once the real
 *  atlas arrives. */
function trackSkinAtlasPending(visualKey: string, skin: number): boolean {
  const atlasPending = ensureSkinTexture(visualKey, skin);
  if (!atlasPending) return false;
  const atlasKey = `${visualKey}:${skin}`;
  if (!pendingAtlases.has(atlasKey)) {
    pendingAtlases.set(atlasKey, atlasPending);
    void atlasPending.then(
      () => {
        pendingAtlases.delete(atlasKey);
        for (const cb of updateListeners) cb(visualKey, skin);
      },
      () => {
        pendingAtlases.delete(atlasKey);
      },
    );
  }
  return true;
}

/** Snapshot-encode the portrait canvas to a PNG data URL off the main thread.
 *  toBlob captures the bitmap AT CALL TIME, so a later render into the shared
 *  rig cannot bleed into this capture; the encode itself runs async (the sync
 *  toDataURL path blocks on GPU readback plus PNG encode). Resolves null on an
 *  encode failure (including a synchronous toBlob throw, which must not become
 *  an unhandled rejection); the caller falls back to the lazy sync path. */
function encodePortraitPng(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/**
 * Warm one (class, skin, framing) portrait cache entry with every heavy step
 * bounded or off-thread: texture uploads prepaid in budgeted slices, then one
 * render, then an async PNG encode. The post-entry paced lane calls this so a
 * later synchronous {@link playerPortraitDataUrl} is a cache hit; live callers
 * keep the sync path (43 to 201 ms measured per cold portrait in production,
 * dominated by first-use atlas uploads plus the toDataURL readback/encode).
 */
export async function prewarmPlayerPortrait(
  cls: PlayerClass,
  skin = 0,
  framing: PortraitFraming = 'headshot',
): Promise<void> {
  const visualKey = `player_${cls}`;
  const key = `${visualKey}:${skin}:${framing}`;
  let prewarmRig: PortraitRig | null = null;
  await runPortraitPrewarm<CharacterVisual>({
    cached: () => cache.has(key),
    ready: () => assetsAreReady,
    atlasPending: () => trackSkinAtlasPending(visualKey, skin),
    build: () => {
      prewarmRig = ensureRig();
      return new CharacterVisual(visualKey, 0xffffff, skin);
    },
    // This offscreen context is separate from the world renderer, so atlases
    // resident there still upload here on first draw; prepay them in slices.
    // The visual stays UNMOUNTED for this: initTexture needs no scene, and
    // the mount is shared with the synchronous capture() path, so a visual
    // left mounted across an await would bleed into any concurrent live
    // portrait capture (and that capture's visual into ours).
    uploadTextures: async (visual) => {
      const textures = new Set<THREE.Texture>();
      collectPrewarmTextures(visual.root, textures);
      if (!prewarmRig) return;
      const activeRig = prewarmRig;
      await uploadTexturesInSlices(activeRig.renderer, textures, {
        yieldToMain: yieldToMainThread,
        // A graphics rebuild mid-sweep disposes the rig (renderer goes null).
        isCancelled: () => rig !== activeRig,
      });
    },
    current: () => rig === prewarmRig,
    // Link this context's programs asynchronously before the draw: the
    // portrait rig never ran a compileAsync, so the first portrait of each
    // cold program set paid the shader link inside its render call (S9
    // measured 248 and 150 ms on the first two portrait units). compileAsync
    // walks the scene SYNCHRONOUSLY at call time, so the visual is mounted
    // only around that call and unmounted before the link is awaited: no
    // concurrent sync capture can render it (see the mount-sharing note
    // above), and the captured material list keeps polling regardless.
    compile: (visual) => {
      if (!prewarmRig) return Promise.resolve();
      const activeRig = prewarmRig;
      activeRig.mount.add(visual.root);
      const compiled = activeRig.renderer.compileAsync(activeRig.scene, activeRig.camera);
      activeRig.mount.remove(visual.root);
      return compiled.then(() => undefined);
    },
    // Fully synchronous window: renderPortraitFrame re-mounts and renders,
    // and toBlob snapshots the bitmap at call time, so nothing can interleave
    // between the draw and the capture.
    renderAndSnapshot: (visual) => {
      if (!prewarmRig) return Promise.resolve(null);
      renderPortraitFrame(prewarmRig, visual, visualKey, framing);
      return encodePortraitPng(prewarmRig.renderer.domElement);
    },
    release: (visual) => {
      prewarmRig?.mount.remove(visual.root);
      visual.dispose();
    },
    commit: (url) => cache.set(key, url),
    onError: (err) => {
      if (import.meta.env?.DEV) console.warn(`[portrait] prewarm failed for ${key}`, err);
    },
  });
}

/**
 * A headshot of a COMPOSED character, the player's own body, hair, face and
 * makeup, rather than the generic portrait for their class.
 *
 * Keyed on the look's full signature, which is what makes "the picture of me is
 * me" true after every change in the customizer. That key is unbounded (a
 * colour wheel has a lot of values in it), so unlike the class portraits these
 * entries are capped and evicted oldest-first: a creation session that drags a
 * slider around would otherwise hold a PNG per position.
 */
const MODULAR_PORTRAIT_CACHE_MAX = 24;
const modularKeys: string[] = [];

export function modularPortraitDataUrl(
  visualKey: string,
  look: ModularLook,
  framing: PortraitFraming = 'headshot',
): string | null {
  const key = `${visualKey}:mod:${modularSignature(look.app, look.worn)}:${framing}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!assetsAreReady) return null;
  const url = capture(
    key,
    visualKey,
    () => new CharacterVisual(visualKey, 0xffffff, 0, null, null, null, look),
    framing,
  );
  if (url) {
    modularKeys.push(key);
    while (modularKeys.length > MODULAR_PORTRAIT_CACHE_MAX) {
      const oldest = modularKeys.shift();
      if (oldest) cache.delete(oldest);
    }
  }
  return url;
}

/** Mount `visual` in the offscreen rig, settle its pose, aim the camera for
 *  `framing`, and render one frame. The caller owns the readback (synchronous
 *  toDataURL for the live path, async toBlob for the prewarm path) and the
 *  visual's unmount/dispose. */
function renderPortraitFrame(
  rig: PortraitRig,
  visual: CharacterVisual,
  visualKey: string,
  framing: PortraitFraming,
) {
  rig.mount.add(visual.root);
  rig.mount.rotation.y = 0;
  // Settle the rig into a stable idle frame before measuring/capturing.
  visual.update(0.4, PORTRAIT_ANIM_STATE, true);

  // Frame the model from its own bounds so every class (tall or short,
  // helmeted or bare) lands the same in the circle/card. This box drives the
  // zoom (height, feet, depth) and MUST stay the full root: shrinking it
  // would pull the camera in and change every class's portrait scale.
  scratchBox.setFromObject(visual.root);
  scratchBox.getCenter(scratchCenter);
  scratchBox.getSize(scratchSize);
  // Box3.setFromObject reads skinned geometry in bind space through the node
  // matrices, which some rigs (the Quaternius raptor, the floating ghost)
  // report orders of magnitude off, framing the camera on empty space. The
  // visual root is already normalized to the manifest height with feet at
  // the origin, so when the measured box is implausible, frame from that
  // known height instead.
  const defH = VISUALS[visualKey]?.height ?? 1.8;
  const implausible =
    !Number.isFinite(scratchSize.y) ||
    scratchSize.y < 0.3 * defH ||
    scratchSize.y > 3 * defH ||
    Math.abs(scratchCenter.x) > defH ||
    Math.abs(scratchCenter.z) > defH;
  if (implausible) {
    // Generous footprint: long quadrupeds extend well past a biped's, and an
    // oversized box only backs the camera off a little.
    scratchBox.min.set(-0.5 * defH, 0, -0.9 * defH);
    scratchBox.max.set(0.5 * defH, defH, 0.9 * defH);
    scratchBox.getCenter(scratchCenter);
    scratchBox.getSize(scratchSize);
  }
  const h = scratchSize.y || 1.8;
  // Horizontal aim only: a single held weapon (the paladin's axe) sits off to
  // one side and skews the full box's x-center, pushing the character left in
  // the frame. Aim at the BODY's x-center instead (body meshes carry
  // userData.bodyMesh, set in assembleModel; held props do not). Zoom and
  // vertical framing still come from the full box above, so portrait SCALE is
  // unchanged for every class; only the sideways aim is corrected.
  const bodyCenterX = bodyCenterXOf(visual.root) ?? scratchCenter.x;
  const { fov, targetYFromFeetFrac, extentFrac } = portraitFrameParams(framing);
  rig.camera.fov = fov;
  const targetY = scratchBox.min.y + targetYFromFeetFrac * h;
  const extent = extentFrac * h;
  const dist = extent / 2 / Math.tan((fov * Math.PI) / 180 / 2);
  rig.camera.position.set(bodyCenterX + 0.04 * h, targetY + 0.02 * h, scratchBox.max.z + dist);
  rig.camera.lookAt(bodyCenterX, targetY, scratchCenter.z);
  rig.camera.updateProjectionMatrix();

  rig.renderer.render(rig.scene, rig.camera);
}

/** Render one visual into the offscreen rig and return it as a PNG data URL.
 *  Shared by the class portraits and the composed ones, the only difference
 *  between them is which CharacterVisual gets built. */
function capture(
  key: string,
  visualKey: string,
  build: () => CharacterVisual,
  framing: PortraitFraming,
): string | null {
  // Paired so cleanup below can prove the rig is available whenever there is
  // a visual to dispose, with no non-null assertions on either side.
  let active: { rig: PortraitRig; visual: CharacterVisual } | null = null;
  try {
    const rig = ensureRig();
    const visual = build();
    active = { rig, visual };
    renderPortraitFrame(rig, visual, visualKey, framing);
    const url = rig.renderer.domElement.toDataURL('image/png');
    cache.set(key, url);
    return url;
  } catch (err) {
    if (import.meta.env?.DEV) console.warn(`[portrait] failed for ${key}`, err);
    return null;
  } finally {
    if (active) {
      active.rig.mount.remove(active.visual.root);
      active.visual.dispose();
    }
  }
}

/** Run `cb` once character assets finish preloading (immediately if already
 *  ready), so a fallback crest can be swapped for the real portrait. */
export function onPortraitsReady(cb: () => void): void {
  if (assetsAreReady) cb();
  else readyListeners.add(cb);
}

/** Subscribe to newly available deferred atlases so mounted portrait consumers
 * can replace their fallback without waiting for an unrelated repaint. */
export function onPortraitUpdate(cb: (visualKey: string, skin: number) => void): void {
  updateListeners.add(cb);
}

/** True once portraits can be generated synchronously. */
export function portraitsReady(): boolean {
  return assetsAreReady;
}

/**
 * Drop the profile-bound offscreen renderer and its captured PNGs before a
 * live graphics rebuild. Asset readiness/listeners remain valid; the next
 * portrait request lazily creates one context against the newly active profile.
 */
export function resetPortraitRendererForGraphicsRebuild(): void {
  cache.clear();
  if (rig) {
    rig.scene.remove(rig.mount);
    try {
      rig.renderer.forceContextLoss();
    } catch {
      // The context may already have been evicted by the browser.
    }
    rig.renderer.dispose();
  }
  unregisterContext?.();
  unregisterContext = null;
  rig = null;
}
