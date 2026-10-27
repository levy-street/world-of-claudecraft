// The Heart and the raid's floating islands (heart_room_core.ts plans them):
// the keels under the Seal Dais, the Anvil of the World and its terrace; the
// Smith's heart beating in the chasm, its light rising in shafts; the four
// colossal chains from the altars into the mountain's crown, each carrying
// its vein's light down into its altar; the platform's rune rings; and the
// embers rising out of the chasm toward the open sky.
//
// Since phase 2J the Heart's Blender kit (heart_room_kit.ts) draws the
// platform, the terrace, their keels, the altars and the four roots of the
// mountain that replaced the chains; with it this draws the heart's light in
// its bed deep in the chasm (the core, smaller, in the bed's hollow), the
// shafts, the rune rings, the channels' light from each altar to the hub (one
// per vein, lit and dimmed on its own: `setVein`) and the embers. Without the
// kit, the blockout's chains, pours and keels stand as before.
//
// Static geometry with shader-driven motion (the shared clock): a uniform
// is written only when a vein's level or the heart's darkness changes. The
// chains are one instanced draw; the rune rings and the channels ride the
// floor ladder's ground rung. Every tier draws the core, the chains (or the
// roots) and the pours (they are the room's identity and point at the
// altars); only the embers thin on the low tier (cosmetic).

import * as THREE from 'three';
import {
  HEART_ALTARS,
  HEART_ROOM,
  SMITH_HEART_VEIN_COLORS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms, surfaceMat } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import {
  heartBeamMaterial,
  heartCoreMaterial,
  heartMoteGeometry,
  heartMoteMaterial,
} from './heart_fx_materials';
import { HEART_PALETTE } from './heart_plan_core';
import {
  HEART_CORE,
  HEART_CORE_SHAFTS,
  HEART_RUNE_RINGS,
  heartChainLink,
  heartChains,
  heartEmberCount,
  heartKeels,
} from './heart_room_core';
import { HEART_CORE_BED_Y } from './heart_room_kit_plan_core';

// The rune rings: a fine line of light along each ring and, carved in the
// basalt band either side of it, the Smith's glyphs (chevrons, staves and
// lozenges, one to a cell, some cells bare), lit faintly from within, the
// light running slowly round. Never a dashed lane: each glyph is a stroke.
const RUNE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform vec3 uColor;
varying vec2 vP;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float stroke(float d, float w) { return 1.0 - smoothstep(w * 0.6, w, abs(d)); }
float glyph(float kind, float w, float v) {
  float c = 0.0;
  if (kind < 0.33) {
    // A chevron, its point toward the ring.
    c = stroke(abs(w - 0.5) * 2.0 - v, 0.16);
  } else if (kind < 0.66) {
    // A stave, forked at its far end (the Smith's mark of a vein).
    float fork = stroke(abs(w - 0.5) * 2.0 - (v - 0.55) * 1.6, 0.14) * step(0.55, v);
    c = max(stroke(w - 0.5, 0.09) * step(v, 0.62), fork);
  } else {
    // A lozenge.
    c = stroke(abs(w - 0.5) * 2.0 + abs(v - 0.5) * 2.0 - 0.8, 0.12);
  }
  return c * step(0.02, v) * step(v, 0.98);
}
void main() {
  float r = length(vP);
  float turns = atan(vP.x, vP.y) / 6.2831853 + 0.5;
  float a = 0.0;
  ${HEART_RUNE_RINGS.map(
    (R, i) => `{
    float s = r - ${R.toFixed(1)};
    float d = abs(s);
    a += (1.0 - smoothstep(0.05, 0.12, d)) * 0.9;
    float n = ${Math.round(R * 2.6)}.0;
    float cell = floor(turns * n);
    float w = fract(turns * n);
    float v = (d - 0.42) / 1.0;
    float h = h1(cell * ${(3.1 + i).toFixed(1)} + step(0.0, s) * 17.0);
    if (h > 0.28 && v > 0.0 && v < 1.0) a += glyph(fract(h * 7.3), w, v) * 0.42;
  }`,
  ).join('\n  ')}
  float beat = 0.8 + 0.2 * sin(uTime * 2.856);
  float run = 0.55 + 0.45 * smoothstep(0.6, 1.0, sin(turns * 12.566 - uTime * 0.45));
  a *= uLevel;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a * beat * run, 1.0);
  #include <colorspace_fragment>
}`;

/** The keels under the floating islands (but those a kit draws: the Seal
 *  Dais's is the Ring kit's since phase 2F). */
function buildKeels(group: THREE.Group, skip: ReadonlySet<string>): void {
  const stone = surfaceMat({
    color: HEART_PALETTE.dark,
    roughness: 0.9,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  for (const k of heartKeels()) {
    if (skip.has(k.id)) continue;
    const pts = k.profile.map(([r, y]) => new THREE.Vector2(Math.max(0.01, r), y));
    const keel = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), stone);
    keel.position.set(k.x, k.h, k.z);
    keel.name = `keel:${k.id}`;
    group.add(keel);
    // The glowing band round it.
    const r0 = radiusAt(k.profile, -k.band[0]);
    const r1 = radiusAt(k.profile, -k.band[1]);
    const band = new THREE.Mesh(
      new THREE.LatheGeometry(
        [new THREE.Vector2(r0 + 0.25, -k.band[0]), new THREE.Vector2(r1 + 0.25, -k.band[1])],
        40,
      ),
      surfaceMat({
        color: 0x1a1410,
        emissive: k.color,
        emissiveIntensity: 1.6,
        side: THREE.DoubleSide,
      }),
    );
    band.position.set(k.x, k.h, k.z);
    band.name = `keelBand:${k.id}`;
    group.add(band);
  }
}

/** The keel's radius at height `y` (under the floor) by its profile. */
function radiusAt(profile: readonly (readonly [number, number])[], y: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [ra, ya] = profile[i];
    const [rb, yb] = profile[i + 1];
    if (y <= ya && y >= yb) return ra + ((rb - ra) * (y - ya)) / (yb - ya || 1);
  }
  return profile[profile.length - 1][0];
}

let haloMaterial: THREE.SpriteMaterial | null = null;

/** The Smith's heart in the chasm, its halo and its rising shafts (with the
 *  kit: the molten light in the bed's hollow the heart rises from). Returns
 *  the core's material (its beat dims when the heart goes dark). */
function buildCore(group: THREE.Group, kit: boolean): THREE.ShaderMaterial {
  const material = heartCoreMaterial('smithHeartCore');
  const r = kit ? 10 : HEART_CORE.r;
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), material);
  core.position.set(HEART_CORE.x, kit ? HEART_CORE_BED_Y - 3.4 : HEART_CORE.y, HEART_CORE.z);
  core.name = 'smithHeartCore';
  group.add(core);
  if (!haloMaterial) {
    haloMaterial = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: 0xffc070,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: 'smithHeartCoreHalo',
    });
    markSharedMaterial(haloMaterial);
  }
  const halo = new THREE.Sprite(haloMaterial);
  halo.position.set(HEART_CORE.x, (kit ? HEART_CORE_BED_Y : HEART_CORE.y) + 4, HEART_CORE.z);
  halo.scale.set(kit ? 90 : 120, kit ? 90 : 120, 1);
  group.add(halo);
  const shaftMat = heartBeamMaterial(0xffc87a, 'smithHeartCoreShaft');
  shaftMat.uniforms.uK.value = 0.22;
  for (const s of HEART_CORE_SHAFTS) {
    const h = 110;
    const g = new THREE.CylinderGeometry(s.r, s.r * 0.5, h, 16, 1, true).translate(0, h / 2, 0);
    const shaft = new THREE.Mesh(g, shaftMat);
    shaft.position.set(s.x, HEART_CORE.y + 6, s.z);
    // Lean out, away from the platform.
    const ax = s.x - HEART_ROOM.x;
    const az = s.z - HEART_ROOM.z;
    const l = Math.hypot(ax, az) || 1;
    shaft.rotation.set((az / l) * s.tilt, 0, (-ax / l) * s.tilt);
    shaft.name = 'coreShaft';
    group.add(shaft);
  }
  return material;
}

/** The four chains (one instanced draw) and their pours. */
function buildChains(group: THREE.Group): void {
  const chains = heartChains();
  const count = chains.reduce((n, c) => n + c.links, 0);
  const link = new THREE.TorusGeometry(1.9, 0.62, 8, 18).scale(1, 1.6, 1);
  const iron = surfaceMat({
    color: HEART_PALETTE.steel,
    metalness: 0.75,
    roughness: 0.4,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(link, iron, count);
  mesh.name = 'smithHeartChains';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (const c of chains) {
    dir.set(c.bx - c.ax, c.by - c.ay, c.bz - c.az).normalize();
    q.setFromUnitVectors(up, dir);
    for (let k = 0; k < c.links; k++) {
      const l = heartChainLink(c, k);
      roll.setFromAxisAngle(up, l.roll);
      pos.set(l.x, l.y, l.z);
      m.compose(pos, q.clone().multiply(roll), one);
      mesh.setMatrixAt(i++, m);
    }
    // The pour: the vein's light running down the chain into its altar.
    const a = new THREE.Vector3(c.ax, c.ay, c.az);
    const b = new THREE.Vector3(c.bx, c.by, c.bz);
    const len = a.distanceTo(b);
    const pourMat = heartBeamMaterial(
      SMITH_HEART_VEIN_COLORS[c.vein],
      `smithHeartPour:${c.vein}`,
      -1.4,
    );
    pourMat.uniforms.uK.value = 0.85;
    const pour = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.15, len, 12, 8, true).translate(0, len / 2, 0),
      pourMat,
    );
    pour.position.copy(a);
    pour.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    pour.name = `pour:${c.vein}`;
    group.add(pour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

/** The platform's rune rings (a floor mark on the ground rung). */
function buildRuneRings(group: THREE.Group): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'smithHeartRuneRings',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uLevel: { value: 1 },
      uColor: { value: new THREE.Color(0xffc878) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: RUNE_FRAG,
  });
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(HEART_ROOM.r - 1.5, 128).rotateX(-Math.PI / 2),
    material,
  );
  disc.position.set(HEART_ROOM.x, HEART_ROOM.h + 0.06, HEART_ROOM.z);
  disc.renderOrder = floorVfxRenderOrder('ground', 2);
  disc.name = 'heartRuneRings';
  group.add(disc);
  return material;
}

/** Where a channel's light runs (yards from the platform's centre): from
 *  the hub to the altar's plinth (the kit's channel, heart_pieces.py). */
const CHANNEL_RUN = { from: 1.8, to: 33.8, half: 0.78 } as const;

const CHANNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // The vein's light running in from its altar (uv.y 1) to the hub (0), a
  // bright head every few seconds, the bed's edges dark.
  float across = abs(vUv.x - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.08, 0.3, across);
  float body = 1.0 - smoothstep(0.3, 1.0, across);
  float run = fract(vUv.y * 2.2 + uTime * 0.28);
  float head = smoothstep(0.82, 1.0, run) * (1.0 - smoothstep(0.98, 1.0, run));
  float a = (core * 0.42 + body * 0.12 + head * body * 0.45) * (0.75 + 0.25 * vUv.y) * uLevel;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.97, 0.9), head * 0.5) * a, 1.0);
  #include <colorspace_fragment>
}`;

/** The four channels' light (a floor mark on the ground rung), one material
 *  per vein. */
function buildChannels(group: THREE.Group): Map<SmithHeartVein, THREE.ShaderMaterial> {
  const out = new Map<SmithHeartVein, THREE.ShaderMaterial>();
  const len = CHANNEL_RUN.to - CHANNEL_RUN.from;
  // A strip along +Z from the hub (uv.y 0) to the altar (1).
  const geo = new THREE.PlaneGeometry(CHANNEL_RUN.half * 2, len, 1, 16)
    .rotateX(-Math.PI / 2)
    .translate(0, 0, CHANNEL_RUN.from + len / 2);
  // PlaneGeometry's uv.y runs +Y to... after the turn, from the far end:
  // flip so uv.y is 0 at the hub.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  for (const a of HEART_ALTARS) {
    const material = new THREE.ShaderMaterial({
      name: `smithHeartChannel:${a.vein}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uLevel: { value: 1 },
        uColor: { value: new THREE.Color(SMITH_HEART_VEIN_COLORS[a.vein]) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: CHANNEL_FRAG,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(HEART_ROOM.x, HEART_ROOM.h + 0.045, HEART_ROOM.z);
    mesh.rotation.y = Math.atan2(a.x - HEART_ROOM.x, a.z - HEART_ROOM.z);
    mesh.renderOrder = floorVfxRenderOrder('ground', 2);
    mesh.name = `heartChannel:${a.vein}`;
    group.add(mesh);
    out.set(a.vein, material);
  }
  return out;
}

/** The embers rising out of the chasm toward the sky. */
function buildEmbers(group: THREE.Group, lowGfx: boolean): void {
  const material = heartMoteMaterial('smithHeartEmbers', {
    radius: 62,
    height: 150,
    size: 1.3,
    spin: 0.22,
    color: 0xffb860,
  });
  material.uniforms.uK.value = 1;
  const points = new THREE.Points(heartMoteGeometry(heartEmberCount(lowGfx)), material);
  points.position.set(HEART_ROOM.x, HEART_CORE.y + 10, HEART_ROOM.z);
  points.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 75, 0), 110);
  points.name = 'heartEmbers';
  group.add(points);
}

export interface HeartRoom {
  group: THREE.Group;
  /** Light (1) or dim (0) one vein's channel (the kit's only). */
  setVein(vein: SmithHeartVein, level: number): void;
  /** The heart's light: 1 beating, toward 0 as it goes dark. */
  setHeart(level: number): void;
}

/** The Heart's dressing and every island's keel (instance-local). With the
 *  Heart kit (`kit`), the roots replace the chains and the channels carry
 *  each vein's light. */
export function buildHeartRoom(
  lowGfx: boolean,
  skipKeels: ReadonlySet<string> = new Set(),
  kit = false,
): HeartRoom {
  const group = new THREE.Group();
  group.name = 'smithHeartRoom';
  buildKeels(group, skipKeels);
  const core = buildCore(group, kit);
  if (!kit) buildChains(group);
  const runes = buildRuneRings(group);
  const channels = kit ? buildChannels(group) : new Map<SmithHeartVein, THREE.ShaderMaterial>();
  buildEmbers(group, lowGfx);
  let heart = 1;
  return {
    group,
    setVein(vein, level) {
      const m = channels.get(vein);
      const k = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
      if (m && m.uniforms.uLevel.value !== k) m.uniforms.uLevel.value = k;
    },
    setHeart(level) {
      const k = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
      if (k === heart) return;
      heart = k;
      // A dark heart beats slow and faint.
      core.uniforms.uBeat.value = 2.2 + (1 - k) * 6;
      core.uniforms.uLevel.value = k;
      runes.uniforms.uLevel.value = 0.25 + 0.75 * k;
    },
  };
}
