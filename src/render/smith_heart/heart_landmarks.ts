// The Anvil of the World's wall landmarks (phase 2M, design doc section
// 5.21; the pure half is heart_landmarks_core.ts, the shaders
// heart_landmarks_glsl.ts): the Heart kit's four formations past the rim,
// each in its quarter's light, and the air each raises when its quarter
// wakes:
//   - the Heat's molten outcrop: its lava flowing and breaking open, an
//     ember plume and smoke off its crater, the crater's glow;
//   - the Hammer's golden crag: its crystal breathing with glints running
//     up it, gold motes rising off it, the crystal's glow;
//   - the Quench's ice spires: frost shimmering in them, rime wisps and
//     glints swirling, frost mist off their feet, their cold glow;
//   - the Breath's storm horns: their veins flickering, violet lightning
//     arcing between their tips and down into the quarter, sparks.
// Asleep they keep a quiet glow (the quarter's tint), so the room always
// reads as four; the landmark of the quarter the boss stands in erupts as
// its quarter's flood reaches the wall; in the final phase all four.
// Gameplay-neutral at every tier: the landmarks' light (which quarter is
// awake) draws on every tier; the low tier keeps a share of the air.
//
// GPU preparation: built with the interior with the quarters (the compile
// gate links every material, hidden or not); the kit's stone and ice slots
// draw with the kit's shared slot materials; no light; no texture; the
// per-frame update writes uniforms only (no allocation).

import * as THREE from 'three';
import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { GFX, sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { heartKitMeshes, SMITH_HEART_HEART_KIT_URL } from './heart_kit';
import {
  HEART_LANDMARK_FRAME,
  heartBreathBolts,
  heartLandmarkHaloSpots,
  heartLandmarkPoint,
  heartLandmarkSpots,
} from './heart_landmarks_core';
import {
  BOLT_VERT,
  LANDMARK_BILLOW_VERT,
  LANDMARK_HALO_VERT,
  LANDMARK_HEAT_BLOOM_VERT,
  LANDMARK_PLUME_VERT,
  landmarkGlowFrag,
} from './heart_landmarks_glsl';
import { heartHash } from './heart_plan_core';
import { HEART_QUARTER_PALETTE, heartQuarterCount } from './heart_quarters_core';
import { KIT_GLOW_VERT, MOTE_FRAG } from './heart_quarters_glsl';

/** Each quarter's landmark piece in the Heart kit. */
export const HEART_LANDMARK_PIECES: Readonly<Record<SmithHeartVein, string>> = {
  hammer: 'Kit_LandmarkHammer',
  breath: 'Kit_LandmarkBreath',
  quench: 'Kit_LandmarkQuench',
  heat: 'Kit_LandmarkHeat',
};

/** How many of each landmark's motes on the high tier (the low tier keeps a
 *  share). */
export const HEART_LANDMARK_AIR = {
  heat: { embers: 460, smoke: 44 },
  hammer: { motes: 360 },
  quench: { rime: 380, mist: 40 },
  breath: { sparks: 280 },
} as const;

/** One landmark's rig: its light and its air, read every frame. */
interface LandmarkRig {
  piece: THREE.Object3D | null;
  glow: THREE.ShaderMaterial;
  air: THREE.ShaderMaterial[];
}

export interface HeartLandmarks {
  group: THREE.Group;
  /** Each quarter's landmark: `quiet` its asleep glow (0 to 1), `lit` how
   *  awake (0 to 1); `dark` the heart's fall (0 burning, 1 dark). */
  set(vein: SmithHeartVein, quiet: number, lit: number, dark: number): void;
  /** Mythic's collapse: the landmark toppling in over its fallen quarter. */
  topple(vein: SmithHeartVein, tilt: number, drop: number, gone: boolean): void;
}

/** The air's bounds round a landmark (room-local). */
function bounds(spots: readonly { x: number; y: number; z: number }[]): THREE.Sphere {
  const c = new THREE.Vector3();
  for (const s of spots) c.add(new THREE.Vector3(s.x, s.y, s.z));
  c.divideScalar(Math.max(1, spots.length));
  // Phase 2N: a landmark runs along its quarter's whole wall.
  return new THREE.Sphere(c.setY(c.y + 10), 64);
}

function airMat(
  name: string,
  vert: string,
  color: number,
  hot: number,
  alpha: number,
  uniforms: Record<string, THREE.IUniform> = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uLit: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uHotColor: { value: new THREE.Color(hot) },
      uAlpha: { value: alpha },
      ...uniforms,
    },
    vertexShader: vert,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The four landmarks (instance-local, the room's centre `centre`). Needs
 *  the Heart kit (built with the quarters once it has landed). */
const _axis = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _swung = new THREE.Vector3();

export function buildHeartLandmarks(lowGfx: boolean, centre: THREE.Vector3): HeartLandmarks {
  const group = new THREE.Group();
  group.name = 'smithHeartLandmarks';
  const n = (k: number) => heartQuarterCount(k, lowGfx);
  const P = HEART_QUARTER_PALETTE;
  const A = HEART_LANDMARK_AIR;
  const rigs = new Map<SmithHeartVein, LandmarkRig>();
  const veins: SmithHeartVein[] = ['breath', 'quench', 'hammer', 'heat'];
  // Every landmark's rock is painted in its vertex colours (landmark_paint.py,
  // one sculpt grammar, landmark_crag.py): the shared stone's photographic
  // fracture would turn that paint to camouflage. Built-in, no texture, one program.
  const painted = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        name: 'smithHeartLandmarkPainted',
        vertexColors: true,
        metalness: 0,
        roughness: 0.92,
      })
    : new THREE.MeshLambertMaterial({ name: 'smithHeartLandmarkPainted', vertexColors: true });

  for (const vein of veins) {
    const glow = new THREE.ShaderMaterial({
      name: `smithHeartLandmarkGlow:${vein}`,
      vertexColors: true,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(P[vein].color) },
        uHot: { value: new THREE.Color(P[vein].hot) },
        uQuiet: { value: 0 },
        uLit: { value: 0 },
        uDark: { value: 0 },
      },
      vertexShader: KIT_GLOW_VERT,
      fragmentShader: landmarkGlowFrag(vein),
    });
    const piece = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, HEART_LANDMARK_PIECES[vein]);
    if (piece) {
      piece.name = `${HEART_LANDMARK_PIECES[vein]}:${vein}`;
      piece.position.copy(centre);
      for (const m of piece.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) m.material = glow;
        // All four painted alike since the third round (the Heat's dark basalt
        // through the shared stone's fracture read as pure black faces).
        else if (m.name.endsWith(':stone')) m.material = painted;
        if (lowGfx) m.castShadow = false;
      }
      group.add(piece);
    }
    rigs.set(vein, { piece, glow, air: [] });
  }
  group.add(heartMaterialCarriers([...rigs.values()].map((r) => r.glow)));
  const rig = (v: SmithHeartVein) => rigs.get(v) as LandmarkRig;
  const add = (
    vein: SmithHeartVein,
    name: string,
    bases: HeartAirV3[],
    params: HeartAirV4[],
    mat: THREE.ShaderMaterial,
    others?: HeartAirV3[],
  ) => {
    const g = heartQuadGeometry(bases, params, others);
    g.boundingSphere = bounds(heartLandmarkSpots(vein));
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.copy(centre);
    mesh.name = name;
    group.add(mesh);
    rig(vein).air.push(mat);
  };
  /** `count` motes spread over a landmark's spots (round each, `jitter`). */
  const around = (vein: SmithHeartVein, count: number, salt: number, jitter: number) => {
    const spots = heartLandmarkSpots(vein);
    const bases: HeartAirV3[] = [];
    const params: HeartAirV4[] = [];
    for (let i = 0; i < count; i++) {
      const h = (k: number) => heartHash(salt * 977 + i, k);
      const s = spots[i % spots.length];
      bases.push([
        s.x + (h(1) - 0.5) * jitter,
        s.y + (h(2) - 0.5) * jitter * 0.3,
        s.z + (h(3) - 0.5) * jitter,
      ]);
      params.push([h(4), h(5), h(6), h(7)]);
    }
    return { bases, params };
  };
  const halo = (vein: SmithHeartVein, color: number, size: number) => {
    // The Heat's is its crater's bloom alone (heartLandmarkHaloSpots).
    const spots = heartLandmarkHaloSpots(vein);
    const heat = vein === 'heat';
    const mat = heat
      ? airMat(
          `smithHeartLandmarkHalo:${vein}`,
          LANDMARK_HEAT_BLOOM_VERT,
          color,
          P.heat.hot,
          0.42,
          {
            uQuiet: { value: 0 },
          },
        )
      : airMat(`smithHeartLandmarkHalo:${vein}`, LANDMARK_HALO_VERT, color, 0xffffff, 0.5, {
          uQuiet: { value: 0 },
        });
    add(
      vein,
      `heartLandmarkHalo:${vein}`,
      spots.map((s) => [s.x, s.y, s.z] as HeartAirV3),
      spots.map((_, i) => [heartHash(8301, i), size * (i === 0 ? 1 : 0.4), heartHash(8302, i), 0]),
      mat,
    );
  };

  // The Heat: embers boiling up out of the crater and off the lava, smoke
  // rolling up over it, the crater's glow.
  {
    const e = around('heat', n(A.heat.embers), 1, 3.2);
    add(
      'heat',
      'heartLandmarkEmbers:heat',
      e.bases,
      e.params,
      airMat('smithHeartLandmarkEmbers', LANDMARK_PLUME_VERT, 0xd83a10, 0xffd060, 1, {
        uRise: { value: 34 },
        uSpread: { value: 3.4 },
        uSize: { value: 0.26 },
        uSpeed: { value: 0.16 },
      }),
    );
    const s = around('heat', n(A.heat.smoke), 2, 2.0);
    add(
      'heat',
      'heartLandmarkSmoke:heat',
      s.bases,
      s.params,
      // Soot, lit only low by the crater (its lit salmon read as floating
      // globes in the AAA review).
      airMat('smithHeartLandmarkSmoke', LANDMARK_BILLOW_VERT, 0x241e1c, 0x6a3826, 0.16, {
        uRise: { value: 26 },
        uSize: { value: 7.0 },
      }),
    );
    halo('heat', P.heat.color, 1.1);
  }
  // The Hammer: gold motes rising off its crystal, the crystal's glow.
  {
    const m = around('hammer', n(A.hammer.motes), 3, 5.0);
    add(
      'hammer',
      'heartLandmarkMotes:hammer',
      m.bases,
      m.params,
      airMat('smithHeartLandmarkMotes', LANDMARK_PLUME_VERT, 0xe0a650, 0xfff2c8, 1, {
        uRise: { value: 20 },
        uSpread: { value: 4.6 },
        uSize: { value: 0.22 },
        uSpeed: { value: 0.07 },
      }),
    );
    halo('hammer', P.hammer.color, 1.3);
  }
  // The Quench: rime swirling up off its spires, frost mist off its feet,
  // their cold glow.
  {
    const r = around('quench', n(A.quench.rime), 4, 4.0);
    add(
      'quench',
      'heartLandmarkRime:quench',
      r.bases,
      r.params,
      airMat('smithHeartLandmarkRime', LANDMARK_PLUME_VERT, 0x9ad8ff, 0xffffff, 1, {
        uRise: { value: 16 },
        uSpread: { value: 5.4 },
        uSize: { value: 0.17 },
        uSpeed: { value: 0.06 },
      }),
    );
    const m = around('quench', n(A.quench.mist), 5, 6.0);
    add(
      'quench',
      'heartLandmarkMist:quench',
      m.bases.map((b) => [b[0], 0.4, b[2]] as HeartAirV3),
      m.params,
      airMat('smithHeartLandmarkMist', LANDMARK_BILLOW_VERT, 0x8cc8ff, 0xe8f6ff, 0.16, {
        uRise: { value: 4 },
        uSize: { value: 6.2 },
      }),
    );
    halo('quench', P.quench.color, 1.2);
  }
  // The Breath: violet lightning between its horns' tips and down into its
  // quarter, sparks thrown off the tips, the tips' glow.
  {
    const bases: HeartAirV3[] = [];
    const params: HeartAirV4[] = [];
    const dirs: HeartAirV3[] = [];
    heartBreathBolts().forEach((bolt) => {
      const pts = bolt.points;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const d: HeartAirV3 = [b.x - a.x, b.y - a.y, b.z - a.z];
        // A segment's quad: its two ends, each corner pair at its end.
        for (const [q, t] of [
          [a, k / (pts.length - 1)],
          [b, (k + 1) / (pts.length - 1)],
        ] as const) {
          bases.push([q.x, q.y, q.z]);
          params.push([bolt.phase, 0, t, 0]);
          dirs.push(d);
        }
      }
    });
    const boltMat = airMat('smithHeartLandmarkBolts', BOLT_VERT, 0xa98cff, 0xf4f0ff, 1);
    const g = boltGeometry(bases, params, dirs);
    g.boundingSphere = bounds(heartLandmarkSpots('breath'));
    const mesh = new THREE.Mesh(g, boltMat);
    mesh.position.copy(centre);
    mesh.name = 'heartLandmarkBolts:breath';
    group.add(mesh);
    rig('breath').air.push(boltMat);
    const s = around('breath', n(A.breath.sparks), 6, 2.0);
    add(
      'breath',
      'heartLandmarkSparks:breath',
      s.bases,
      s.params,
      airMat('smithHeartLandmarkSparks', LANDMARK_PLUME_VERT, 0xa98cff, 0xc8fff2, 1, {
        uRise: { value: 9 },
        uSpread: { value: 6.0 },
        uSize: { value: 0.16 },
        uSpeed: { value: 0.3 },
      }),
    );
    halo('breath', P.breath.color, 1.1);
  }

  const set = (u: THREE.IUniform, v: number) => {
    const k = Math.round(v * 1000) / 1000;
    if (u.value !== k) u.value = k;
  };
  return {
    group,
    set(vein, quiet, lit, dark) {
      const r = rig(vein);
      set(r.glow.uniforms.uQuiet, quiet * (1 - dark));
      set(r.glow.uniforms.uLit, lit * (1 - dark));
      set(r.glow.uniforms.uDark, dark);
      for (const m of r.air) {
        set(m.uniforms.uLit, lit * (1 - dark));
        if (m.uniforms.uQuiet) set(m.uniforms.uQuiet, quiet * (1 - dark));
      }
    },
    topple(vein, tilt, drop, gone) {
      const piece = rig(vein).piece;
      if (!piece) return;
      if (piece.visible === gone) piece.visible = !gone;
      if (gone) return;
      // About its foot on the rim, in toward the room's centre (room-local).
      const foot = heartLandmarkPoint(vein, HEART_LANDMARK_FRAME.r - 8, 0, 0);
      _axis.set(foot.z, 0, -foot.x).normalize();
      piece.quaternion.setFromAxisAngle(_axis, -tilt);
      _foot.set(foot.x, 0, foot.z);
      _swung.copy(_foot).applyQuaternion(piece.quaternion);
      piece.position.copy(centre).add(_foot).sub(_swung);
      piece.position.y -= drop;
    },
  };
}

/** The bolts' ribbons: each segment one quad, its two ends' corner pairs
 *  (the vertex shader turns them to the camera). `bases`/`params`/`dirs`
 *  come in pairs, a segment's start and end. */
function boltGeometry(
  bases: readonly HeartAirV3[],
  params: readonly HeartAirV4[],
  dirs: readonly HeartAirV3[],
): THREE.BufferGeometry {
  const segs = bases.length / 2;
  const pos = new Float32Array(segs * 4 * 3);
  const corner = new Float32Array(segs * 4 * 2);
  const prm = new Float32Array(segs * 4 * 4);
  const other = new Float32Array(segs * 4 * 3);
  const idx = new Uint32Array(segs * 6);
  for (let s = 0; s < segs; s++) {
    for (let v = 0; v < 4; v++) {
      const end = v < 2 ? 0 : 1;
      const side = v === 0 || v === 3 ? -1 : 1;
      const src = s * 2 + end;
      pos.set(bases[src], (s * 4 + v) * 3);
      corner.set([end, side], (s * 4 + v) * 2);
      prm.set(params[src], (s * 4 + v) * 4);
      other.set(dirs[src], (s * 4 + v) * 3);
    }
    idx.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4, s * 4 + 2, s * 4 + 3], s * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aParams', new THREE.BufferAttribute(prm, 4));
  g.setAttribute('aOther', new THREE.BufferAttribute(other, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Hidden carriers of materials a kit piece wears (the compile gate links
 *  them with the interior even before the piece is in view, and a test can
 *  read them without the kit): one shared empty triangle, never drawn. */
export function heartMaterialCarriers(mats: readonly THREE.Material[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'smithHeartMaterialCarriers';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  for (const m of mats) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.visible = false;
    mesh.name = `carrier:${m.name}`;
    g.add(mesh);
  }
  return g;
}
