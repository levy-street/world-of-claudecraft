// The Proving Grounds room: a warm, candle-lit circular LIBRARY the minigame-hub
// portal drops you into. A wooden rotunda ringed with bookcases and reading
// nooks, lit by wall torches and a central chandelier, with the two event
// heralds standing on the rug facing the middle. Built once when the player
// approaches the hub band and kept for the session.
//
// Set pieces are the already-bundled CC0 KayKit dungeon kit (see CREDITS.md),
// loaded and placed with the gauntlet_venue idiom: shared GLB clones (never
// disposed here) + a handful of unique procedural shell geometries (tracked and
// disposed on teardown), the whole subtree matrix-frozen after build. Pure
// static dressing anchored to MINIGAME_HUB; it never touches IWorld.

import * as THREE from 'three';
import { MINIGAME_HUB_RADIUS } from '../sim/data';
import { minigameHubFurniture } from '../sim/minigame_hub_layout';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { freezeStaticMatrices } from './static_matrix';

export interface MinigameHubView {
  group: THREE.Group;
  /** `t` drives the candle flicker; `cam`/`eye` (world-space camera + look-at)
   * drive the roof cull. Both position args are optional so a headless/test
   * caller can tick the flicker without a camera. */
  update(
    t: number,
    cam?: { x: number; y: number; z: number },
    eye?: { x: number; y: number; z: number },
  ): void;
  dispose(scene: THREE.Scene): void;
}

const HUB_MODELS = {
  bookcase: 'models/dungeon/bookcase_double_decorateda.glb',
  bookcaseB: 'models/dungeon/bookcase_double_decoratedb.glb',
  tableRound: 'models/dungeon/table_round_medium.glb',
  tableLong: 'models/dungeon/table_long_decorated_a.glb',
  chair: 'models/dungeon/chair.glb',
  bookBrown: 'models/dungeon/book_brown.glb',
  bookGrey: 'models/dungeon/book_grey.glb',
  bookTan: 'models/dungeon/book_tan.glb',
  candles: 'models/dungeon/shelf_small_candles.glb',
  candle: 'models/dungeon/candle_thin_lit.glb',
  torch: 'models/dungeon/torch_lit.glb',
  bannerRed: 'models/dungeon/banner_patterna_red.glb',
  bannerBlue: 'models/dungeon/banner_patterna_blue.glb',
  bannerGreen: 'models/dungeon/banner_patterna_green.glb',
} as const;

type HubModelKey = keyof typeof HUB_MODELS;

const modelCache = new Map<HubModelKey, THREE.Object3D>();
const modelHeight = new Map<HubModelKey, number>();
let assetsPromise: Promise<void> | null = null;

export function ensureMinigameHubAssets(): Promise<void> {
  assetsPromise ??= Promise.all(
    (Object.keys(HUB_MODELS) as HubModelKey[]).map((key) =>
      loadGltf(HUB_MODELS[key]).then((gltf) => {
        modelCache.set(key, gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        modelHeight.set(key, Math.max(0.001, box.max.y - box.min.y));
      }),
    ),
  ).then(() => undefined);
  return assetsPromise;
}

if (typeof window !== 'undefined') registerPreload(ensureMinigameHubAssets());

// Clone a cached set piece scaled so its bounding height equals targetH yards
// (kit pieces ship at whatever scale their pack chose; measuring beats
// guessing). Marked sharedGeometry so dispose() leaves the source cache alone.
function placeProp(
  group: THREE.Group,
  key: HubModelKey,
  x: number,
  y: number,
  z: number,
  rotY: number,
  targetH: number,
): THREE.Object3D {
  const src = modelCache.get(key);
  if (!src) throw new Error(`minigame hub asset not preloaded: ${key}`);
  const obj = src.clone(true);
  obj.userData.sharedGeometry = true;
  obj.scale.setScalar(targetH / (modelHeight.get(key) ?? 1));
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.add(obj);
  return obj;
}

const WALL_HEIGHT = 8;
const CEILING_Y = WALL_HEIGHT;

export async function buildMinigameHub(
  scene: THREE.Scene,
  ox: number,
  oz: number,
): Promise<MinigameHubView> {
  await ensureMinigameHubAssets();
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);

  // Only the procedural shell geometries are disposed on teardown; the GLB
  // clones share the source cache geometry (never disposed here).
  const geoms: THREE.BufferGeometry[] = [];
  const track = <G extends THREE.BufferGeometry>(g: G): G => {
    geoms.push(g);
    return g;
  };

  const R = MINIGAME_HUB_RADIUS; // 18
  const outerR = R + 0.6;

  // --- shell: warm oak floor, sandstone wall + wood wainscot, wood ceiling ---
  const floor = new THREE.Mesh(
    track(new THREE.CylinderGeometry(outerR, outerR, 0.4, 72)),
    surfaceMat({ color: 0x6b4a2c, roughness: 0.8 }),
  );
  floor.position.y = -0.2;
  floor.receiveShadow = true;
  group.add(floor);

  // a deep-red rug with a gold border under the middle of the room
  const rug = new THREE.Mesh(
    track(new THREE.CylinderGeometry(6.6, 6.6, 0.06, 56)),
    surfaceMat({ color: 0x7a2233, roughness: 0.95 }),
  );
  rug.position.y = 0.02;
  rug.receiveShadow = true;
  group.add(rug);
  const rugTrim = new THREE.Mesh(
    track(new THREE.TorusGeometry(6.6, 0.16, 8, 56)),
    surfaceMat({ color: 0xc9a24a, emissive: 0x2a1e08, roughness: 0.6 }),
  );
  rugTrim.rotation.x = Math.PI / 2;
  rugTrim.position.y = 0.06;
  group.add(rugTrim);

  const wall = new THREE.Mesh(
    track(new THREE.CylinderGeometry(outerR, outerR, WALL_HEIGHT, 72, 1, true)),
    surfaceMat({ color: 0xc7b48f, roughness: 0.9, side: THREE.BackSide }),
  );
  wall.position.y = WALL_HEIGHT / 2;
  group.add(wall);
  // dark-wood wainscot band at the base
  const wainscot = new THREE.Mesh(
    track(new THREE.CylinderGeometry(outerR - 0.04, outerR - 0.04, 1.4, 72, 1, true)),
    surfaceMat({ color: 0x4a3320, roughness: 0.85, side: THREE.BackSide }),
  );
  wainscot.position.y = 0.7;
  group.add(wainscot);
  // The roof (ceiling + beams + the chandelier chain) lives in its own group so
  // the whole cap can be hidden as one when the chase camera rises through it
  // (small enclosed room: the boom pushes above the ceiling and would otherwise
  // occlude the top-down view of the player). Toggled in update().
  const roof = new THREE.Group();
  group.add(roof);
  // warm wood ceiling, faintly emissive so it reads lit rather than as a dark cap
  const ceiling = new THREE.Mesh(
    track(new THREE.CylinderGeometry(outerR, outerR, 0.4, 72)),
    surfaceMat({ color: 0x7a5a38, emissive: 0x241708, emissiveIntensity: 0.5, roughness: 0.9 }),
  );
  ceiling.position.y = CEILING_Y;
  roof.add(ceiling);
  // radial ceiling beams for a coffered look
  const beamMat = surfaceMat({ color: 0x4a3320, roughness: 0.8 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const beam = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.5, outerR * 2)), beamMat);
    beam.position.y = CEILING_Y - 0.35;
    beam.rotation.y = a;
    roof.add(beam);
  }

  // --- collidable furniture: bookcases ringing the wall + the reading tables
  //     and chairs, placed from the SHARED layout so what you see is what you
  //     collide with (the sim builds its hub colliders from the same
  //     minigameHubFurniture() list) ---
  for (const f of minigameHubFurniture()) {
    switch (f.kind) {
      case 'bookcaseA':
        placeProp(group, 'bookcase', f.x, 0, f.z, f.rot, 4.4);
        break;
      case 'bookcaseB':
        placeProp(group, 'bookcaseB', f.x, 0, f.z, f.rot, 4.4);
        break;
      case 'tableRound': {
        // a round reading table with scattered books + a candle, flanked by the
        // chair entries below (east and west of the rug)
        placeProp(group, 'tableRound', f.x, 0, f.z, f.rot, 1.1);
        const side = f.x < 0 ? -1 : 1;
        placeProp(group, 'candle', f.x, 1.15, f.z, 0, 0.7);
        placeProp(group, 'bookBrown', f.x + 0.35, 1.05, f.z + 0.2, side * 0.6, 0.18);
        placeProp(group, 'bookGrey', f.x - 0.3, 1.05, f.z - 0.15, side * 1.4, 0.18);
        break;
      }
      case 'chair':
        placeProp(group, 'chair', f.x, 0, f.z, f.rot, 1.6);
        break;
      case 'tableLong':
        // the long study table with stacked books + candles behind the heralds
        placeProp(group, 'tableLong', f.x, 0, f.z, f.rot, 1.1);
        placeProp(group, 'bookTan', f.x - 0.6, 1.1, f.z, 0.3, 0.2);
        placeProp(group, 'bookBrown', f.x + 0.5, 1.1, f.z + 0.1, -0.5, 0.2);
        placeProp(group, 'candles', f.x + 1.4, 1.05, f.z - 0.1, 0, 0.6);
        break;
    }
  }

  // --- wall torches between the bookcases; every other one carries a warm
  //     point light + a colored banner (the light count is kept modest for
  //     low-end GPUs, the unlit torches read from their emissive flame + fill) ---
  const torchR = R - 0.4;
  const torchLights: THREE.PointLight[] = [];
  const TORCHES = 6;
  for (let i = 0; i < TORCHES; i++) {
    const a = ((i + 0.5) / TORCHES) * Math.PI * 2;
    const x = Math.sin(a) * torchR;
    const z = Math.cos(a) * torchR;
    placeProp(group, 'torch', x, 2.4, z, a + Math.PI, 2.2);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(0xffb15a, 7, 30, 2);
      light.position.set(x * 0.92, 4.0, z * 0.92);
      group.add(light);
      torchLights.push(light);
      const banner = (['bannerRed', 'bannerBlue', 'bannerGreen'] as const)[(i / 2) % 3];
      placeProp(
        group,
        banner,
        Math.sin(a) * (R - 0.2),
        5.4,
        Math.cos(a) * (R - 0.2),
        a + Math.PI,
        3,
      );
    }
  }

  // --- central chandelier: a brass ring of candles hung over the rug ---
  const chandelierY = WALL_HEIGHT - 1.6;
  const ring = new THREE.Mesh(
    track(new THREE.TorusGeometry(1.6, 0.12, 8, 32)),
    surfaceMat({ color: 0xb8863a, metalness: 0.5, roughness: 0.4 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = chandelierY;
  group.add(ring);
  const chain = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.04, 0.04, CEILING_Y - chandelierY, 6)),
    beamMat,
  );
  chain.position.y = (CEILING_Y + chandelierY) / 2;
  // the chain hangs from the ceiling: hide it with the roof so it never dangles
  // from nothing once the cap is culled.
  roof.add(chain);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    placeProp(group, 'candle', Math.sin(a) * 1.6, chandelierY, Math.cos(a) * 1.6, 0, 0.55);
  }
  const chandelierLight = new THREE.PointLight(0xffd08a, 9, 40, 2);
  chandelierLight.position.set(0, chandelierY - 0.2, 0);
  group.add(chandelierLight);

  // a soft warm fill so faces read even away from a flame
  const fill = new THREE.PointLight(0xfff0d6, 4, 60, 2);
  fill.position.set(0, WALL_HEIGHT - 0.5, 0);
  group.add(fill);

  const flicker: THREE.PointLight[] = [...torchLights, chandelierLight];
  const flickerBase = flicker.map((l) => l.intensity);

  freezeStaticMatrices(group);
  scene.add(group);

  // Roof-cull state: the room centre in world XZ and the squared footprint
  // radius the sightline crossing is tested against, plus the last toggle (so
  // the visibility write is elided on unchanged frames).
  const roofR2 = outerR * outerR;
  let roofHidden = false;

  return {
    group,
    update(
      t: number,
      cam?: { x: number; y: number; z: number },
      eye?: { x: number; y: number; z: number },
    ) {
      // A gentle deterministic candle flicker; allocation-free (only intensity
      // moves, matrices stay frozen).
      for (let i = 0; i < flicker.length; i++) {
        const f = 0.9 + Math.sin(t * 6 + i * 1.7) * 0.07 + Math.sin(t * 12.7 + i) * 0.03;
        flicker[i].intensity = flickerBase[i] * f;
      }
      // Hide the roof once the camera sits above the ceiling AND the eye->camera
      // sightline crosses the ceiling disc: exactly when the cap would occlude
      // the player from an overhead boom. The eye (look-at, ~head height) is
      // always below the ceiling while the player is in the room, so the linear
      // crossing param is well defined.
      if (cam && eye) {
        let hide = false;
        if (cam.y > CEILING_Y && eye.y < CEILING_Y) {
          const s = (CEILING_Y - eye.y) / (cam.y - eye.y); // 0..1
          const hx = eye.x + (cam.x - eye.x) * s - ox;
          const hz = eye.z + (cam.z - eye.z) * s - oz;
          hide = hx * hx + hz * hz <= roofR2;
        }
        if (hide !== roofHidden) {
          roofHidden = hide;
          roof.visible = !hide;
        }
      }
    },
    dispose(s: THREE.Scene) {
      s.remove(group);
      for (const g of geoms) g.dispose();
      // GLB clones share the source cache geometry; never dispose them here.
    },
  };
}
