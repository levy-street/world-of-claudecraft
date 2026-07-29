import * as THREE from 'three';
import type { PlayerClass } from '../../sim/types';
import { assetsReady } from '../assets/preload';
import { trackWebGLContext } from '../context_release';
import { ensureSkinTexture } from './assets';
import { VISUALS } from './manifest';
import { type ModularLook, modularSignature } from './modular';
import { type PortraitFraming, portraitFrameParams } from './portrait_framing';
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

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let mount: THREE.Group | null = null;
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

function ensureRig(): void {
  if (renderer) return;
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
  renderer.shadowMap.enabled = false;
  // Hand this offscreen context back on page teardown (see context_release.ts).
  unregisterContext = trackWebGLContext(renderer);

  scene = new THREE.Scene();
  // fov/position/aim are recomputed per-model per-framing from its bounding
  // box in the capture (see portraitFrameParams); the constructor fov is a
  // placeholder, always overwritten before the first render.
  camera = new THREE.PerspectiveCamera(portraitFrameParams('headshot').fov, 1, 0.1, 100);

  mount = new THREE.Group();
  scene.add(mount);

  // Soft, even key/fill so faces read clearly at thumbnail size.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2.5, 4, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-3, 2, -2);
  scene.add(fill);
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

  // Tight-memory iOS hosts defer the boot skin-atlas sweep (assets.ts), so a
  // non-default skin's atlas may not be resident yet. Do not capture the
  // embedded default as if it were the requested chroma. Return the normal
  // fallback and notify mounted consumers once the real atlas arrives.
  const atlasPending = ensureSkinTexture(visualKey, skin);
  if (atlasPending) {
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
    return null;
  }

  return capture(key, visualKey, () => new CharacterVisual(visualKey, 0xffffff, skin), framing);
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

/** Render one visual into the offscreen rig and return it as a PNG data URL.
 *  Shared by the class portraits and the composed ones, the only difference
 *  between them is which CharacterVisual gets built. */
function capture(
  key: string,
  visualKey: string,
  build: () => CharacterVisual,
  framing: PortraitFraming,
): string | null {
  let visual: CharacterVisual | null = null;
  try {
    ensureRig();
    visual = build();
    mount!.add(visual.root);
    mount!.rotation.y = 0;
    // Settle the rig into a stable idle frame before measuring/capturing.
    visual.update(0.4, PORTRAIT_ANIM_STATE, true);

    // Frame the model from its own bounds so every class (tall or short,
    // helmeted or bare) lands the same in the circle/card.
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
    const { fov, targetYFromFeetFrac, extentFrac } = portraitFrameParams(framing);
    camera!.fov = fov;
    const targetY = scratchBox.min.y + targetYFromFeetFrac * h;
    const extent = extentFrac * h;
    const dist = extent / 2 / Math.tan((fov * Math.PI) / 180 / 2);
    camera!.position.set(scratchCenter.x + 0.04 * h, targetY + 0.02 * h, scratchBox.max.z + dist);
    camera!.lookAt(scratchCenter.x, targetY, scratchCenter.z);
    camera!.updateProjectionMatrix();

    renderer!.render(scene!, camera!);
    const url = renderer!.domElement.toDataURL('image/png');
    cache.set(key, url);
    return url;
  } catch (err) {
    if (import.meta.env?.DEV) console.warn(`[portrait] failed for ${key}`, err);
    return null;
  } finally {
    if (visual) {
      mount!.remove(visual.root);
      visual.dispose();
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
  if (mount && scene) scene.remove(mount);
  unregisterContext?.();
  unregisterContext = null;
  if (renderer) {
    try {
      renderer.forceContextLoss();
    } catch {
      // The context may already have been evicted by the browser.
    }
    renderer.dispose();
  }
  renderer = null;
  scene = null;
  camera = null;
  mount = null;
}
