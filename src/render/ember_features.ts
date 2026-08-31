// The Drakelands' volcanic dressing, all render-only: the maintainer's
// modeled lava set (pools in the shaped basins plus a flat-land network of
// pools and connecting rivers, and terraces cascading the volcano flanks),
// dragon-den hoards and egg clutches, giant ember-lily trees, ember
// crystal clusters, and the Bloodglass Fields' red crystal spurs. Same
// contract as realm_flora: build once, update(time) animates, lights join
// the renderer's rank-culled fireLights budget.
import * as THREE from 'three';
import { CASTLE_CRYSTALS } from '../sim/castle_layout';
import {
  EMBER_FLAT_POOLS,
  EMBER_LAVA_LINKS,
  EMBER_LAVA_POOLS,
  emberLinkPolyline,
} from '../sim/ember_lava_layout';
import { EMBER_DENS, emberLilySpots, emberScatterClear } from '../sim/ember_lilies';
import { hash2 } from '../sim/rng';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { buildForgefatherFortress } from './forgefather_fortress';
import { GFX } from './gfx';
import { lavaChainPlacements } from './lava_chain_core';

// the Drakelands prop models (built by build_drakelands_props.mjs)
const EMBER_PROP_URLS = {
  // the lava vocabulary is exactly three pieces: a pool, the river middle
  // that connects, and the river end that terminates a spill
  pool: '/models/props/lava_pool.glb',
  riverMid: '/models/props/lava_river_mid.glb',
  riverEnd: '/models/props/lava_river_end.glb',
  hoard: '/models/props/dragon_hoard.glb',
  eggs: '/models/props/dragon_eggs.glb',
  lily: '/models/props/ember_lily.glb',
} as const;
type EmberPropKey = keyof typeof EMBER_PROP_URLS;
const propScenes: Partial<Record<EmberPropKey, THREE.Group>> = {};
for (const key of Object.keys(EMBER_PROP_URLS) as EmberPropKey[]) {
  registerDeferredPreload(() =>
    loadGltf(EMBER_PROP_URLS[key]).then((gltf) => {
      propScenes[key] = gltf.scene;
    }),
  );
}

interface PropPlacement {
  x: number;
  y: number;
  z: number;
  /** target footprint in world units (the model is normalized per part set) */
  fp: number;
  rot: number;
}

// Meshopt-quantized attributes are normalized ints; bake them to plain
// floats BEFORE applying a world matrix, or setXYZ clamps every vertex
// back into the normalized [-1, 1] domain (the castle_features guard).
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

// bake a loaded scene into parts + its native footprint (xz-centered,
// min-y at 0: the fen_features idiom, plus the measured box for scaling)
function extractParts(scene: THREE.Group): {
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[];
  foot: number;
} {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone();
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push({ geo, mat: mesh.material as THREE.Material });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  return { parts, foot: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) };
}

export interface EmberFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number): void;
}

// The Bloodglass Fields: shard clusters seeded around the POI.
// The Bloodglass Fields POI (content/drakelands.ts). This used to read
// (-90, 1890), which is 270 units west of the realm's own xMin, so the
// shard field drew on empty ground nobody visits and the actual POI was
// bare. Same class of bug as the bone fields below.
const BLOODGLASS = { x: 270, z: 2270, r: 42 };
const BLOODGLASS_TINTS = [0xd83a2c, 0xb82838, 0xe85838];
/** a shard stands this far off a dragon den (the shared scatter ring is 13) */
const BLOODGLASS_DEN_CLEAR = 24;

function shardGeo(): THREE.BufferGeometry {
  // a stretched octahedron reads as a glassy spur in the flat-shaded style
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(0.38, 1.7, 0.38);
  return geo.toNonIndexed();
}

export function buildEmberFeatures(seed: number): EmberFeaturesView {
  const group = new THREE.Group();
  group.name = 'ember-features';
  const glowLights: THREE.PointLight[] = [];

  // one instanced draw per (model part, placement list); every model is
  // normalized to its measured footprint so `fp` is real world units
  const instanceProp = (key: EmberPropKey, spots: PropPlacement[]): void => {
    const scene = propScenes[key];
    if (!scene || spots.length === 0) return;
    const { parts, foot } = extractParts(scene);
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots.forEach((sp, i) => {
        const sf = sp.fp / foot;
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sf, sf, sf);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  };

  // --- the lava: the modeled pool filling every shaped basin and crater,
  // and the flat-land pool-and-river network out on the waste. The network
  // geometry (pools, tree links, meander curves) is the shared layout leaf
  // src/sim/ember_lava_layout.ts; the terrain grades a flush bed under the
  // SAME curves (world.ts applyEmberLavaNetwork), so nothing here floats
  // and nothing sinks. One river per pool pair; a crater keeps exactly one
  // pool sized to its pit and nothing else. ---
  {
    const T = (x: number, z: number): number => terrainHeight(x, z, seed);
    // crater pits: one pool each, fitted to the pit rather than the melt
    // record's own r (the Drakemaw's eye nests inside its escape bench)
    const CRATER_FIT: Record<string, number> = {
      '390,2320': 19, // the Drakemaw vent, up to the wade-out ramp
      '270,2282': 14.5, // the west cone's pit
      '487,2356': 12.5, // the east cone's pit
    };
    const poolSpots: PropPlacement[] = EMBER_LAVA_POOLS.map((pool) => ({
      x: pool.x,
      z: pool.z,
      y: pool.floor + 0.4,
      fp: CRATER_FIT[`${pool.x},${pool.z}`] ?? pool.r * 2.15,
      rot: hash2(pool.x, pool.z, seed + 801) * Math.PI * 2,
    }));
    // the flat-land network pools, resting on their graded level pads
    for (const pool of EMBER_FLAT_POOLS) {
      poolSpots.push({
        x: pool.x,
        z: pool.z,
        y: pool.h + 0.15,
        fp: pool.r * 2,
        rot: hash2(pool.x, pool.z, seed + 802) * Math.PI * 2,
      });
    }
    instanceProp('pool', poolSpots);
    // Each link renders as ONE model tiled along the SHARED meander
    // polyline the terrain bed follows, plus an end cap wherever the run
    // spends itself on open ground. lava_chain_core owns the arithmetic:
    // pieces are scaled by their CROSS extent so the channel holds one
    // width, and seated by their MELT surface so it holds one height.
    const midSegs: PropPlacement[] = [];
    const endSegs: PropPlacement[] = [];
    for (const link of EMBER_LAVA_LINKS) {
      for (const pc of lavaChainPlacements(link, { m0: link.m0, m1: link.m1 }, T)) {
        (pc.kind === 'mid' ? midSegs : endSegs).push({
          x: pc.x,
          z: pc.z,
          y: pc.y,
          fp: pc.fp,
          rot: pc.rot,
        });
      }
    }
    instanceProp('riverMid', midSegs);
    instanceProp('riverEnd', endSegs);
    for (const pool of EMBER_LAVA_POOLS) {
      const light = new THREE.PointLight(0xff5a18, 8, pool.r * 3.4, 2);
      light.position.set(pool.x, pool.floor + 2.6, pool.z);
      light.userData.baseIntensity = 8;
      glowLights.push(light);
      group.add(light);
    }
    for (const pool of EMBER_FLAT_POOLS) {
      const light = new THREE.PointLight(0xff5a18, 6, pool.r * 3.4, 2);
      light.position.set(pool.x, pool.h + 2.2, pool.z);
      light.userData.baseIntensity = 6;
      glowLights.push(light);
      group.add(light);
    }
  }

  // --- the dragon dens: the drakes' treasure and their clutches. Each
  // piece sits on the LOWEST of five terrain probes across its own
  // footprint (the ember_lilies flat-bed rule) so no rim of a big mound
  // hangs in air on the den's gentle slope. ---
  const denSeatY = (x: number, z: number, fp: number): number => {
    const pr = fp * 0.32;
    let lo = terrainHeight(x, z, seed);
    for (const [ox, oz] of [
      [pr, 0],
      [-pr, 0],
      [0, pr],
      [0, -pr],
    ] as const) {
      lo = Math.min(lo, terrainHeight(x + ox, z + oz, seed));
    }
    return lo;
  };
  // The hoard is DOUBLE its old size: footprint area goes as fp squared, so
  // fp 7 to 9.9 is exactly 2x the ground the gold covers (49 to 98.01), and
  // the mound grows 7.0 by 6.6 by 2.5 to 9.9 by 9.3 by 3.5. Den B roosted
  // over an empty patch with only a clutch to its name, so it gets a hoard
  // of its own on the flattest shelf inside its ring.
  const HOARDS = [
    { x: 417, z: 2262, fp: 9.9, rot: 1.2 },
    { x: 307, z: 2259, fp: 5.5, rot: -0.7 },
  ];
  instanceProp(
    'hoard',
    HOARDS.map((h) => ({
      x: h.x,
      z: h.z,
      y: denSeatY(h.x, h.z, h.fp) - 0.1,
      fp: h.fp,
      rot: h.rot,
    })),
  );
  instanceProp('eggs', [
    { x: 423, z: 2268, y: denSeatY(423, 2268, 4.5) - 0.05, fp: 4.5, rot: 0.4 },
    { x: 299, z: 2256, y: denSeatY(299, 2256, 4.5) - 0.05, fp: 4.5, rot: 2.6 },
  ]);
  // gold catches the light: a warm point over each hoard so a den reads as
  // occupied from the approach and stays legible at night
  for (const h of HOARDS) {
    const light = new THREE.PointLight(0xffb038, h.fp > 7 ? 5 : 4, h.fp * 2.6, 2);
    light.position.set(h.x, denSeatY(h.x, h.z, h.fp) + 2.2, h.z);
    light.userData.baseIntensity = h.fp > 7 ? 5 : 4;
    glowLights.push(light);
    group.add(light);
  }

  // --- the ember lilies (giant crystal-flower trees) and small ember
  // crystal clusters. Lily grove placements come from the SHARED sim leaf
  // (sim/ember_lilies.ts): the render draws exactly the list the collider
  // builder blocks, and every stem passed the leaf's strict flat-ground
  // gates (a bed on sloped dirt reads as floating). The bed rests at the
  // LOWEST touched terrain point (spot.y), never a mid-slope average. ---
  {
    const lilySpots: PropPlacement[] = emberLilySpots(seed).map((lily) => ({
      x: lily.x,
      z: lily.z,
      y: lily.y - 0.1,
      fp: lily.fp,
      rot: lily.rot,
    }));
    const crystalSpots: PropPlacement[] = [];
    for (let gx = 200; gx <= 530; gx += 12) {
      for (let gz = 1830; gz <= 2405; gz += 12) {
        const r = hash2(gx, gz, seed + 811);
        if (r > 0.2 || r < 0.055) continue; // the grove band belongs to the leaf
        const x = gx + (hash2(gx + 1, gz, seed + 821) - 0.5) * 9;
        const z = gz + (hash2(gx, gz + 1, seed + 831) - 0.5) * 9;
        const y = terrainHeight(x, z, seed);
        if (y < 1) continue;
        if (!emberScatterClear(x, z)) continue;
        crystalSpots.push({
          x,
          z,
          y: y - 0.1,
          rot: hash2(z, x, seed + 841) * Math.PI * 2,
          fp: 1.8 + hash2(x, z, seed + 861) * 1.6,
        });
      }
    }
    // ember crystals of varying sizes around the Last Keep: the castle plan
    // authors these directly (they sit INSIDE the grounds the wild scatter
    // clears), seated on the graded pad
    for (const c of CASTLE_CRYSTALS) {
      crystalSpots.push({
        x: c.x,
        z: c.z,
        y: terrainHeight(c.x, c.z, seed) - 0.1,
        fp: c.fp,
        rot: hash2(c.x, c.z, seed + 843) * Math.PI * 2,
      });
    }
    // a dense crystal garden on the Bloodglass Fields
    for (let k = 0; k < 14; k++) {
      const ang = hash2(k, 3, seed + 871) * Math.PI * 2;
      const dist = Math.sqrt(hash2(k, 5, seed + 881)) * 26;
      const x = 270 + Math.sin(ang) * dist;
      const z = 2270 + Math.cos(ang) * dist;
      const y = terrainHeight(x, z, seed);
      if (y < 1 || !emberScatterClear(x, z)) continue;
      crystalSpots.push({
        x,
        z,
        y: y - 0.1,
        fp: 2.2 + hash2(k, 7, seed + 891) * 1.8,
        rot: hash2(k, 11, seed + 895) * Math.PI * 2,
      });
    }
    instanceProp('lily', lilySpots);
    instanceProp('lily', crystalSpots);
  }

  // --- bloodglass shards: instanced clusters with a dim inner glow ---
  const spots: { x: number; z: number; y: number; s: number; rot: number; tint: number }[] = [];
  for (let k = 0; k < 46; k++) {
    const ang = hash2(k, 11, seed + 901) * Math.PI * 2;
    const dist = Math.sqrt(hash2(k, 23, seed + 911)) * BLOODGLASS.r;
    const x = BLOODGLASS.x + Math.sin(ang) * dist;
    const z = BLOODGLASS.z + Math.cos(ang) * dist;
    const y = terrainHeight(x, z, seed);
    if (y < 0) continue;
    // The shard scatter never consulted the wild-scatter clearance, which
    // did not show while the field sat outside the realm. On its real POI
    // the 42yd radius reaches a dragon den, and red glass spurs growing
    // through a drake's hoard is not the read: honour the same exclusion
    // rings (pools, vents, roads, the keep) every other Drakelands scatter
    // respects, and stand further off a den than the shared 13yd ring,
    // because a shard is a tall spur and the Bloodglass POI happens to sit
    // only 34yd from the west den.
    if (!emberScatterClear(x, z)) continue;
    if (EMBER_DENS.some((d) => Math.hypot(x - d.x, z - d.z) < BLOODGLASS_DEN_CLEAR)) continue;
    spots.push({
      x,
      z,
      y,
      s: 0.7 + hash2(k, 37, seed + 921) * 2.4,
      rot: hash2(k, 41, seed + 931) * Math.PI * 2,
      tint: BLOODGLASS_TINTS[Math.floor(hash2(k, 53, seed + 941) * BLOODGLASS_TINTS.length)],
    });
  }
  if (spots.length > 0) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb03028,
      emissive: 0x8a1410,
      emissiveIntensity: GFX.composer ? 0.5 : 0.35,
      roughness: 0.35,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(shardGeo(), mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const tiltAxis = new THREE.Vector3();
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      tiltAxis.set(Math.sin(sp.rot * 3.1), 0, Math.cos(sp.rot * 3.1)).normalize();
      qTilt.setFromAxisAngle(tiltAxis, (hash2(i, 61, seed + 951) - 0.5) * 0.7);
      q.premultiply(qTilt);
      v.set(sp.x, sp.y + sp.s * 0.55, sp.z);
      sc.set(sp.s, sp.s, sp.s);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
      mesh.setColorAt(i, new THREE.Color(sp.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    const fieldLight = new THREE.PointLight(0xc82818, 5, 30, 2);
    fieldLight.position.set(
      BLOODGLASS.x,
      terrainHeight(BLOODGLASS.x, BLOODGLASS.z, seed) + 3,
      BLOODGLASS.z,
    );
    fieldLight.userData.baseIntensity = 5;
    glowLights.push(fieldLight);
    group.add(fieldLight);
  }

  // --- bone fields: ivory remains scattered near the graveyards and the
  // open waste (procedural skulls and rib shards, instanced) ---
  {
    const boneGeo = new THREE.IcosahedronGeometry(0.42, 0);
    boneGeo.scale(1, 0.72, 0.85);
    const ribGeo = new THREE.TorusGeometry(0.55, 0.07, 5, 8, Math.PI);
    const merged: { g: THREE.BufferGeometry; skull: boolean }[] = [
      { g: boneGeo.toNonIndexed(), skull: true },
      { g: ribGeo.toNonIndexed(), skull: false },
    ];
    // The realm's own graveyards (content/drakelands.ts DRAKELANDS_PROPS)
    // plus a field of picked-clean bones at each dragon den. These read
    // (-6,1712) / (-60,1796) / (92,1732) / (10,1860) before, every one of
    // them west of the realm's xMin 180, so the whole bone scatter drew
    // outside the Drakelands and the graveyards themselves had none.
    const FIELDS = [
      { x: 354, z: 2092, r: 22 },
      { x: 300, z: 2176, r: 24 },
      { x: 452, z: 2112, r: 20 },
      { x: 419, z: 2266, r: 9 },
      { x: 302, z: 2258, r: 9 },
    ];
    for (const part of merged) {
      const spots2: { x: number; z: number; y: number; s: number; rot: number }[] = [];
      FIELDS.forEach((f, fi) => {
        for (let k = 0; k < 9; k++) {
          const ang = hash2(k + fi * 31, 7, seed + 971) * Math.PI * 2;
          const dist = Math.sqrt(hash2(k, fi + 13, seed + 981)) * f.r;
          const x = f.x + Math.sin(ang) * dist;
          const z = f.z + Math.cos(ang) * dist;
          const y = terrainHeight(x, z, seed);
          if (y < 0) continue;
          spots2.push({
            x,
            z,
            y: y + 0.1,
            s: 0.7 + hash2(k, fi, seed + 991) * 1.1,
            rot: hash2(fi, k, seed + 995) * Math.PI * 2,
          });
        }
      });
      if (spots2.length === 0) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: part.skull ? 0xe8e0d0 : 0xdcd2be,
        roughness: 0.9,
        flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(part.g, mat, spots2.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots2.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  // The Forgefather's Isle fortress rides this view: same zone, same
  // gated attach and shadow policy (forgefather_fortress.ts carries why).
  group.add(buildForgefatherFortress());

  return {
    group,
    glowLights,
    update(): void {
      // the modeled melt holds its pose; the glow lights carry the life
    },
  };
}
