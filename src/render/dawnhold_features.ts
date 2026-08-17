// Dawnhold Castle's render assembly (render-only): the same fortification
// idiom as the Last Keep's castle_features, dressed for the Evergarden:
// stone kcas walls under GREEN banners, green-roofed bailey buildings on
// the decorProps path, a tiled path from the gate to the keep door, and
// benches around the courtyard parterres. The walls the player climbs are
// dawnholdLift terrain (sim/dawnhold_layout.ts); every walkable lift
// surface gets a visible floor cap, every gate renders as an OPEN doorway
// arch whose opening the lift span sits inside, and tower shells get
// solid cores (lift terrain is invisible, the masses must be built).
import * as THREE from 'three';
import {
  DAWNHOLD,
  DAWNHOLD_BEDS,
  DAWNHOLD_COURT,
  DAWNHOLD_COURT_GATE,
  DAWNHOLD_COURT_STATUE,
  DAWNHOLD_GATES,
  DAWNHOLD_RAMPS,
  DAWNHOLD_TOWERS,
  DAWNHOLD_WALL_LEDGES,
} from '../sim/dawnhold_layout';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { bannerClothMaterial, isBannerKey } from './castle_kit';
import {
  castlePavingMat,
  castleStoneBox,
  castleStoneMat,
  FLAGSTONE_TILE_YD,
  tileCastleUv,
} from './castle_stone';
import { PROP_ASSET_DEFS } from './props';

const DAWNHOLD_KEYS = [
  'kcasWall',
  'kcasWallHalf',
  'kcasWallDoorway',
  'kcasWallWindow',
  'kcasWallPillar',
  'kcasBarrier',
  'kcasBarrierHalf',
  'kcasBannerGreenA',
  'kcasBannerGreenShield',
  'kcasBannerGreenTriple',
  'kcasTorch',
  'kcasTorchMounted',
  'kcasFloorLarge',
  'kcasFoundation',
  'kcasBench',
] as const;
type DawnholdKey = (typeof DAWNHOLD_KEYS)[number];

const scenes: Partial<Record<DawnholdKey, THREE.Group>> = {};
for (const key of DAWNHOLD_KEYS) {
  registerDeferredPreload(() =>
    loadGltf(PROP_ASSET_DEFS[key].url).then((gltf) => {
      scenes[key] = gltf.scene;
    }),
  );
}

export const dawnholdFeaturesPreloadInternalsForTest = {
  propUrls: DAWNHOLD_KEYS.map((k) => PROP_ASSET_DEFS[k].url),
};

/** wall module scale (the KayKit wall is 4 units long; module is 7) */
const S = DAWNHOLD.module / 4;

interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  s?: number;
}

// the doorway module's door leaf stays out so gates render open (the
// castle_features rule; lift spans match the arch openings)
const SKIP_PARTS: Partial<Record<DawnholdKey, RegExp>> = {
  kcasWallDoorway: /_door$/i,
};

// Meshopt-quantized attributes must bake to floats BEFORE applyMatrix4
// (the castle_features guard: normalized int16 clamps to a 2-unit cube).
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

function extractParts(
  scene: THREE.Group,
  skip?: RegExp,
): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (skip && (skip.test(mesh.name) || (mesh.parent && skip.test(mesh.parent.name)))) return;
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
  return parts;
}

export interface DawnholdFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
}

export function buildDawnholdFeatures(): DawnholdFeaturesView {
  const group = new THREE.Group();
  group.name = 'dawnhold-features';
  const glowLights: THREE.PointLight[] = [];
  const padY = DAWNHOLD.pad.h;
  const walkY = DAWNHOLD.walkAbs;

  const spots = new Map<DawnholdKey, Placement[]>();
  const put = (key: DawnholdKey, p: Placement): void => {
    let list = spots.get(key);
    if (!list) {
      list = [];
      spots.set(key, list);
    }
    list.push(p);
  };

  // Every raw mass below is coursed stone tiled to its own footprint (the
  // shared castle_stone surfacing), so a cap slab, a tower core, and the
  // stair wedge all read as the same masonry at the same course size.
  const capMat = castleStoneMat({ color: 0x9a8f7c, roughness: 0.9 });
  const coreMat = castleStoneMat({ color: 0x8d8272 });
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

  // ---- curtain walls: double-skinned module rows, grid-anchored, gates
  // as open doorway modules ----
  interface WallRun {
    axis: 'x' | 'z';
    line: number;
    a0: number;
    a1: number;
    gate: { a0: number; a1: number } | null;
    outerSide: -1 | 1;
  }
  const hw = DAWNHOLD.towerHw;
  const runs: WallRun[] = [
    {
      axis: 'z',
      line: DAWNHOLD.wx0,
      a0: DAWNHOLD.wz0 + hw,
      a1: DAWNHOLD.wz1 - hw,
      gate: null,
      outerSide: -1,
    },
    {
      axis: 'z',
      line: DAWNHOLD.wx1,
      a0: DAWNHOLD.wz0 + hw,
      a1: DAWNHOLD.wz1 - hw,
      gate: DAWNHOLD_GATES.main,
      outerSide: 1,
    },
    {
      axis: 'x',
      line: DAWNHOLD.wz0,
      a0: DAWNHOLD.wx0 + hw,
      a1: DAWNHOLD.wx1 - hw,
      gate: null,
      outerSide: -1,
    },
    {
      axis: 'x',
      line: DAWNHOLD.wz1,
      a0: DAWNHOLD.wx0 + hw,
      a1: DAWNHOLD.wx1 - hw,
      gate: DAWNHOLD_GATES.postern,
      outerSide: 1,
    },
  ];
  const M = DAWNHOLD.module;
  const skinOff = DAWNHOLD.wallTh / 2 - 0.85;
  const place = (run: WallRun, along: number, key: DawnholdKey, s = S): void => {
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
    // The module grid floors the run, and a run whose length is not a whole
    // number of modules left an open breach beside the far corner tower (the
    // west curtain's last three yards showed the courtyard straight through
    // the wall). A half module closes the remainder flush to the tower shell,
    // nudged a hair proud of the wall plane so its half-yard overlap with the
    // neighbouring module never coplanar-fights it.
    const rem = run.a1 - (run.a0 + count * M);
    if (rem > 0.3) {
      const c = run.a1 - S; // half module is 2 units at scale S
      for (const face of [-1, 1] as const) {
        const off = face * (skinOff + 0.02);
        const x = run.axis === 'z' ? run.line + off : c;
        const z = run.axis === 'z' ? c : run.line + off;
        put('kcasWallHalf', { x, y: padY, z, rot: run.axis === 'z' ? Math.PI / 2 : 0, s: S });
      }
    }
    // battlements outside, guard rail inside, both parted over gates
    const off = DAWNHOLD.wallTh / 2 - 0.2;
    const bat = 0.4;
    for (let c = run.a0 + 0.8; c <= run.a1 - 0.8; c += 4 * bat) {
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) continue;
      const x = run.axis === 'z' ? run.line + run.outerSide * off : c;
      const z = run.axis === 'z' ? c : run.line + run.outerSide * off;
      put('kcasWall', { x, y: walkY - 0.04, z, rot: run.axis === 'z' ? Math.PI / 2 : 0, s: bat });
    }
    for (let c = run.a0 + 1; c <= run.a1 - 1; c += 2 * S) {
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) continue;
      const x = run.axis === 'z' ? run.line - run.outerSide * off : c;
      const z = run.axis === 'z' ? c : run.line - run.outerSide * off;
      put('kcasBarrierHalf', { x, y: walkY, z, rot: run.axis === 'z' ? Math.PI / 2 : 0 });
    }
    // the visible walk floor, parted at gates
    const segs: [number, number][] = run.gate
      ? [
          [run.a0, run.gate.a0],
          [run.gate.a1, run.a1],
        ]
      : [[run.a0, run.a1]];
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 1) continue;
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      if (run.axis === 'z') slab(run.line, mid, DAWNHOLD.wallTh + 0.2, len, walkY - 0.02);
      else slab(mid, run.line, len, DAWNHOLD.wallTh + 0.2, walkY - 0.02);
    }
  }

  // ---- towers: shells, solid cores, caps; the NE watch gets a windowed
  // storey and the green triple banner ----
  for (const t of DAWNHOLD_TOWERS) {
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
      put('kcasBannerGreenTriple', {
        x: t.x + thw - 0.4,
        y: t.hAbs + 0.1,
        z: t.z,
        rot: -Math.PI / 2,
        s: 1.4,
      });
      put('kcasTorch', { x: t.x, y: t.hAbs, z: t.z, rot: 0, s: 1.5 });
    } else {
      for (const f of faces) {
        put('kcasBarrier', { x: f.x, y: t.hAbs, z: f.z, rot: f.rot, s: shellScale });
      }
      put('kcasBannerGreenShield', { x: t.x, y: t.hAbs, z: t.z, rot: Math.PI / 4, s: 1.4 });
    }
  }

  // ---- gate dressing: green banners flanking the main arch, torch light,
  // a mounted torch at the garden postern ----
  const gm = (DAWNHOLD_GATES.main.a0 + DAWNHOLD_GATES.main.a1) / 2;
  for (const side of [-1, 1] as const) {
    put('kcasBannerGreenA', {
      x: DAWNHOLD.wx1 + 1.5,
      y: padY + 2.8,
      z: gm + side * (M / 2 + 1.5),
      rot: Math.PI / 2,
      s: 1.5,
    });
    put('kcasTorchMounted', {
      x: DAWNHOLD.wx1 + 1.3,
      y: padY + 2.2,
      z: gm + side * 4.4,
      rot: -Math.PI / 2,
      s: 1.4,
    });
  }
  const pm = (DAWNHOLD_GATES.postern.a0 + DAWNHOLD_GATES.postern.a1) / 2;
  put('kcasTorchMounted', { x: pm - 2.2, y: padY + 2.2, z: DAWNHOLD.wz1 + 1.3, rot: 0, s: 1.4 });
  const gateLight = new THREE.PointLight(0xffd98a, 4.5, 16, 2);
  gateLight.position.set(DAWNHOLD.wx1 + 1, padY + 3.2, gm);
  gateLight.userData.baseIntensity = 4.5;
  glowLights.push(gateLight);
  group.add(gateLight);

  // ---- the stair flight: a solid wedge pier (lift terrain is invisible) ----
  const wedgeMat = castleStoneMat({ color: 0x8d8272, side: THREE.DoubleSide });
  for (const rmp of DAWNHOLD_RAMPS) {
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

  // ---- the bailey: paved wall to wall. This is a garrison parade ground
  // now, not a lawn, so one flagstone floor spans the whole inner court
  // (a single textured plane, not a field of kit tiles: the buildings sit
  // on top of it and the paving reads continuous under them) ----
  {
    const fx0 = DAWNHOLD.wx0 + DAWNHOLD.wallTh / 2;
    const fx1 = DAWNHOLD.wx1 - DAWNHOLD.wallTh / 2;
    const fz0 = DAWNHOLD.wz0 + DAWNHOLD.wallTh / 2;
    const fz1 = DAWNHOLD.wz1 - DAWNHOLD.wallTh / 2;
    const fw = fx1 - fx0;
    const fd = fz1 - fz0;
    const floorGeo = new THREE.PlaneGeometry(fw, fd);
    tileCastleUv(floorGeo, fw, fd, FLAGSTONE_TILE_YD);
    const floor = new THREE.Mesh(floorGeo, castlePavingMat({ color: 0xb9b4ab }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((fx0 + fx1) / 2, padY + 0.03, (fz0 + fz1) / 2);
    floor.receiveShadow = true;
    group.add(floor);
    // a dressed threshold apron inside each gate, where boots land
    put('kcasFloorLarge', { x: fx1 - M / 2, y: padY + 0.06, z: gm, rot: 0 });
  }

  // ---- the walled flower court off the south wall: three low garden walls
  // (solid masses matching the lift exactly, since lift terrain draws
  // nothing itself), a coping course along every top, and a pillared
  // doorway gap facing the lawn ----
  {
    const C = DAWNHOLD_COURT;
    const cz0 = DAWNHOLD.wz1; // the curtain closes the court's north side
    const wallTop = C.hAbs;
    const wallH = wallTop - padY + 0.4; // sunk a little so no seam shows
    const stoneCourt = castleStoneMat({ color: 0x93917f });
    const runWall = (cx: number, cz: number, sx: number, sz: number): void => {
      const mesh = new THREE.Mesh(castleStoneBox(sx, wallH, sz), stoneCourt);
      mesh.position.set(cx, wallTop - wallH / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    // the two side walls, running south off the curtain
    for (const line of [C.x0, C.x1]) {
      runWall(line, (cz0 + C.z1) / 2, C.th, C.z1 - cz0);
    }
    // the south wall, parted at the doorway
    for (const [a0, a1] of [
      [C.x0, DAWNHOLD_COURT_GATE.a0],
      [DAWNHOLD_COURT_GATE.a1, C.x1],
    ] as const) {
      runWall((a0 + a1) / 2, C.z1, a1 - a0, C.th);
    }
    // coping along every top, and pillars either side of the doorway
    for (const line of [C.x0, C.x1]) {
      slab(line, (cz0 + C.z1) / 2, C.th + 0.3, C.z1 - cz0, wallTop + 0.16, 0.22);
    }
    for (const [a0, a1] of [
      [C.x0, DAWNHOLD_COURT_GATE.a0],
      [DAWNHOLD_COURT_GATE.a1, C.x1],
    ] as const) {
      slab((a0 + a1) / 2, C.z1, a1 - a0, C.th + 0.3, wallTop + 0.16, 0.22);
    }
    for (const gx of [DAWNHOLD_COURT_GATE.a0, DAWNHOLD_COURT_GATE.a1]) {
      put('kcasWallPillar', { x: gx, y: padY, z: C.z1, rot: 0, s: 0.9 });
    }
    // The court's own dressing. Benches are AUTHORED rather than derived
    // from the field ring: with five fields of three different radii the old
    // "field centre plus radius" formula puts seats inside the curtain wall
    // and inside neighbouring beds. Each of these backs onto a wall and
    // faces the fox.
    for (const [bx, bz, brot] of [
      [271.3, 937.2, Math.PI],
      [277.7, 937.2, Math.PI],
      [270.5, 925.0, 0],
      [278.3, 925.0, 0],
    ] as const) {
      put('kcasBench', { x: bx, y: padY, z: bz, rot: brot, s: 1.3 });
    }
    // Warm light over the two MAJOR fields only, reaching far enough to wash
    // the three smaller ones as well. One light per field would put five here
    // plus the statue's, which is GFX.maxPointLights exactly on the default
    // tiers and double the budget on a constrained one.
    for (const f of DAWNHOLD_BEDS) {
      if (f.r < 3) continue;
      const fieldLight = new THREE.PointLight(0xffe2a8, 3, 14, 2);
      fieldLight.position.set(f.x, padY + 2.6, f.z);
      fieldLight.userData.baseIntensity = 3;
      glowLights.push(fieldLight);
      group.add(fieldLight);
    }
    // torches pulled out onto the walls: the old inset put two of them
    // inside the new south beds
    for (const cx of [C.x0 + 1.4, C.x1 - 1.4]) {
      for (const cz of [cz0 + 3, C.z1 - 1.3]) {
        put('kcasTorch', { x: cx, y: padY, z: cz, rot: 0, s: 1.5 });
      }
    }
    // the fox stands 4.9 tall, so its light rides higher than the wolf's did
    const statueLight = new THREE.PointLight(0xd8f0b0, 2.6, 12, 2);
    statueLight.position.set(DAWNHOLD_COURT_STATUE.x, padY + 4, DAWNHOLD_COURT_STATUE.z);
    statueLight.userData.baseIntensity = 2.6;
    glowLights.push(statueLight);
    group.add(statueLight);
  }

  // ---- the outside climbing chain: each shelf is a real standable
  // collider, so it must be drawn or a player vaults onto thin air ----
  for (const l of DAWNHOLD_WALL_LEDGES) {
    const thick = 0.45;
    slab(l.x, l.z, l.hw * 2, l.hd * 2, l.top, thick);
    const corbel = new THREE.Mesh(
      castleStoneBox(l.hw * 1.1, l.top - thick - padY, l.hd * 1.1),
      capMat,
    );
    corbel.position.set(l.x, padY + (l.top - thick - padY) / 2, l.z);
    corbel.castShadow = true;
    corbel.receiveShadow = true;
    group.add(corbel);
  }

  // ---- instance every placed piece ----
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const [key, list] of spots) {
    const scene = scenes[key];
    if (!scene || list.length === 0) continue;
    for (const part of extractParts(scene, SKIP_PARTS[key])) {
      // banner cloth is one-sided in the kit and must read from the lawns
      // outside the walls too, not only from the bailey (castle_kit rule)
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
