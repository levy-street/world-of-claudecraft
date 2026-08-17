// The Ashen Bulwark's render assembly (render-only): the Drakelands walled
// barracks on the west headland, dressed in the same fortification idiom as
// the Last Keep and Dawnhold. The walls the player climbs are bulwarkLift
// terrain (sim/bulwark_layout.ts) and lift terrain draws nothing itself, so
// every mass is built here: double-skinned kcas module rows over the wall
// lines, open doorway arches whose openings the gate lift spans sit inside,
// battlements outside and guard rails inside, walk caps, tower shells with
// solid cores, the two stair flights and the Sea Watch climb as solid wedge
// piers, red banners, and torchlight at both gates. The yard buildings ride
// the ordinary decorProps path (content/drakelands.ts).
import * as THREE from 'three';
import { BULWARK, BULWARK_GATES, BULWARK_RAMPS, BULWARK_TOWERS } from '../sim/bulwark_layout';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { bannerClothMaterial, extractKitParts, isBannerKey, type KitPlacement } from './castle_kit';
import {
  castlePavingMat,
  castleStoneBox,
  castleStoneMat,
  FLAGSTONE_TILE_YD,
  tileCastleUv,
} from './castle_stone';
import { PROP_ASSET_DEFS } from './props';

const BULWARK_KEYS = [
  'kcasWall',
  'kcasWallDoorway',
  'kcasWallWindow',
  'kcasBarrier',
  'kcasBarrierHalf',
  'kcasBannerRedA',
  'kcasBannerRedShield',
  'kcasBannerRedTriple',
  'kcasTorch',
  'kcasTorchMounted',
  'kcasFloorLarge',
] as const;
type BulwarkKey = (typeof BULWARK_KEYS)[number];

const scenes: Partial<Record<BulwarkKey, THREE.Group>> = {};
for (const key of BULWARK_KEYS) {
  registerDeferredPreload(() =>
    loadGltf(PROP_ASSET_DEFS[key].url).then((gltf) => {
      scenes[key] = gltf.scene;
    }),
  );
}

export const bulwarkFeaturesPreloadInternalsForTest = {
  propUrls: BULWARK_KEYS.map((k) => PROP_ASSET_DEFS[k].url),
};

/** wall module scale (the KayKit wall is 4 units long; module is 7) */
const S = BULWARK.module / 4;

// the doorway module's door leaf stays out so gates render open (the
// castle_features rule; lift spans match the arch openings)
const SKIP_PARTS: Partial<Record<BulwarkKey, RegExp>> = {
  kcasWallDoorway: /_door$/i,
};

export interface BulwarkFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
}

export function buildBulwarkFeatures(): BulwarkFeaturesView {
  const group = new THREE.Group();
  group.name = 'bulwark-features';
  const glowLights: THREE.PointLight[] = [];
  const padY = BULWARK.pad.h;
  const walkY = BULWARK.walkAbs;

  const spots = new Map<BulwarkKey, KitPlacement[]>();
  const put = (key: BulwarkKey, p: KitPlacement): void => {
    let list = spots.get(key);
    if (!list) {
      list = [];
      spots.set(key, list);
    }
    list.push(p);
  };

  const capMat = castleStoneMat({ color: 0x94876f, roughness: 0.9 });
  const coreMat = castleStoneMat({ color: 0x857766 });
  const slab = (
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    topY: number,
    thick = 0.36,
    mat?: THREE.Material,
  ): void => {
    const mesh = new THREE.Mesh(castleStoneBox(sx, thick, sz), mat ?? capMat);
    mesh.position.set(cx, topY - thick / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // ---- curtain walls: double-skinned module rows, grid-anchored, gates as
  // open doorway modules. The tower half-width is half a module, so every
  // run divides with zero slack (bulwark_layout's grid promise). ----
  interface WallRun {
    axis: 'x' | 'z';
    line: number;
    a0: number;
    a1: number;
    gate: { a0: number; a1: number } | null;
    outerSide: -1 | 1;
    /** span of the walk-top furniture (rails, battlements, cap): the north
     *  walk's west reach is the Sea Watch climb and gets the wedge instead */
    top?: [number, number];
  }
  const hw = BULWARK.towerHw;
  const watchClimbEnd = 230; // BULWARK_RAMPS watch flight foot (x, on wz0)
  const runs: WallRun[] = [
    {
      axis: 'z',
      line: BULWARK.wx0,
      a0: BULWARK.wz0 + hw,
      a1: BULWARK.wz1 - hw,
      gate: BULWARK_GATES.postern,
      outerSide: -1,
    },
    {
      axis: 'z',
      line: BULWARK.wx1,
      a0: BULWARK.wz0 + hw,
      a1: BULWARK.wz1 - hw,
      gate: BULWARK_GATES.muster,
      outerSide: 1,
    },
    {
      axis: 'x',
      line: BULWARK.wz0,
      a0: BULWARK.wx0 + hw,
      a1: BULWARK.wx1 - hw,
      gate: null,
      outerSide: -1,
      top: [watchClimbEnd, BULWARK.wx1 - hw],
    },
    {
      axis: 'x',
      line: BULWARK.wz1,
      a0: BULWARK.wx0 + hw,
      a1: BULWARK.wx1 - hw,
      gate: null,
      outerSide: 1,
    },
  ];
  const M = BULWARK.module;
  const skinOff = BULWARK.wallTh / 2 - 0.85;
  const place = (run: WallRun, along: number, key: BulwarkKey, s = S): void => {
    for (const face of [-1, 1] as const) {
      const x = run.axis === 'z' ? run.line + face * skinOff : along;
      const z = run.axis === 'z' ? along : run.line + face * skinOff;
      put(key, { x, y: padY, z, rot: run.axis === 'z' ? Math.PI / 2 : 0, s });
    }
  };
  for (const run of runs) {
    const count = Math.round((run.a1 - run.a0) / M);
    for (let k = 0; k < count; k++) {
      const c = run.a0 + M / 2 + k * M;
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) {
        place(run, c, 'kcasWallDoorway');
        continue;
      }
      const v = Math.abs(Math.round(c * 7 + run.line)) % 9;
      place(run, c, v === 2 ? 'kcasWallWindow' : 'kcasWall');
    }
    const [t0, t1] = run.top ?? [run.a0, run.a1];
    // battlements outside, guard rail inside, both parted over gates
    const off = BULWARK.wallTh / 2 - 0.2;
    const bat = 0.4;
    for (let c = t0 + 0.8; c <= t1 - 0.8; c += 4 * bat) {
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) continue;
      const x = run.axis === 'z' ? run.line + run.outerSide * off : c;
      const z = run.axis === 'z' ? c : run.line + run.outerSide * off;
      put('kcasWall', { x, y: walkY - 0.04, z, rot: run.axis === 'z' ? Math.PI / 2 : 0, s: bat });
    }
    for (let c = t0 + 1; c <= t1 - 1; c += 2 * S) {
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) continue;
      const x = run.axis === 'z' ? run.line - run.outerSide * off : c;
      const z = run.axis === 'z' ? c : run.line - run.outerSide * off;
      put('kcasBarrierHalf', { x, y: walkY, z, rot: run.axis === 'z' ? Math.PI / 2 : 0 });
    }
    // the visible walk floor, parted at gates
    const segs: [number, number][] = run.gate
      ? [
          [t0, run.gate.a0],
          [run.gate.a1, t1],
        ]
      : [[t0, t1]];
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 1) continue;
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      if (run.axis === 'z') slab(run.line, mid, BULWARK.wallTh + 0.2, len, walkY - 0.02);
      else slab(mid, run.line, len, BULWARK.wallTh + 0.2, walkY - 0.02);
    }
  }

  // ---- towers: shells, solid cores, caps; the Sea Watch gets a windowed
  // storey, the red triple banner, and a beacon torch ----
  for (const t of BULWARK_TOWERS) {
    const thw = t.hw;
    const faces = [
      { x: t.x, z: t.z - thw, rot: 0 },
      { x: t.x, z: t.z + thw, rot: 0 },
      { x: t.x - thw, z: t.z, rot: Math.PI / 2 },
      { x: t.x + thw, z: t.z, rot: Math.PI / 2 },
    ];
    const shellScale = (thw * 2) / 4;
    for (const f of faces) put('kcasWall', { x: f.x, y: padY, z: f.z, rot: f.rot, s: shellScale });
    const core = new THREE.Mesh(
      castleStoneBox(thw * 2 - 0.4, t.hAbs - padY, thw * 2 - 0.4),
      coreMat,
    );
    core.position.set(t.x, padY + (t.hAbs - padY) / 2, t.z);
    core.castShadow = true;
    core.receiveShadow = true;
    group.add(core);
    slab(t.x, t.z, thw * 2 + 0.5, thw * 2 + 0.5, t.hAbs - 0.02);
    if (t.tall) {
      const storeyY = padY + 4 * shellScale - 0.1;
      const ws = Math.max(0.6, (t.hAbs - storeyY + 0.08) / 4);
      put('kcasWallWindow', { x: t.x, y: storeyY, z: t.z - thw, rot: 0, s: ws });
      put('kcasWallWindow', { x: t.x, y: storeyY, z: t.z + thw, rot: 0, s: ws });
      put('kcasWallWindow', { x: t.x + thw, y: storeyY, z: t.z, rot: Math.PI / 2, s: ws });
      put('kcasWallWindow', { x: t.x - thw, y: storeyY, z: t.z, rot: Math.PI / 2, s: ws });
      put('kcasBannerRedTriple', {
        x: t.x - thw + 0.4,
        y: t.hAbs + 0.1,
        z: t.z,
        rot: Math.PI / 2,
        s: 1.4,
      });
      put('kcasTorch', { x: t.x, y: t.hAbs, z: t.z, rot: 0, s: 1.5 });
    } else {
      for (const f of faces) {
        put('kcasBarrier', { x: f.x, y: t.hAbs, z: f.z, rot: f.rot, s: shellScale });
      }
      put('kcasBannerRedShield', { x: t.x, y: t.hAbs, z: t.z, rot: Math.PI / 4, s: 1.4 });
    }
  }

  // ---- gate dressing: red banners flanking the muster arch on the isthmus
  // approach, torchlight at both doors ----
  const gm = (BULWARK_GATES.muster.a0 + BULWARK_GATES.muster.a1) / 2;
  for (const side of [-1, 1] as const) {
    put('kcasBannerRedA', {
      x: BULWARK.wx1 + 1.5,
      y: padY + 2.8,
      z: gm + side * (M / 2 + 1.5),
      rot: Math.PI / 2,
      s: 1.5,
    });
    put('kcasTorchMounted', {
      x: BULWARK.wx1 + 1.3,
      y: padY + 2.2,
      z: gm + side * 4.4,
      rot: -Math.PI / 2,
      s: 1.4,
    });
  }
  const musterLight = new THREE.PointLight(0xffc27a, 4.5, 16, 2);
  musterLight.position.set(BULWARK.wx1 + 1, padY + 3.2, gm);
  musterLight.userData.baseIntensity = 4.5;
  glowLights.push(musterLight);
  group.add(musterLight);
  const pm = (BULWARK_GATES.postern.a0 + BULWARK_GATES.postern.a1) / 2;
  put('kcasTorchMounted', {
    x: BULWARK.wx0 - 1.3,
    y: padY + 2.2,
    z: pm + 2.2,
    rot: Math.PI / 2,
    s: 1.4,
  });
  const posternLight = new THREE.PointLight(0xffc27a, 3.5, 12, 2);
  posternLight.position.set(BULWARK.wx0 - 1, padY + 2.8, pm);
  posternLight.userData.baseIntensity = 3.5;
  glowLights.push(posternLight);
  group.add(posternLight);

  // ---- the stair flights and the Sea Watch climb: solid wedge piers (lift
  // terrain is invisible; the masses must be built) ----
  const wedgeMat = castleStoneMat({ color: 0x857766, side: THREE.DoubleSide });
  for (const rmp of BULWARK_RAMPS) {
    const baseY = padY - 0.4;
    const pxz = (a: number, b: number): [number, number] => (rmp.axis === 'x' ? [a, b] : [b, a]);
    const verts: number[] = [];
    const c = (a: number, b: number, y: number): [number, number, number] => {
      const [x, z] = pxz(a, b);
      return [x, y, z];
    };
    const quad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
    ): void => {
      verts.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    };
    const { a0, a1, b0, b1, h0, h1 } = rmp;
    quad(c(a0, b0, h0), c(a1, b0, h1), c(a1, b1, h1), c(a0, b1, h0));
    quad(c(a0, b0, baseY), c(a1, b0, baseY), c(a1, b0, h1), c(a0, b0, h0));
    quad(c(a0, b1, h0), c(a1, b1, h1), c(a1, b1, baseY), c(a0, b1, baseY));
    quad(c(a0, b0, h0), c(a0, b1, h0), c(a0, b1, baseY), c(a0, b0, baseY));
    quad(c(a1, b0, baseY), c(a1, b1, baseY), c(a1, b1, h1), c(a1, b0, h1));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, wedgeMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- the drill yard: paved wall to wall (a garrison parade ground, the
  // Dawnhold court idiom), with a dressed threshold inside the muster gate ----
  {
    const fx0 = BULWARK.wx0 + BULWARK.wallTh / 2;
    const fx1 = BULWARK.wx1 - BULWARK.wallTh / 2;
    const fz0 = BULWARK.wz0 + BULWARK.wallTh / 2;
    const fz1 = BULWARK.wz1 - BULWARK.wallTh / 2;
    const fw = fx1 - fx0;
    const fd = fz1 - fz0;
    const floorGeo = new THREE.PlaneGeometry(fw, fd);
    tileCastleUv(floorGeo, fw, fd, FLAGSTONE_TILE_YD);
    const floor = new THREE.Mesh(floorGeo, castlePavingMat({ color: 0xb0a89c }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((fx0 + fx1) / 2, padY + 0.03, (fz0 + fz1) / 2);
    floor.receiveShadow = true;
    group.add(floor);
    put('kcasFloorLarge', { x: fx1 - M / 2, y: padY + 0.06, z: gm, rot: 0 });
  }

  // ---- instance assembly (castle_kit extraction; banner cloth reads from
  // both sides of the wall) ----
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const [key, list] of spots) {
    const scene = scenes[key];
    if (!scene || list.length === 0) continue;
    for (const part of extractKitParts(scene, SKIP_PARTS[key])) {
      const mat = isBannerKey(key) ? bannerClothMaterial(part.mat) : part.mat;
      const mesh = new THREE.InstancedMesh(part.geo, mat, list.length);
      list.forEach((p, i) => {
        const s = p.s ?? S;
        q.setFromAxisAngle(up, p.rot);
        v.set(p.x, p.y, p.z);
        sc.set(s, s, s);
        mesh.setMatrixAt(i, m4.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return { group, glowLights };
}
