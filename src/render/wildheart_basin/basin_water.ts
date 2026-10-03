// The Wildheart Basin's water: the ford's ankle-deep shallows racing west over
// their basalt sill (foam peeling round the basalt steps and round anything
// big wading them), the braided river down in the gorge, the plunge pool
// churning at the Weeping Falls' foot, and the Gorgebloom's still root pool on
// its dais. One shared material draws them all
// (each mesh carries its own flow, depth and edge per vertex), built with the
// interior and linked by its compile gate.
//
// Motion is shader-side on the shared clock; the waders' wakes read a small
// uniform the encounter painter writes (BASIN_WATER_WADERS). Cosmetic only.

import * as THREE from 'three';
import { BASALT_STEPS } from '../../sim/content/wildheart_basin_layout';
import { sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import {
  BASIN_FOG_COLOR,
  BASIN_SUN_DIRECTION,
  FORD_SHEET,
  GORGEBLOOM_ROOT_POOL,
  PLUNGE_POOL,
  riverStations,
} from './basin_plan_core';
import { BASIN_NOISE_GLSL } from './basin_sky';

/** Up to four waders whose legs churn the ford (world x, z, radius, on). The
 *  encounter painter writes them each frame (the Great Saurian first). */
export const BASIN_WATER_WADERS = {
  value: [
    new THREE.Vector4(0, 0, 0, 0),
    new THREE.Vector4(0, 0, 0, 0),
    new THREE.Vector4(0, 0, 0, 0),
    new THREE.Vector4(0, 0, 0, 0),
  ],
};

const WATER_VERT = /* glsl */ `
attribute vec2 aFlow;   // flow direction * speed (yards per second)
attribute vec2 aWater;  // x: 0 mid-stream .. 1 at the bank, y: depth share (0 shallow, 1 deep)
varying vec2 vFlow;
varying vec2 vWater;
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_vertex>
void main() {
  vFlow = aFlow;
  vWater = aWater;
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec4 uSteps[3];
uniform vec4 uWaders[4];
uniform float uDetail;
varying vec2 vFlow;
varying vec2 vWater;
varying vec3 vWorld;
varying vec3 vLocal;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
void main() {
  float speed = length(vFlow);
  vec2 dir = speed > 0.001 ? vFlow / speed : vec2(1.0, 0.0);
  vec2 side = vec2(-dir.y, dir.x);
  vec2 p = vLocal.xz;
  // Coordinates that run with the current: along-stream advected, across fixed.
  vec2 q = vec2(dot(p, dir), dot(p, side));
  float t = uTime;
  vec2 adv = vec2(q.x - t * speed, q.y);
  float r1 = bnoise(adv * vec2(0.18, 0.5));
  float r2 = bnoise(adv * vec2(0.55, 1.4) + 7.0);
  float r3 = bnoise(adv * vec2(1.6, 3.2) + 13.0) * uDetail;
  // Ripple normal: long riffles across the flow plus a fine chop.
  vec2 slope = (vec2(r1 - 0.5, r2 - 0.5)) * 0.35 + (vec2(r3, bnoise(adv * 2.1 - 3.0)) - 0.5) * 0.18 * uDetail;
  vec3 n = normalize(vec3(dir.x * slope.x + side.x * slope.y, 1.0, dir.y * slope.x + side.y * slope.y));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = 0.03 + 0.97 * pow(max(1.0 - max(0.0, dot(n, view)), 0.0), 5.0);
  vec3 r = reflect(-view, n);
  // The sky it mirrors: the gold haze at the horizon, the turquoise above.
  vec3 sky = mix(uHorizon * 0.7, vec3(0.26, 0.45, 0.52), smoothstep(0.0, 0.5, r.y));
  sky += vec3(1.0, 0.8, 0.45) * pow(max(0.0, dot(normalize(r), uSunDir)), 48.0) * 0.28;
  // Body: clear jade-green shallows over the bed, deep emerald in the gorge.
  vec3 shallow = vec3(0.12, 0.27, 0.2);
  vec3 deep = vec3(0.03, 0.15, 0.13);
  vec3 body = mix(shallow, deep, vWater.y);
  // Sun glitter dancing on the riffles.
  vec3 halfV = normalize(uSunDir + view);
  float glint = pow(max(0.0, dot(n, halfV)), 300.0) * 1.6 + pow(max(0.0, dot(n, halfV)), 40.0) * 0.06;
  // Low gold-hour sun down the ford: cap the mirror so it never washes out.
  vec3 col = mix(body, sky, clamp(fres, 0.0, 0.3)) + vec3(1.0, 0.88, 0.62) * glint;
  // Streaks of current: long bright threads racing downstream.
  float thread = smoothstep(0.72, 0.95, bnoise(adv * vec2(0.08, 1.8) + 31.0));
  col += vec3(0.5, 0.62, 0.55) * thread * 0.12 * smoothstep(0.8, 2.6, speed);

  // White water: along the banks, over the riffles where it runs fast, round
  // the basalt steps (a wake peeling downstream) and round every wader.
  float churn = bnoise(adv * vec2(0.9, 2.4) + 21.0) * 0.6 + bnoise(adv * vec2(2.4, 5.0) - 4.0) * 0.4;
  float foam = smoothstep(0.9, 1.0, vWater.x) * (0.3 + 0.6 * churn);
  foam += smoothstep(0.72, 0.92, r1 * 0.6 + churn * 0.5) * smoothstep(1.5, 4.0, speed) * 0.2;
  for (int i = 0; i < 3; i++) {
    vec2 c = uSteps[i].xy;
    float rad = uSteps[i].z;
    if (rad <= 0.0) continue;
    vec2 d = p - c;
    float along = dot(d, dir);
    float across = abs(dot(d, side));
    float ring = 1.0 - smoothstep(0.0, 1.8, abs(length(d) - rad));
    // The wake: a fan of foam trailing downstream behind the step.
    float wake = smoothstep(rad * 1.1, rad * 0.3, across - max(0.0, along) * 0.18) * smoothstep(0.0, rad * 0.6, along) * (1.0 - smoothstep(rad * 1.5, rad * 4.5, along));
    foam += (ring * 0.9 + wake * 0.55) * (0.5 + 0.5 * churn);
  }
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaders[i];
    if (w.w <= 0.0) continue;
    vec2 d = vWorld.xz - w.xy;
    float dist = length(d);
    float ring = 1.0 - smoothstep(0.0, 2.2, abs(dist - w.z - 0.5 * sin(t * 3.0 - dist)));
    float splash = (1.0 - smoothstep(w.z * 0.6, w.z * 1.6, dist));
    foam += (ring * 0.8 + splash * 0.4) * w.w * (0.55 + 0.45 * churn);
  }
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.9, 0.97, 0.96), foam * 0.85);
  // Ankle-deep shallows show the bed through them; the gorge river does not.
  float alpha = mix(0.5, 0.92, vWater.y) + foam * 0.35 + fres * 0.2;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

let sharedMaterial: THREE.ShaderMaterial | null = null;

/** The one water material (built once per page, shared by every water mesh). */
export function basinWaterMaterial(lowGfx: boolean): THREE.ShaderMaterial {
  if (sharedMaterial) {
    // The tier may have changed since the first build (a uniform: no relink).
    sharedMaterial.uniforms.uDetail.value = lowGfx ? 0.4 : 1;
    return sharedMaterial;
  }
  // Only the largest drum carries the wake (the upper drums stand on it).
  const big = BASALT_STEPS[0];
  const steps = [
    new THREE.Vector4(big.x, big.z, big.r, 0),
    new THREE.Vector4(0, 0, 0, 0),
    new THREE.Vector4(0, 0, 0, 0),
  ];
  sharedMaterial = new THREE.ShaderMaterial({
    name: 'wildheartBasinWater',
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uSunDir: { value: new THREE.Vector3(...BASIN_SUN_DIRECTION) },
      uHorizon: { value: new THREE.Color(BASIN_FOG_COLOR) },
      uSteps: { value: steps },
      uWaders: BASIN_WATER_WADERS,
      uDetail: { value: lowGfx ? 0.4 : 1 },
    },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // Page-lifetime: the interior's resource sweep must never dispose it.
  markSharedMaterial(sharedMaterial);
  return sharedMaterial;
}

interface WaterBuffers {
  positions: number[];
  flow: number[];
  water: number[];
  indices: number[];
}

function geometryOf(b: WaterBuffers): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(b.flow, 2));
  geo.setAttribute('aWater', new THREE.Float32BufferAttribute(b.water, 2));
  geo.setIndex(b.indices);
  geo.computeBoundingSphere();
  return geo;
}

/** The ford's shallows: a sheet over the whole sill box, racing west. */
function fordGeometry(lowGfx: boolean): THREE.BufferGeometry {
  const f = FORD_SHEET;
  const nx = lowGfx ? 18 : 48;
  const nz = lowGfx ? 6 : 14;
  const b: WaterBuffers = { positions: [], flow: [], water: [], indices: [] };
  for (let j = 0; j <= nz; j++) {
    const v = j / nz;
    const z = f.z0 + (f.z1 - f.z0) * v;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = f.x0 + (f.x1 - f.x0) * u;
      b.positions.push(x, f.y, z);
      // Faster toward the west sill where it spills, slower in the middle.
      const speed = 1.6 + (1 - u) * 1.8;
      b.flow.push(-speed, Math.sin(u * 9 + v * 4) * 0.25);
      // The banks are the box's north and south sides.
      b.water.push(Math.abs(v - 0.5) * 2, 0.1);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      b.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return geometryOf(b);
}

/** The river in the gorge: a ribbon along its course, flowing downstream. */
function riverGeometry(lowGfx: boolean): THREE.BufferGeometry {
  const stations = riverStations(lowGfx ? 8 : 4);
  const across = lowGfx ? 4 : 8;
  const b: WaterBuffers = { positions: [], flow: [], water: [], indices: [] };
  for (let k = 0; k < stations.length; k++) {
    const s = stations[k];
    const next = stations[Math.min(stations.length - 1, k + 1)];
    const prev = stations[Math.max(0, k - 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    for (let i = 0; i <= across; i++) {
      const w = (i / across) * 2 - 1;
      // The banks of the ribbon meander a little so it never reads as a road.
      const wob = Math.sin(s.s * 0.11 + i) * 0.8;
      b.positions.push(
        -dz * (w * s.halfWidth + wob) + s.x,
        s.y,
        dx * (w * s.halfWidth + wob) + s.z,
      );
      const speed = 3.2 + Math.sin(s.s * 0.05) * 0.8;
      b.flow.push(dx * speed, dz * speed);
      b.water.push(Math.abs(w), 0.85);
    }
  }
  const row = across + 1;
  for (let k = 0; k + 1 < stations.length; k++) {
    for (let i = 0; i < across; i++) {
      const a = k * row + i;
      b.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return geometryOf(b);
}

/** The plunge pool: a disc churning outward from the fall's foot. */
function poolGeometry(lowGfx: boolean): THREE.BufferGeometry {
  const p = PLUNGE_POOL;
  const rings = lowGfx ? 5 : 10;
  const segs = lowGfx ? 24 : 48;
  const b: WaterBuffers = { positions: [], flow: [], water: [], indices: [] };
  b.positions.push(p.x, p.y, p.z);
  b.flow.push(0, 0);
  b.water.push(0, 0.7);
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * p.r;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      b.positions.push(p.x + ca * rr, p.y, p.z + sa * rr);
      // Outward from the fall, slowing toward the rim.
      const sp = 2.6 * (1 - r / rings) + 0.6;
      b.flow.push(ca * sp, sa * sp);
      b.water.push((r / rings) ** 3, 0.7);
    }
  }
  for (let i = 0; i < segs; i++) b.indices.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs;
    const b0 = a0 + segs;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      b.indices.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  return geometryOf(b);
}

/** The Gorgebloom's root pool: a still skin of water on its dais, a slow
 *  swirl round the bulb and a little foam at the rim stones. */
function rootPoolGeometry(lowGfx: boolean): THREE.BufferGeometry {
  const p = GORGEBLOOM_ROOT_POOL;
  const rings = lowGfx ? 3 : 6;
  const segs = lowGfx ? 20 : 40;
  const b: WaterBuffers = { positions: [], flow: [], water: [], indices: [] };
  b.positions.push(p.x, p.y, p.z);
  b.flow.push(0, 0);
  b.water.push(0, 0.35);
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * p.r;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      b.positions.push(p.x + ca * rr, p.y, p.z + sa * rr);
      // A lazy swirl round the bulb (tangential), stirred by the falls.
      b.flow.push(-sa * 0.45, ca * 0.45);
      b.water.push((r / rings) ** 4, 0.35);
    }
  }
  for (let i = 0; i < segs; i++) b.indices.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs;
    const b0 = a0 + segs;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      b.indices.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  return geometryOf(b);
}

/** Every water surface of the basin (instance-local), one shared material. */
export function buildBasinWater(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartBasinWater';
  const material = basinWaterMaterial(lowGfx);
  const meshes: [string, THREE.BufferGeometry][] = [
    ['wildheartFordWater', fordGeometry(lowGfx)],
    ['wildheartRiver', riverGeometry(lowGfx)],
    ['wildheartPlungePool', poolGeometry(lowGfx)],
    ['wildheartGorgebloomRootPool', rootPoolGeometry(lowGfx)],
  ];
  for (const [name, geo] of meshes) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  return group;
}
