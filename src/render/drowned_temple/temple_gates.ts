// The Drowned Temple's gates and seals as structures: the Choir Veil (a
// curtain of water falling from its arch across the Choir Stair, parting down
// the middle), the warded arches of the Court Stairs and the Prism Ward (a
// membrane of moonlight with drifting glyphs, dissolving upward), the Prism
// Stair that RISES out of the lagoon as the Hydra's pool drains, the Moonbridge
// that assembles plank by plank out of moonlight, and the Altar Ward's rite
// disc that shatters.
//
// Each gate reads its on-screen state from the shared gate memory
// (../hollow_crypt/crypt_gate_state_core.ts, fed by the mirrored gate entities
// through ../gate_objects.ts) in an onBeforeRender hook, so a state swap plays
// as a reveal and costs nothing off screen. A sealed gate flares.

import * as THREE from 'three';
import { DROWNED_TEMPLE_GATES } from '../../sim/content/drowned_temple';
import { DROWNED_TEMPLE_FIELD, MOONBRIDGE } from '../../sim/content/drowned_temple_layout';
import type { FieldPathSurface } from '../../sim/instances/authored_field/types';
import type { DungeonGateDef } from '../../sim/types';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';
import { flagstoneDetail } from '../authored_field/field_textures';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { GFX, sharedUniforms, surfaceMat } from '../gfx';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';
import { instancePlacements, templeKitPiece, templeSlotMaterial } from './temple_kit';
import {
  MOONBRIDGE_MOMENT,
  MOONBRIDGE_MOMENT_SECONDS,
  MOONBRIDGE_PLANKS,
  moonbridgeLaid,
  moonbridgePlankFlash,
  moonbridgePlankRise,
} from './temple_moonbridge_core';
import {
  moonbridgeSpan,
  planMoonbridgeEdges,
  planRisingStairEdges,
  risingStairField,
} from './temple_rising_stair_core';

interface GateRig {
  root: THREE.Group;
  /** Called every rendered frame with the gate's openness and seal pulse;
   *  `forming` is true while the gate stands open after a change this page
   *  watched (the Moonbridge then builds on its beam's timeline). */
  apply(openness: number, seal: number, since: number, forming: boolean): void;
}

const SHEET_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// ---- the Choir Veil: a curtain of falling water that parts ------------------------------

const VEIL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uOpen;
uniform float uSeal;
${NOISE}
void main() {
  float u = vUv.x;
  float t = 1.0 - vUv.y;
  // The curtain parts from the middle outward; the two halves thin to threads.
  float gap = abs(u - 0.5) * 2.0;
  float part = smoothstep(uOpen * 1.1 - 0.08, uOpen * 1.1 + 0.06, gap + (noise(vec2(u * 20.0, t * 4.0 - uTime)) - 0.5) * 0.1);
  vec2 q = vec2(u * 34.0, t * 5.0 - uTime * 5.5);
  float streak = noise(vec2(q.x, q.y * 0.3)) * 0.6 + noise(vec2(q.x * 2.1, q.y * 0.7)) * 0.4;
  float white = smoothstep(0.6, 0.95, streak) + smoothstep(0.1, 0.0, t) * 0.5 + smoothstep(0.9, 1.0, t) * 0.6;
  vec3 col = mix(vec3(0.3, 0.42, 0.58), vec3(0.85, 0.9, 1.0), clamp(white, 0.0, 1.0));
  // Sealed while Selthe sings: the water burns gold with her choir.
  col = mix(col, vec3(1.0, 0.82, 0.45), uSeal * 0.55 * (0.6 + 0.4 * streak));
  float a = (0.42 + 0.4 * smoothstep(0.3, 0.7, streak)) * part * smoothstep(0.0, 0.04, u) * smoothstep(1.0, 0.96, u);
  gl_FragColor = vec4(col, a * (0.85 + 0.15 * uSeal));
  #include <colorspace_fragment>
}
`;

function waterVeil(gate: DungeonGateDef): GateRig {
  const width = gate.hw * 2 + 1.6;
  const height = 12.6;
  const uniforms = { uTime: sharedUniforms.uTime, uOpen: { value: 0 }, uSeal: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleWaterVeil',
    vertexShader: SHEET_VERT,
    fragmentShader: VEIL_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const root = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material);
  sheet.position.set(0, height / 2 - 0.2, 0);
  sheet.renderOrder = 9;
  root.add(sheet);
  // The arch the curtain falls from (legs out in the water either side).
  root.add(kitPieceMesh('Kit_VeilArch', 0, -1.6, 0, 0));
  return {
    root,
    apply(openness, seal) {
      uniforms.uOpen.value = openness;
      uniforms.uSeal.value = seal;
    },
  };
}

// ---- a warded arch: a membrane of moonlight ----------------------------------------------

const WARD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uOpen;
uniform float uSeal;
uniform vec3 uTint;
${NOISE}
void main() {
  vec2 p = vUv * vec2(6.0, 5.0);
  float n = noise(p + vec2(0.0, -uTime * 0.4)) * 0.6 + noise(p * 2.3 + uTime * 0.2) * 0.4;
  // Glyphs drifting up the membrane.
  vec2 g = fract(vec2(vUv.x * 6.0, vUv.y * 4.0 - uTime * 0.15));
  float glyph = smoothstep(0.1, 0.0, abs(g.x - 0.5) - 0.08) * smoothstep(0.1, 0.0, abs(g.y - 0.5) - 0.2)
    * step(0.55, hash(floor(vec2(vUv.x * 6.0, vUv.y * 4.0 - uTime * 0.15))));
  // Dissolves upward as it opens.
  float gone = smoothstep(uOpen * 1.2 - 0.1, uOpen * 1.2 + 0.05, vUv.y + (n - 0.5) * 0.2);
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
  vec3 col = uTint * (0.5 + 0.6 * n) + vec3(1.0) * glyph * 0.6;
  col = mix(col, vec3(1.0, 0.8, 0.5), uSeal * 0.5);
  float a = (0.28 + 0.25 * n + glyph * 0.4) * gone * edge * (1.0 + uSeal * 0.6);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  #include <colorspace_fragment>
}
`;

function wardedArch(gate: DungeonGateDef, tint: number): GateRig {
  const width = gate.hw * 2;
  const height = 9.5;
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uOpen: { value: 0 },
    uSeal: { value: 0 },
    uTint: { value: new THREE.Color(tint) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleWard',
    vertexShader: SHEET_VERT,
    fragmentShader: WARD_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const root = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material);
  sheet.position.set(0, height / 2, 0);
  sheet.renderOrder = 9;
  root.add(sheet);
  root.add(kitPieceMesh('Kit_WardArch', 0, 0, 0, 0, (width + 1.6) / 12.6));
  return {
    root,
    apply(openness, seal) {
      uniforms.uOpen.value = openness;
      uniforms.uSeal.value = seal;
    },
  };
}

// ---- the Altar Ward: a spinning rite disc that shatters ----------------------------------

const RITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uOpen;
uniform float uSeal;
${NOISE}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x) + uTime * 0.4;
  float rings = smoothstep(0.03, 0.0, abs(r - 0.92)) + smoothstep(0.02, 0.0, abs(r - 0.6)) * 0.8
    + smoothstep(0.02, 0.0, abs(r - 0.3)) * 0.6;
  float spokes = smoothstep(0.02, 0.0, abs(sin(a * 6.0)) * r - 0.0) * step(0.3, r) * step(r, 0.92) * 0.5;
  float cell = hash(floor(vec2(a * 3.0, r * 8.0)));
  float crack = step(uOpen * 1.1, cell);
  float fill = smoothstep(1.0, 0.0, r) * 0.18;
  vec3 col = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.55), uSeal);
  float alpha = (rings + spokes + fill) * crack * step(r, 1.0);
  gl_FragColor = vec4(col * (1.0 + uSeal), clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

function riteWard(gate: DungeonGateDef): GateRig {
  const width = gate.hw * 2;
  const uniforms = { uTime: sharedUniforms.uTime, uOpen: { value: 0 }, uSeal: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    name: 'drownedTempleRiteWard',
    vertexShader: SHEET_VERT,
    fragmentShader: RITE_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const root = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(width, width, 1, 1), material);
  disc.position.set(0, width / 2 + 0.2, 0);
  disc.renderOrder = 9;
  root.add(disc);
  root.add(kitPieceMesh('Kit_WardArch', 0, 0, 0, 0, (width + 1.6) / 12.6));
  return {
    root,
    apply(openness, seal) {
      uniforms.uOpen.value = openness;
      uniforms.uSeal.value = seal;
      disc.scale.setScalar(1 + openness * 0.25);
    },
  };
}

// ---- the Prism Stair rising out of the lagoon -----------------------------------------------

function pathSurface(id: string): FieldPathSurface {
  const s = DROWNED_TEMPLE_FIELD.surfaces.find((x) => x.id === id);
  if (!s || s.kind !== 'path') throw new Error(`no path ${id}`);
  return s;
}

/** The Prism Stair rises out of the lagoon as the Hydra's pool drains. It is
 *  drawn by the field's own ground painter (the same wet flagstones and cliff
 *  faces as every other stair, from temple_rising_stair_core.ts) with the
 *  kit's balustrades down both sides, so the tread you see is the tread you
 *  walk; the whole flight sinks and rises as one. */
function sunkenStair(gate: DungeonGateDef, lowGfx: boolean): GateRig {
  const path = pathSurface('prism_stair_sunken');
  const holder = new THREE.Group();
  const stair = new THREE.Group();
  stair.name = 'drownedTempleRisingStair';
  // The painters work in instance axes: shift back from the gate point.
  stair.position.set(-gate.x, 0, -gate.z);
  stair.add(buildAuthoredFieldTerrain(risingStairField(), { lowGfx, wet: true }));
  stair.add(instancePlacements(planRisingStairEdges(), () => 0, lowGfx, 'drownedTempleStairRails'));
  holder.add(stair);
  // Water streaming off the rising steps.
  const streamMat = new THREE.MeshBasicMaterial({
    color: 0xbfd6ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    name: 'drownedTempleStairRunoff',
  });
  const runoff = new THREE.Mesh(new THREE.BoxGeometry(path.halfWidth * 2.1, 14, 16), streamMat);
  runoff.position.set(8, 2, 6);
  runoff.rotation.y = Math.atan2(0.73, 0.68);
  holder.add(runoff);
  const root = new THREE.Group();
  // The gate group stands at the gate point rotated by gate.rot; the stair is
  // authored in instance axes, so undo the rotation for it.
  root.rotation.y = -gate.rot;
  root.add(holder);
  return {
    root,
    apply(openness, _seal, since) {
      // Sunk well under the lagoon until the pool drains, then it rises.
      holder.position.y = (1 - openness) * -16;
      const pour =
        openness > 0 && openness < 1 ? 1 : Math.max(0, 1 - since / 3) * (openness >= 1 ? 1 : 0);
      streamMat.opacity = 0.35 * pour;
      runoff.visible = pour > 0.01;
    },
  };
}

// ---- the Moonbridge ------------------------------------------------------------------------

/** A plank of the Moonbridge: pearl stone with the terrace's own flagstone
 *  detail (UVs in yards, like the field's floors), tinted moon-silver. */
function plankGeometry(width: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 0.42, width);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // World-yard UVs on every face (the flagstone reads at the field's scale).
    const ny = Math.abs(nor.getY(i));
    const nx = Math.abs(nor.getX(i));
    if (ny > 0.5) uv.setXY(i, x * 0.25, z * 0.25);
    else if (nx > 0.5) uv.setXY(i, z * 0.25, y * 0.25);
    else uv.setXY(i, x * 0.25, y * 0.25);
    // The terrace's pearl-blue flagstone, a touch darker underneath and along
    // the edges, so it reads as the temple's own stone lit by the moon.
    const under = y < 0 ? 0.62 : 1;
    const rim = 1 - Math.min(1, Math.abs(z) / (width / 2)) ** 6 * 0.18;
    col.set([0.5 * under * rim, 0.56 * under * rim, 0.7 * under * rim], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** The Moonbridge assembles plank by plank out of moonlight once the Colossus
 *  falls: solid lit pearl planks (the terrace's own stone material, so it
 *  takes the moon's light and the shadows like the floors it joins), a seam
 *  of moonlight down the middle, and the temple's own balustrades. It spans
 *  only the open water between the Prism Terrace's rim and the Altar Landing
 *  (temple_rising_stair_core.ts moonbridgeSpan), so no plank lies on a floor. */
function moonbridge(gate: DungeonGateDef, lowGfx: boolean): GateRig {
  const path = pathSurface('moonbridge');
  const planks: THREE.Mesh[] = [];
  const glows: THREE.Mesh[] = [];
  const stone = flagstoneDetail();
  const material = surfaceMat({
    map: stone.map,
    normalMap: lowGfx ? undefined : stone.normalMap,
    vertexColors: true,
    roughness: 0.62,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xbfd6ff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    name: 'drownedTempleMoonbridgeSeam',
  });
  const holder = new THREE.Group();
  const span = moonbridgeSpan();
  const from = span.fromX;
  const to = span.toX;
  const deckAt = span.deckAt;
  const count = MOONBRIDGE_PLANKS;
  const step = Math.abs(to - from) / count;
  const width = path.halfWidth * 2;
  const plankGeo = plankGeometry(width);
  const seamGeo = new THREE.PlaneGeometry(1, 0.5).rotateX(-Math.PI / 2);
  const z = MOONBRIDGE.z - gate.z;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = from + (to - from) * t;
    // Each plank follows the deck's slope, so the span reads as one smooth
    // ramp instead of a flight of loose steps.
    const rise = deckAt(x + step / 2) - deckAt(x - step / 2);
    const tilt = Math.atan2(rise, step);
    const plank = new THREE.Mesh(plankGeo, material);
    plank.scale.x = (step / Math.cos(tilt)) * 1.01;
    plank.position.set(x - gate.x, deckAt(x) - 0.21, z);
    plank.rotation.z = tilt;
    plank.castShadow = !lowGfx;
    plank.receiveShadow = true;
    holder.add(plank);
    planks.push(plank);
    // The seam of moonlight down the middle of the deck.
    const seam = new THREE.Mesh(seamGeo, glowMat);
    seam.position.set(0, 0.215, 0);
    seam.renderOrder = 6;
    plank.add(seam);
    glows.push(seam);
  }
  // The temple's own balustrades down both sides, raised once the last plank
  // has settled (collapsed, never hidden, until then).
  const rails = instancePlacements(
    planMoonbridgeEdges(),
    () => 0,
    lowGfx,
    'drownedTempleBridgeRails',
  );
  rails.position.set(-gate.x, 0, -gate.z);
  holder.add(rails);
  // An always-drawn carrier: the planks hide while the bridge is unmade, and
  // the gate's refresh rides the render of whatever is on screen.
  const carrier = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  carrier.frustumCulled = false;
  carrier.position.set((from + to) / 2 - gate.x, MOONBRIDGE.fromH, MOONBRIDGE.z - gate.z);
  holder.add(carrier);
  const root = new THREE.Group();
  root.rotation.y = -gate.rot;
  root.add(holder);
  return {
    root,
    apply(openness, _seal, since, forming) {
      // Forming (the Colossus just fell): the slabs build along the prism's
      // beam of moonlight, each laid as the beam's front passes it in a flash
      // that settles to the seam's steady glow (temple_moonbridge_core.ts;
      // the beam itself is temple_moonbridge_fx.ts). Otherwise the bridge
      // follows the gate's openness (found open: whole; a reset: it unmakes).
      // An unmade plank is collapsed, never hidden: every material of the
      // bridge stays in the drawn set the interior's compile gate links.
      const laid = forming ? moonbridgeLaid(from, to) : 0;
      const settle = forming
        ? Math.max(0, 1 - Math.max(0, since - laid) / MOONBRIDGE_MOMENT.hold)
        : openness >= 1
          ? Math.max(0, 1 - since / 2)
          : 1;
      let flash = 0;
      planks.forEach((p, i) => {
        const k = forming
          ? moonbridgePlankRise(i, from, to, since)
          : Math.max(0, Math.min(1, (openness - (i / planks.length) * 0.8) / 0.2));
        p.scale.y = Math.max(k, 1e-4);
        p.scale.z = k > 0.01 ? 0.4 + 0.6 * k : 1e-4;
        // Each slab flashes as it is laid: its seam blazes wide, then settles.
        const f = forming ? moonbridgePlankFlash(i, from, to, since) : 0;
        glows[i].scale.x = 0.6 + 0.4 * settle + 1.8 * f;
        if (f > flash) flash = f;
      });
      glowMat.opacity = Math.min(1, 0.45 + 0.4 * settle + 0.3 * flash);
      rails.scale.y = (forming ? since >= laid : openness > 0.97) ? 1 : 1e-4;
    },
  };
}

// ---- shared ------------------------------------------------------------------------------

/** A kit piece as a plain mesh group (gate dressing, one each). */
function kitPieceMesh(
  piece: string,
  x: number,
  z: number,
  y: number,
  rot: number,
  scale = 1,
): THREE.Group {
  const g = new THREE.Group();
  const baked = templeKitPiece(piece);
  for (const slot of ['stone', 'glow', 'glass'] as const) {
    const geo = baked[slot];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, templeSlotMaterial(slot));
    mesh.castShadow = slot === 'stone' && !!GFX.standardMaterials;
    mesh.receiveShadow = slot === 'stone';
    g.add(mesh);
  }
  g.position.set(x, y, z);
  g.rotation.y = rot;
  g.scale.setScalar(scale);
  return g;
}

/**
 * Every gate structure of one slot, driven by the gate memory of the slot
 * anchored at (ox, oz). Returns the group (instance-local frame).
 */
export function buildTempleGates(
  ox: number,
  oz: number,
  ground: (x: number, z: number) => number,
  lowGfx = false,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleGates';
  for (const gate of DROWNED_TEMPLE_GATES) {
    const key = gateMemoryKey(ox, oz, gate.id);
    const rig =
      gate.kind === 'water_veil'
        ? waterVeil(gate)
        : gate.kind === 'sunken_stair'
          ? sunkenStair(gate, lowGfx)
          : gate.kind === 'light_bridge'
            ? moonbridge(gate, lowGfx)
            : gate.kind === 'rite_ward'
              ? riteWard(gate)
              : wardedArch(gate, gate.id === 'prism_ward' ? 0xb9a6ff : 0xc8d8ff);
    const holder = new THREE.Group();
    holder.name = `gate:${gate.id}`;
    const gy =
      gate.kind === 'sunken_stair' || gate.kind === 'light_bridge' ? 0 : ground(gate.x, gate.z);
    holder.position.set(gate.x, gy, gate.z);
    holder.rotation.y = gate.rot;
    holder.add(rig.root);
    // Every mesh of the rig carries the refresh (whichever is on screen drives
    // it), but it runs once a frame: the first mesh drawn applies the pose.
    let applied = -1;
    const refresh = () => {
      const now = sharedUniforms.uTime.value;
      if (now === applied) return;
      applied = now;
      const view = gateView(key, now);
      const seal = view.state === 'sealed' ? 0.7 + 0.3 * Math.sin(now * 5) : 0;
      // A watched opening plays its moment once; after it the gate is whole.
      const forming =
        view.state === 'open' && view.changed && view.since < MOONBRIDGE_MOMENT_SECONDS;
      rig.apply(view.openness, seal, view.since, forming);
    };
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).onBeforeRender = refresh;
    });
    group.add(holder);
  }
  return group;
}

/** The on-screen openness of one of this slot's gates (the pool drains with
 *  the Prism Stair's rise). */
export function templeGateOpenness(ox: number, oz: number, gateId: string): number {
  return gateView(gateMemoryKey(ox, oz, gateId), sharedUniforms.uTime.value).openness;
}
