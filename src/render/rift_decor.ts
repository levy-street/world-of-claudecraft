// Decor for AUTHORED rift floors (the Infernal Citadel set-piece): the Tripo prop
// set plus the two procedural pieces a mesh generator does not do well (the flat
// pentagram sigil and the floor rugs).
//
// A sibling module the interior builder calls, not a method bank on dungeon.ts.
// Reads only the sim's authored `decor` table (key + pose + measured radius), so
// what is drawn here is exactly what `rift/authored.ts` gives collision.
//
// The GLBs load lazily on the first authored floor (a rare seed: paying seven
// preloads at every boot for it would be wasteful) and are cached by url in the
// shared loader, so a second citadel reuses the same parse.

import * as THREE from 'three';
import type { AuthoredDecor } from '../sim/dungeon_layout';
import { loadGltf } from './assets/loader';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

/** Every GLB-backed decor key, and the world-unit height its model is fitted to. */
const DECOR_MODELS: Record<string, { url: string; height: number }> = {
  infernal_brazier: { url: '/models/props/infernal_brazier.glb', height: 1.6 },
  infernal_altar: { url: '/models/props/infernal_altar.glb', height: 1.2 },
  demon_idol: { url: '/models/props/demon_idol.glb', height: 3.0 },
  hell_forge: { url: '/models/props/hell_forge.glb', height: 2.2 },
  hanging_cage: { url: '/models/props/hanging_cage.glb', height: 2.4 },
  bone_pile: { url: '/models/props/bone_pile.glb', height: 0.7 },
  obsidian_fang: { url: '/models/props/obsidian_fang.glb', height: 1.5 },
  infernal_statue: { url: '/models/props/infernal_statue.glb', height: 2.6 },
  slag_cauldron: { url: '/models/props/slag_cauldron.glb', height: 1.3 },
  bone_throne: { url: '/models/props/bone_throne.glb', height: 2.2 },
};

/** The arcane flame the rune pylons already use, re-tinted for the citadel's
 * braziers and the pentagram's five candles. Zero new assets. */
const FLAME_URL = '/models/props/rift_flame.glb';

type Gltf = Awaited<ReturnType<typeof loadGltf>>;
const cache = new Map<string, Gltf | null>();

function markShared(gltf: Gltf): void {
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    markSharedGeometry(mesh.geometry);
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(markSharedMaterial);
    else markSharedMaterial(mat);
  });
}

/** Load every model an authored floor's decor needs (once per process). A model
 * that fails to load resolves to null and its decor entry is simply skipped, so a
 * missing asset never breaks the floor. */
export async function ensureInfernalDecorAssets(): Promise<void> {
  const urls = [FLAME_URL, ...Object.values(DECOR_MODELS).map((m) => m.url)];
  await Promise.all(
    urls.map(async (url) => {
      if (cache.has(url)) return;
      try {
        const gltf = await loadGltf(url);
        markShared(gltf);
        cache.set(url, gltf);
      } catch {
        cache.set(url, null);
      }
    }),
  );
}

/** Clone a loaded prop, center it on xz, sit its base on y=0, and fit it to
 * `height` world units (the same fit the rift gate + puzzle props use). */
function fitted(gltf: Gltf, height: number): THREE.Group {
  const g = new THREE.Group();
  const model = gltf.scene.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = height / Math.max(size.y, 1e-3);
  model.scale.setScalar(s);
  model.position.set(
    -((box.min.x + box.max.x) / 2) * s,
    -box.min.y * s,
    -((box.min.z + box.max.z) / 2) * s,
  );
  g.add(model);
  return g;
}

/** Additive glowing material for the sigil / rug / flame tint. Not shared: each
 * floor build owns its instances and disposes them with the group. */
function glowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

/** A five-pointed star ringed by two circles, drawn flat on the floor: the sigil
 * the miniboss stands on. Procedural because a generated MESH of a flat sigil
 * reads as a lumpy disc; a line-strip on the floor reads as a drawn ritual mark. */
function buildPentagram(radius: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false });
  const ringPts = (r: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    return pts;
  };
  for (const r of [radius, radius * 0.86]) {
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts(r)), mat));
  }
  // The star: connect every second vertex of a regular pentagon.
  const star: THREE.Vector3[] = [];
  const vr = radius * 0.86;
  for (let i = 0; i <= 5; i++) {
    const a = (((i * 2) % 5) / 5) * Math.PI * 2 - Math.PI / 2;
    star.push(new THREE.Vector3(Math.cos(a) * vr, 0, Math.sin(a) * vr));
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(star), mat));
  // A dim disc so the sigil reads as scorched ground, not floating lines.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2),
    glowMaterial(color, 0.1),
  );
  disc.renderOrder = 1;
  g.add(disc);
  g.position.y = 0.03; // hair above the floor tiles: no z-fighting
  return g;
}

/** A dark red processional rug down a hall's spine. */
function buildRug(color: number): THREE.Mesh {
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 26).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  rug.position.y = 0.02;
  rug.renderOrder = 1;
  return rug;
}

/** A small licking flame to crown a brazier / ring the pentagram. */
function buildFlame(height: number, color: number): THREE.Object3D | null {
  const gltf = cache.get(FLAME_URL);
  if (!gltf) return null;
  const g = fitted(gltf, height);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = glowMaterial(color, 0.85);
  });
  // Tagged so the renderer's per-frame flicker pass animates it like the pylon flames.
  g.userData.riftFlame = true;
  return g;
}

/** Build every decor piece of an authored floor into `group` (instance-local
 * coordinates; the caller positions the group at the instance origin). `glow` adds
 * the interior's additive torch decal, so brazier light matches the room's torches.
 *
 * Call `ensureInfernalDecorAssets()` first; entries whose model is missing are
 * skipped rather than throwing. */
export function buildInfernalDecor(
  group: THREE.Group,
  decor: readonly AuthoredDecor[],
  torch: { flame: number; light: number },
  glow: (x: number, z: number, color: number, y?: number, scale?: number) => void,
  liftAt?: (x: number, z: number) => number,
): void {
  for (const d of decor) {
    const y0 = liftAt?.(d.x, d.z) ?? 0;
    if (d.key === 'pentagram') {
      const sigil = buildPentagram(d.scale ?? 6, torch.flame);
      sigil.position.set(d.x, y0 + 0.03, d.z); // keep the anti-z-fight hair

      group.add(sigil);
      // Five candle flames on the star's points.
      const vr = (d.scale ?? 6) * 0.86;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const fx = d.x + Math.cos(a) * vr;
        const fz = d.z + Math.sin(a) * vr;
        const flame = buildFlame(0.9, torch.flame);
        if (flame) {
          flame.position.set(fx, y0, fz);
          group.add(flame);
        }
        glow(fx, fz, torch.light, y0 + 0.5, 0.7);
      }
      glow(d.x, d.z, torch.light, y0 + 0.06, 3.2);
      continue;
    }
    if (d.key === 'rug') {
      const rug = buildRug(0x4a1015);
      rug.position.set(d.x, rug.position.y + y0, d.z);
      rug.rotation.y = d.yaw;
      group.add(rug);
      continue;
    }
    const def = DECOR_MODELS[d.key];
    const gltf = def ? cache.get(def.url) : null;
    if (!def || !gltf) continue;
    const model = fitted(gltf, def.height * (d.scale ?? 1));
    model.position.set(d.x, y0, d.z);
    model.rotation.y = d.yaw;
    group.add(model);

    if (d.key === 'infernal_brazier') {
      // Embers in the bowl (the bowl rim sits at ~0.75 of the model's height).
      const flame = buildFlame(0.7, torch.flame);
      if (flame) {
        flame.position.set(d.x, y0 + def.height * 0.75, d.z);
        group.add(flame);
      }
      glow(d.x, d.z, torch.light, y0 + def.height * 0.8, 1.2);
    } else if (d.key === 'hell_forge') {
      glow(d.x, d.z, torch.light, y0 + 1.0, 2.0); // the maw glows from inside
    } else if (d.key === 'slag_cauldron') {
      glow(d.x, d.z, torch.light, y0 + def.height * 0.85, 1.4); // the molten surface
    } else if (d.key === 'obsidian_fang') {
      glow(d.x, d.z, torch.light, y0 + 0.2, 0.6); // lava veins
    }
  }
}
