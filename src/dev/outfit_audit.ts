// Dev-only outfit audit rig (not shipped; imported by hand from the console).
// Renders a composed modular character in a chosen armor set / gender /
// colorway at high resolution from several yaw angles and POSTs the PNGs to a
// local receiver (scratch server on :5999), so clipping and dye issues can be
// inspected at pixel level outside the tiny creation viewport.
import * as THREE from 'three';
import { assetsReady } from '../render/assets/preload';
import {
  type ArmorSetId,
  CLASS_ARMOR_SETS,
  fullSet,
  type ModularAppearance,
  normalizeAppearance,
} from '../render/characters/modular';
import { CharacterVisual } from '../render/characters/visual';

const ANIM = {
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

const SET_CLASS: Record<ArmorSetId, string> = (() => {
  const out: Record<string, string> = {};
  for (const [cls, set] of Object.entries(CLASS_ARMOR_SETS)) {
    if (!(set in out)) out[set] = cls;
  }
  return out as Record<ArmorSetId, string>;
})();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let mount: THREE.Group | null = null;

function rig(size: number): void {
  if (renderer) {
    renderer.setSize(size, size, false);
    return;
  }
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30343a);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  mount = new THREE.Group();
  scene.add(mount);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2.5, 4, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-3, 2, -2);
  scene.add(fill);
}

async function post(name: string, blob: Blob): Promise<void> {
  await fetch(`http://localhost:5999/?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: blob,
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

export interface ShotOpts {
  set: ArmorSetId;
  gender?: 'male' | 'female';
  app?: Partial<ModularAppearance>;
  /** yaw angles in degrees; default 8 around the compass */
  angles?: number[];
  size?: number;
  /** paint every skin material hot pink so body-through-armor reads instantly */
  pink?: boolean;
  /** crop framing: 'full' body or 'torso' */
  frame?: 'full' | 'torso';
  /** Frame off a FIXED box instead of the visual's own bounds. Required for an
   *  honest A/B of a shape slider: bounds-based framing moves the camera when
   *  the shape changes, so every shot lands at a different scale and the
   *  comparison shows the framing rather than the change. */
  fixedFrame?: boolean;
  /** [minY, maxY, halfXZ] of the fixed box, e.g. the head only, for a face
   *  slider. Implies fixedFrame. */
  fixedBox?: [number, number, number];
  label?: string;
}

export async function shoot(opts: ShotOpts): Promise<string> {
  await assetsReady();
  const size = opts.size ?? 1024;
  rig(size);
  const gender = opts.gender ?? 'male';
  const app = normalizeAppearance({
    gender,
    hair: 'bald',
    beard: 'none',
    lashes: false,
    ...opts.app,
  });
  const worn = fullSet(opts.set);
  const cls = SET_CLASS[opts.set] ?? 'warrior';
  const visual = new CharacterVisual(`player_${cls}_modular`, 0xffffff, 0, null, null, null, {
    app,
    worn,
  });
  mount!.add(visual.root);
  mount!.rotation.y = 0;
  visual.update(0.4, ANIM, true);
  visual.root.traverse((o) => {
    o.frustumCulled = false;
    const mesh = o as THREE.Mesh;
    if (opts.pink && mesh.isMesh) {
      // clone before painting, the originals are the game's shared material
      // cache, and mutating them leaks pink into every later render
      const paint = (m: THREE.Material): THREE.Material => {
        if (!(m?.name ?? '').toLowerCase().includes('skin')) return m;
        const std = m.clone() as THREE.MeshStandardMaterial;
        if ('color' in std) std.color = new THREE.Color(0xff00cc);
        if ('emissive' in std) std.emissive = new THREE.Color(0xff00cc);
        if ('map' in std) std.map = null;
        return std;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(paint)
        : paint(mesh.material);
    }
  });

  const fb = opts.fixedBox ?? (opts.fixedFrame ? [0, 1.8, 0.9] : null);
  const box = fb
    ? new THREE.Box3(
        new THREE.Vector3(-fb[2], fb[0], -fb[2]),
        new THREE.Vector3(fb[2], fb[1], fb[2]),
      )
    : new THREE.Box3().setFromObject(visual.root);
  const center = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  const h = sz.y || 1.8;
  const frame = opts.frame ?? 'full';
  const targetY = box.min.y + (frame === 'torso' ? 0.45 : 0.5) * h;
  const extent = (frame === 'torso' ? 0.62 : 1.1) * h;
  const fov = 30;
  const dist = extent / 2 / Math.tan((fov * Math.PI) / 180 / 2);

  const label =
    opts.label ??
    `${opts.set}_${gender}${opts.pink ? '_pink' : ''}${opts.app?.outfit ? `_${opts.app.outfit}` : ''}`;
  const angles = opts.angles ?? [0, 45, 90, 135, 180, 225, 270, 315];
  for (const deg of angles) {
    mount!.rotation.y = (deg * Math.PI) / 180;
    // rotate the MOUNT, re-measure nothing: camera stays fixed on the same box
    camera!.fov = fov;
    camera!.position.set(center.x, targetY + 0.02 * h, box.max.z + dist);
    camera!.lookAt(center.x, targetY, center.z);
    camera!.updateProjectionMatrix();
    renderer!.render(scene!, camera!);
    await post(`${label}_${String(deg).padStart(3, '0')}`, await toBlob(renderer!.domElement));
  }

  mount!.remove(visual.root);
  visual.dispose?.();
  return label;
}

export async function shootAll(opts: {
  sets?: ArmorSetId[];
  genders?: Array<'male' | 'female'>;
  pink?: boolean;
  angles?: number[];
  size?: number;
  app?: Partial<ModularAppearance>;
}): Promise<string[]> {
  const sets = opts.sets ?? (Object.keys(SET_CLASS) as ArmorSetId[]);
  const genders = opts.genders ?? ['male', 'female'];
  const done: string[] = [];
  for (const set of sets) {
    for (const gender of genders) {
      done.push(
        await shoot({
          set,
          gender,
          pink: opts.pink,
          angles: opts.angles,
          size: opts.size,
          app: opts.app,
        }),
      );
    }
  }
  return done;
}

declare global {
  interface Window {
    __outfitAudit?: { shoot: typeof shoot; shootAll: typeof shootAll };
  }
}
window.__outfitAudit = { shoot, shootAll };
