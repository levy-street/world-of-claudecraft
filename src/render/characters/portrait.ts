import * as THREE from 'three';
import { CharacterVisual } from './visual';
import { assetsReady } from '../assets/preload';
import { PlayerClass } from '../../sim/types';
import { trackWebGLContext } from '../context_release';

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
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  sitting: false,
};

// Head-and-shoulders framing. Models stand at the origin facing +Z, but their
// rigs differ in height/proportion, so the camera is fit to each model's own
// bounding box (rather than fixed coords) — the face always lands in the upper
// third with a little headroom.
const CAM_FOV = 26;
const scratchBox = new THREE.Box3();
const scratchCenter = new THREE.Vector3();
const scratchSize = new THREE.Vector3();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let mount: THREE.Group | null = null;

const cache = new Map<string, string>();
const readyListeners = new Set<() => void>();
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
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
  renderer.shadowMap.enabled = false;
  // Hand this offscreen context back on page teardown (see context_release.ts).
  trackWebGLContext(renderer);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
  // Position/aim is recomputed per-model from its bounding box in the capture.

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
export function playerPortraitDataUrl(cls: PlayerClass, skin = 0): string | null {
  return visualPortraitDataUrl(`player_${cls}`, skin);
}

/**
 * As {@link playerPortraitDataUrl} but for any visual key (e.g. `player_mech`),
 * so cosmetic-only bodies can be previewed as swatch thumbnails. The asset must
 * already be loaded (callers preload first); returns null until then.
 */
export function visualPortraitDataUrl(visualKey: string, skin = 0): string | null {
  const key = `${visualKey}:${skin}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!assetsAreReady) return null;

  let visual: CharacterVisual | null = null;
  try {
    ensureRig();
    visual = new CharacterVisual(visualKey, 0xffffff, skin);
    mount!.add(visual.root);
    mount!.rotation.y = 0;
    // Settle the rig into a stable idle frame before measuring/capturing.
    visual.update(0.4, PORTRAIT_ANIM_STATE, true);

    // Frame the head/shoulders from the model's own bounds so every class —
    // tall or short, helmeted or bare — lands the same in the circle.
    scratchBox.setFromObject(visual.root);
    scratchBox.getCenter(scratchCenter);
    scratchBox.getSize(scratchSize);
    const h = scratchSize.y || 1.8;
    const targetY = scratchBox.max.y - 0.30 * h; // look lower so the head/shoulders sit higher in the frame
    const extent = 0.44 * h; // vertical slice to show: head + shoulders (tighter = subject fills more)
    const dist = extent / 2 / Math.tan((CAM_FOV * Math.PI) / 180 / 2);
    camera!.position.set(scratchCenter.x + 0.04 * h, targetY + 0.02 * h, scratchBox.max.z + dist);
    camera!.lookAt(scratchCenter.x, targetY, scratchCenter.z);

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

/** True once portraits can be generated synchronously. */
export function portraitsReady(): boolean {
  return assetsAreReady;
}
