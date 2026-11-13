// The heart seal on the Seal Dais and the four crystal spires round it
// (phase 2F: the Ring kit's pieces, ring_kit_plan_core.ts; the timelines are
// heart_seal_core.ts's and heart_portal_core.ts's):
//   - the seal: four quarters of raw granite round a bed of crystal, each
//     facing the bearing its vein's light-river arrives from
//     (HEART_SEAL_QUARTERS), a crystal boss at the middle. Dark until its vein
//     lights; when the river reaches the seal the quarter's crystal FILLS
//     from the rim inward behind a white-hot front (a flush light over it,
//     additive), a column of its colour stands up off it, a shockwave of its
//     colour runs out across the chasm to the Ring, and it burns steady;
//   - the spires: a great crystal leaning in over the seal on each diagonal,
//     igniting from its foot to its tip with its vein, a white flare at the
//     tip;
//   - the opening (heart_portal_core.ts): the quarters charge white, then part
//     like petals, the boss bursts into shards that lift out of the seams and
//     turn round the portal for good (heart_portal.ts draws the rest).
// Without the kit (it failed to land) only the flush light draws over the
// field's dais and the layout's placeholder tines stand; a kit that lands
// late swaps its pieces in under this group.
//
// The flush light lies on the floor ladder's ground rung, so every telegraph
// paints over it. Drawn on every tier (the raid's progress); only the shards
// thin on the low tier. Every material here is the slot's (its uniforms are
// the slot's state), built with the interior with hidden carriers for both
// draw variants, so the late swap links nothing; the frame driver writes
// uniforms and matrices only while they change.

import * as THREE from 'three';
import {
  HEART_SEAL,
  SEAL_DAIS,
  SMITH_HEART_VEIN_COLORS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { markSharedGeometry } from '../shared_resource';
import { heartBeamMaterial, heartCrystalMaterial, heartRingMaterial } from './heart_fx_materials';
import {
  heartKitLoaded,
  heartKitPiece,
  heartKitSlotMaterial,
  SMITH_HEART_RING_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import {
  HEART_PORTAL_RING_REACH,
  type HeartPortalStage,
  type HeartShardPose,
  heartQuarterPose,
  heartShardCount,
  heartShardPose,
} from './heart_portal_core';
import {
  HEART_SEAL_QUARTERS,
  type HeartSealView,
  heartSealArrivalWave,
  heartSealColumn,
  heartSealQuarterFill,
  heartSealQuarterLevel,
  heartSpireIgnite,
} from './heart_seal_core';
import { ringSpireSpots } from './ring_kit_plan_core';

/** Inner radius of the quarters' light (the boss inside it). */
const BOSS_R = 1.8;
/** The gap between two quarters (radians). */
const GAP = 0.05;
/** The flush light over the crystal (the rims stand proud of it). */
const LIFT = 0.09;
/** The kit's quarters sit a breath over the field's dais. */
const KIT_LIFT = 0.012;
/** The arrival column: where it stands on its quarter and its size. */
const COLUMN = { r: 5.4, foot: 2.4, top: 0.7, height: 24 } as const;
/** The seal's heart crystal: white-gold. */
const HEART_GOLD = 0xfff0d0;

const QUARTER_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The flush light over a quarter: additive (nothing while dark), the fill
 *  from the rim inward behind a white-hot front, the vein's light flowing
 *  in the crystal's cells, the charge whitening it toward the middle, the
 *  parted lip burning white-gold. */
const QUARTER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uFill;
uniform float uCharge;
uniform float uOpen;
uniform float uTime;
varying vec2 vLocal;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vLocal);
  float t = clamp((r - ${BOSS_R.toFixed(1)}) / ${(HEART_SEAL.r - BOSS_R).toFixed(1)}, 0.0, 1.0);
  float ang = atan(vLocal.x, vLocal.y);
  // The crystal's cells: rings and broken spokes the light runs between.
  float rings = smoothstep(0.05, 0.0, abs(fract(t * 5.0) - 0.5) - 0.42);
  float cell = floor(ang * 9.0 + floor(t * 5.0) * 1.7);
  float veins = 0.55 + 0.45 * h1(cell * 3.17 + floor(t * 5.0));
  float on = step(0.0001, uFill);
  float front = 1.0 - uFill;
  float lit = smoothstep(front - 0.03, front + 0.03, t) * on;
  float edge = smoothstep(0.1, 0.0, abs(t - front)) * on * step(uFill, 0.999);
  float flow = 0.7 + 0.3 * sin(t * 20.0 - uTime * 2.4 + ang * 3.0);
  vec3 col = uColor * (0.18 + 0.32 * veins + 0.3 * rings) * flow * uLevel * lit;
  col += vec3(1.0, 0.96, 0.88) * edge * 1.6;
  col += mix(uColor, vec3(1.0, 0.96, 0.88), 0.6) * uCharge * (0.4 + 0.9 * (1.0 - t));
  col += vec3(1.0, 0.88, 0.62) * uOpen * smoothstep(0.3, 0.0, t) * 1.4;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

let columnGeometry: THREE.BufferGeometry | null = null;
let discGeometry: THREE.BufferGeometry | null = null;
let warmGeometry: THREE.BufferGeometry | null = null;

interface KitQuarter {
  holder: THREE.Group;
  tilt: THREE.Group;
}

interface Quarter {
  vein: SmithHeartVein;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  crystal: THREE.ShaderMaterial;
  column: THREE.Mesh;
  columnMat: THREE.ShaderMaterial;
  wave: THREE.Mesh;
  waveMat: THREE.ShaderMaterial;
  dirX: number;
  dirZ: number;
  bearing: number;
  kit: KitQuarter | null;
  /** The last written state (fill, level, column, charge, split, wave). */
  last: Float32Array;
}

interface Spire {
  vein: SmithHeartVein;
  crystal: THREE.ShaderMaterial;
  last: Float32Array;
}

export interface HeartSeal {
  group: THREE.Group;
  update(view: HeartSealView, portal: HeartPortalStage, portalSince: number): void;
}

/** A plain mesh of a kit piece's slot (null if the piece has none). */
function kitMesh(
  piece: string,
  slot: 'stone' | 'glow',
  material: THREE.Material,
): THREE.Mesh | null {
  const geo = heartKitPiece(SMITH_HEART_RING_KIT_URL, piece)?.[slot];
  if (!geo) return null;
  const m = new THREE.Mesh(geo, material);
  m.name = `${piece}:${slot}`;
  m.castShadow = slot === 'stone';
  m.receiveShadow = slot === 'stone';
  return m;
}

/** A tiny hidden triangle with the attributes the crystal reads. */
function warmGeo(): THREE.BufferGeometry {
  if (!warmGeometry) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    warmGeometry = markSharedGeometry(g);
  }
  return warmGeometry;
}

/** Hidden carriers of a material, plain and (optionally) instanced. */
function warm(group: THREE.Group, material: THREE.Material, instanced: boolean): void {
  const list: THREE.Mesh[] = [new THREE.Mesh(warmGeo(), material)];
  if (instanced) list.push(new THREE.InstancedMesh(warmGeo(), material, 1));
  for (const m of list) {
    m.visible = false;
    m.frustumCulled = false;
    m.name = 'smithHeartSealWarmer';
    group.add(m);
  }
}

/** The seal and the spires of one slot (instance-local). */
export function buildHeartSeal(lowGfx = false): HeartSeal {
  const group = new THREE.Group();
  group.name = 'smithHeartSeal';
  const y = SEAL_DAIS.h + LIFT;
  columnGeometry ??= markSharedGeometry(
    new THREE.CylinderGeometry(COLUMN.top, COLUMN.foot, COLUMN.height, 20, 1, true).translate(
      0,
      COLUMN.height / 2,
      0,
    ),
  );
  discGeometry ??= markSharedGeometry(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2));
  const quarters: Quarter[] = [];
  for (const q of HEART_SEAL_QUARTERS) {
    const bearing = (q.bearingDeg * Math.PI) / 180;
    // RingGeometry lies in xy; rotated flat, its angle theta points at
    // bearing theta + 90 degrees (clockwise from north).
    const geometry = new THREE.RingGeometry(
      BOSS_R,
      HEART_SEAL.r,
      24,
      6,
      bearing - Math.PI / 2 - Math.PI / 4 + GAP,
      Math.PI / 2 - GAP * 2,
    ).rotateX(-Math.PI / 2);
    const color = SMITH_HEART_VEIN_COLORS[q.vein];
    const material = new THREE.ShaderMaterial({
      name: `smithHeartSealQuarter:${q.vein}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uLevel: { value: 0 },
        uFill: { value: 0 },
        uCharge: { value: 0 },
        uOpen: { value: 0 },
        uTime: sharedUniforms.uTime,
      },
      vertexShader: QUARTER_VERT,
      fragmentShader: QUARTER_FRAG,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `sealQuarter:${q.vein}`;
    mesh.position.set(HEART_SEAL.x, y, HEART_SEAL.z);
    mesh.renderOrder = floorVfxRenderOrder('ground', 5);
    group.add(mesh);
    const dirX = Math.sin(bearing);
    const dirZ = Math.cos(bearing);
    const columnMat = heartBeamMaterial(color, `smithHeartSealColumn:${q.vein}`);
    const column = new THREE.Mesh(columnGeometry, columnMat);
    column.name = `sealColumn:${q.vein}`;
    column.position.set(HEART_SEAL.x + dirX * COLUMN.r, y, HEART_SEAL.z + dirZ * COLUMN.r);
    column.visible = false;
    group.add(column);
    // The arrival's shockwave, in the vein's colour, out across the chasm
    // to the Ring at the Ring's height (it reads from every point of it).
    const waveMat = heartRingMaterial(`smithHeartSealWave:${q.vein}`, color);
    const wave = new THREE.Mesh(discGeometry, waveMat);
    wave.scale.set(HEART_PORTAL_RING_REACH, 1, HEART_PORTAL_RING_REACH);
    wave.position.set(HEART_SEAL.x, 0.16, HEART_SEAL.z);
    wave.renderOrder = floorVfxRenderOrder('ground', 7);
    wave.name = `sealWave:${q.vein}`;
    wave.visible = false;
    group.add(wave);
    const crystal = heartCrystalMaterial(`smithHeartSealCrystal:${q.vein}`, color);
    warm(group, crystal, false);
    quarters.push({
      vein: q.vein,
      mesh,
      material,
      crystal,
      column,
      columnMat,
      wave,
      waveMat,
      dirX,
      dirZ,
      bearing,
      kit: null,
      last: new Float32Array(6).fill(-1),
    });
  }

  // The spires' crystal, one material per vein.
  const spires: Spire[] = SMITH_HEART_VEINS.map((vein) => {
    const crystal = heartCrystalMaterial(
      `smithHeartSpireCrystal:${vein}`,
      SMITH_HEART_VEIN_COLORS[vein],
    );
    crystal.uniforms.uAxis.value = 1;
    crystal.uniforms.uSpan.value.set(2.2, 16);
    warm(group, crystal, false);
    return { vein, crystal, last: new Float32Array(3).fill(-1) };
  });
  // The heart and the shards: white-gold crystal.
  const heartCrystal = heartCrystalMaterial('smithHeartSealHeartCrystal', HEART_GOLD);
  heartCrystal.uniforms.uSpan.value.set(0, 1.8);
  const shardCrystal = heartCrystalMaterial('smithHeartSealShardCrystal', HEART_GOLD);
  shardCrystal.uniforms.uAxis.value = 1;
  shardCrystal.uniforms.uSpan.value.set(-1, 1);
  shardCrystal.uniforms.uFill.value = 1;
  shardCrystal.uniforms.uLevel.value = 1.1;
  warm(group, heartCrystal, false);
  warm(group, shardCrystal, true);

  // The kit's pieces (now, or the moment the kit lands).
  let heart: THREE.Group | null = null;
  const shardMeshes: THREE.InstancedMesh[] = [];
  const shardCount = heartShardCount(lowGfx);
  const buildKit = (): THREE.Group => {
    const kit = new THREE.Group();
    kit.name = 'smithHeartSealKit';
    const stone = heartKitSlotMaterial('stone');
    for (const q of quarters) {
      const holder = new THREE.Group();
      holder.name = `sealQuarterKit:${q.vein}`;
      holder.rotation.y = q.bearing;
      holder.position.set(HEART_SEAL.x, SEAL_DAIS.h + KIT_LIFT, HEART_SEAL.z);
      const tilt = new THREE.Group();
      for (const m of [
        kitMesh('Kit_SealQuarter', 'stone', stone),
        kitMesh('Kit_SealQuarter', 'glow', q.crystal),
      ])
        if (m) tilt.add(m);
      holder.add(tilt);
      kit.add(holder);
      q.kit = { holder, tilt };
      q.last.fill(-1);
    }
    heart = new THREE.Group();
    heart.name = 'sealHeartKit';
    heart.position.set(HEART_SEAL.x, SEAL_DAIS.h + KIT_LIFT, HEART_SEAL.z);
    for (const m of [
      kitMesh('Kit_SealHeart', 'stone', stone),
      kitMesh('Kit_SealHeart', 'glow', heartCrystal),
    ])
      if (m) heart.add(m);
    kit.add(heart);
    for (const s of ringSpireSpots()) {
      const spire = spires.find((x) => x.vein === s.vein);
      if (!spire) continue;
      const g = new THREE.Group();
      g.name = `sealSpire:${s.vein}`;
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.rot;
      for (const m of [
        kitMesh('Kit_SealSpire', 'stone', stone),
        kitMesh('Kit_SealSpire', 'glow', spire.crystal),
      ])
        if (m) g.add(m);
      kit.add(g);
    }
    // The shards: a pool per shape, hidden until the seal splits.
    shardMeshes.length = 0;
    const shapes = ['Kit_SealShardA', 'Kit_SealShardB', 'Kit_SealShardC'];
    shapes.forEach((piece, k) => {
      const n = Math.ceil(shardCount / shapes.length);
      for (const slot of ['stone', 'glow'] as const) {
        const geo = heartKitPiece(SMITH_HEART_RING_KIT_URL, piece)?.[slot];
        if (!geo) continue;
        const inst = new THREE.InstancedMesh(geo, slot === 'stone' ? stone : shardCrystal, n);
        inst.name = `sealShards:${piece}:${slot}`;
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        inst.frustumCulled = false;
        inst.visible = false;
        inst.userData.shape = k;
        kit.add(inst);
        shardMeshes.push(inst);
      }
    });
    kit.updateMatrixWorld(true);
    return kit;
  };
  if (heartKitLoaded(SMITH_HEART_RING_KIT_URL)) {
    group.add(buildKit());
  } else {
    const slot = new THREE.Group();
    slot.name = 'smithHeartSealKitSlot';
    group.add(slot);
    upgradeWhenHeartKitLands(SMITH_HEART_RING_KIT_URL, slot, buildKit);
  }

  const pose = { out: 0, lift: 0, tilt: 0 };
  const ignite = { fill: 0, flare: 0 };
  const shard: HeartShardPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 0 };
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const e4 = new THREE.Euler();
  const p4 = new THREE.Vector3();
  const s4 = new THREE.Vector3();
  let lastShards = -2;
  let lastHeart = -1;
  return {
    group,
    update(view, portal, portalSince) {
      const charge = Math.round(portal.charge * 64) / 64;
      const split = Math.round(portal.split * 128) / 128;
      heartQuarterPose(split, pose);
      for (let i = 0; i < quarters.length; i++) {
        const q = quarters[i];
        const since = view.since[i];
        const fill = Math.round(heartSealQuarterFill(since) * 128) / 128;
        const level = Math.round(heartSealQuarterLevel(since) * 64) / 64;
        const column = Math.round(heartSealColumn(since) * 64) / 64;
        const wave = Math.round(heartSealArrivalWave(since) * 400) / 400;
        // Quantized: a steady seal writes nothing.
        const last = q.last;
        if (
          last[0] === fill &&
          last[1] === level &&
          last[2] === column &&
          last[3] === charge &&
          last[4] === split &&
          last[5] === wave
        ) {
          continue;
        }
        last[0] = fill;
        last[1] = level;
        last[2] = column;
        last[3] = charge;
        last[4] = split;
        last[5] = wave;
        const u = q.material.uniforms;
        u.uFill.value = fill;
        u.uLevel.value = level;
        u.uCharge.value = charge;
        u.uOpen.value = split;
        const c = q.crystal.uniforms;
        c.uFill.value = fill;
        c.uLevel.value = level;
        c.uFlare.value = charge * 0.8;
        q.mesh.position.set(
          HEART_SEAL.x + q.dirX * pose.out,
          y + pose.lift,
          HEART_SEAL.z + q.dirZ * pose.out,
        );
        if (q.kit) {
          q.kit.holder.position.set(
            HEART_SEAL.x + q.dirX * pose.out,
            SEAL_DAIS.h + KIT_LIFT + pose.lift,
            HEART_SEAL.z + q.dirZ * pose.out,
          );
          // Its outer edge (the piece's local +Z) tipped down.
          q.kit.tilt.rotation.x = pose.tilt;
          q.kit.holder.updateMatrixWorld(true);
        }
        q.columnMat.uniforms.uK.value = column * 1.6;
        q.column.visible = column > 0;
        q.wave.visible = wave > 0;
        q.waveMat.uniforms.uR.value = wave;
        q.waveMat.uniforms.uK.value = wave > 0 ? 3.2 * (1 - wave * 0.5) : 0;
      }
      // The spires: each lights with its vein, foot to tip, a flare at the
      // tip; all four flare white as the seal charges.
      for (const s of spires) {
        const since = view.since[SMITH_HEART_VEINS.indexOf(s.vein)];
        heartSpireIgnite(since, ignite);
        const fill = Math.round(ignite.fill * 64) / 64;
        const flare = Math.round(Math.max(ignite.flare, charge) * 64) / 64;
        const level = fill > 0 ? 1 + ignite.flare * 0.6 : 0;
        if (s.last[0] === fill && s.last[1] === flare && s.last[2] === level) continue;
        s.last[0] = fill;
        s.last[1] = flare;
        s.last[2] = level;
        const c = s.crystal.uniforms;
        c.uFill.value = fill;
        c.uFlare.value = flare;
        c.uLevel.value = level;
      }
      // The heart: glows as the veins fill (all four: white-gold), charges,
      // and is gone when the seal parts (its shards lift).
      const lit = view.since.filter((x) => x >= 0).length / view.since.length;
      const hk = Math.round((lit * 0.8 + charge * 1.2) * 32) / 32 + (split >= 0.2 ? 10 : 0);
      if (hk !== lastHeart) {
        lastHeart = hk;
        heartCrystal.uniforms.uFill.value = lit > 0 ? 1 : 0;
        heartCrystal.uniforms.uLevel.value = lit * 0.8 + charge * 1.2;
        heartCrystal.uniforms.uFlare.value = charge;
        if (heart) heart.visible = split < 0.2;
      }
      // The shards (only while there is a portal to turn round).
      const live = portalSince >= 0 && shardMeshes.length > 0;
      if (!live) {
        if (lastShards !== -1) {
          lastShards = -1;
          for (const m of shardMeshes) m.visible = false;
        }
        return;
      }
      lastShards = portalSince;
      const counts = [0, 0, 0];
      const perShape = Math.ceil(shardCount / 3);
      for (let i = 0; i < shardCount; i++) {
        const shape = i % 3;
        const k = counts[shape]++;
        if (k >= perShape) continue;
        heartShardPose(i, portalSince, shard);
        p4.set(HEART_SEAL.x + shard.x, SEAL_DAIS.h + 0.3 + shard.y, HEART_SEAL.z + shard.z);
        q4.setFromEuler(e4.set(shard.rx, shard.ry, shard.rz));
        s4.setScalar(shard.scale);
        m4.compose(p4, q4, s4);
        for (const m of shardMeshes) if (m.userData.shape === shape) m.setMatrixAt(k, m4);
      }
      for (const m of shardMeshes) {
        m.visible = true;
        m.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
