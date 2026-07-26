// Source Cave centre seal. A single procedural shader supplies the distinct
// stone insert, etched circuit graph, occupancy-fed blue energy, red containment
// flow, the irreversible breach flare, and the post-clear wreck. The core signal
// never changes by GFX tier; composer tiers merely add bloom to the same HDR
// output.

import * as THREE from 'three';
import {
  DELVE_MODULE_Z_START,
  delveModuleStackEndRelZ,
  delveModuleZOffset,
  delveOrigin,
  delveSlotAt,
} from '../sim/data';
import { isSourceCavePos, SOURCE_CAVE_DELVE_INDEX } from '../sim/source_cave';
import type { SourceCaveInfo } from '../world_api';
import { sharedUniforms, surfaceMat } from './gfx';
import { sourceCaveSealModeNumber, sourceCaveSealVisualState } from './source_cave_seal_state';
import { sourceCaveSealStoneMaps } from './textures';

const SEAL_RADIUS = 10;
const BUILD_X_TOLERANCE = 120;
const BUILD_SOUTH_MARGIN = 70;
const SEAL_Y = 0.045;

interface SealView {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uMode;
  uniform float uOccupancy;
  uniform float uEnergy;
  uniform float uPulseSpeed;
  uniform float uFlowDirection;
  uniform float uBoundaryGlow;
  varying vec2 vUv;

  float band(float value, float centre, float width) {
    return 1.0 - smoothstep(width, width * 1.8, abs(value - centre));
  }

  // Stable per-sector noise for the wreck's burnt-out sectors. Deterministic and
  // time-independent, so which sectors died is fixed for the life of the room.
  float hash1(float n) {
    return fract(sin(n * 12.9898) * 43758.5453);
  }

  float bevelAt(float r) {
    return smoothstep(0.86, 0.94, r) * (1.0 - smoothstep(0.985, 1.0, r));
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;
    float angle = atan(p.y, p.x);
    float sector = floor((angle + 3.14159265) / 0.39269908);

    float rings = max(max(band(r, 0.22, 0.010), band(r, 0.48, 0.012)), band(r, 0.74, 0.014));
    rings = max(rings, band(r, 0.965, 0.018));
    float spokeWave = abs(sin(angle * 8.0));
    float spokes = (1.0 - smoothstep(0.0, 0.085, spokeWave)) * smoothstep(0.16, 0.24, r);
    spokes *= 1.0 - smoothstep(0.82, 0.94, r);
    float branch = 1.0 - smoothstep(0.018, 0.045, abs(sin(angle * 16.0 + r * 10.0)));
    branch *= smoothstep(0.36, 0.45, r) * (1.0 - smoothstep(0.66, 0.74, r));
    float nodes = band(r, 0.48, 0.032) * (1.0 - smoothstep(0.0, 0.22, abs(sin(angle * 8.0))));
    float circuitry = clamp(max(max(rings, spokes), max(branch, nodes)), 0.0, 1.0);

    vec3 groove = vec3(0.008, 0.012, 0.018);

    // uMode 3, the WRECK: what the room looks like once the raid has killed
    // every contributor in it. Not a shutdown and not a restore. Most of the 16
    // sectors are burnt out permanently, the few survivors smoulder on their own
    // phases, and the perimeter that used to say "do not cross" breathes as a
    // fault lamp.
    //
    // NOTHING HERE FLASHES, by construction. Every animated term is a raised
    // cosine (ease in and out, zero derivative at both ends) at well under 1 Hz,
    // and none of them reaches zero abruptly. An earlier revision drove a bright
    // ring outward from the centre on a loop; it read as violent and was a real
    // hazard for flicker-sensitive players, so it is gone rather than softened.
    //
    // ONE COLOUR FAMILY: ember orange, all of it. Mixing a cold interior with a
    // hot rim read as two unrelated effects sharing a disc. Hot-and-cooling is
    // also simply the better "I broke this" language than clean machine blue.
    // The reward beacon takes the opposite end of the spectrum instead, so the
    // two never compete (source_cave_chest_beacon.ts).
    if (uMode > 2.5) {
      float alive = step(0.74, hash1(sector));
      float arcRate = 0.6 + hash1(sector + 3.0) * 0.9;
      float arcPhase = hash1(sector + 7.0) * 6.2831853;
      float arc = 0.42 + 0.58 * (0.5 - 0.5 * cos(uTime * arcRate + arcPhase));
      float traces = circuitry * alive * arc * uEnergy;

      // Weighted low (pow > 1) so the rim spends most of the cycle dim and
      // swells smoothly rather than sitting bright: the chest across the room is
      // what should hold the eye, not the floor under the player's feet.
      // Clamped, not merely written in a range-safe shape: GLSL leaves the
      // precision of the trigonometric functions to the implementation, so
      // 0.5 - 0.5 * cos(x) is only provably >= 0 in exact arithmetic, and a
      // negative base under pow() is undefined (the shader_pow_domain rule,
      // same reasoning as the clamped twinkles base in weapon_vfx.ts).
      float breath = clamp(0.5 - 0.5 * cos(uTime * uPulseSpeed), 0.0, 1.0);
      float faultRim = band(r, 0.965, 0.030) * pow(breath, 1.7);

      vec3 wreck = vec3(1.15, 0.34, 0.06) * traces * 0.75;
      wreck += vec3(0.78, 0.14, 0.02) * faultRim;
      float wreckAlpha = max(traces * 0.62, faultRim * 0.62) + bevelAt(r) * 0.18;
      gl_FragColor = vec4(groove + wreck, clamp(wreckAlpha, 0.0, 0.9));
      return;
    }

    vec3 color = groove;
    float time = uTime * uPulseSpeed;
    float flow = 0.5 + 0.5 * sin(time * uFlowDirection + r * 24.0 + sector * 0.71);
    float heartbeat = 0.78 + 0.22 * sin(time * 1.7);

    vec3 blue = vec3(0.018, 0.38, 1.35);
    vec3 darkRed = vec3(0.24, 0.005, 0.012);
    vec3 hotRed = vec3(2.8, 0.018, 0.025);
    vec3 energyColor = blue;
    float energyStrength = uEnergy;
    if (uMode > 0.5 && uMode < 1.5) {
      energyColor = darkRed;
      energyStrength *= 0.72 + flow * 0.28;
    } else if (uMode > 1.5 && uMode < 2.5) {
      energyColor = hotRed;
      energyStrength *= 0.72 + flow * 0.55 + heartbeat * 0.25;
    } else {
      energyStrength *= 0.38 + 0.62 * flow;
    }

    float occupancyFront = smoothstep(r - 0.08, r + 0.04, uOccupancy);
    if (uMode < 0.5) energyStrength *= occupancyFront;
    float boundary = band(r, 0.965, 0.025);
    float emissiveMask = clamp(circuitry * (0.48 + flow * 0.7) + boundary * 0.85, 0.0, 1.7);
    color += energyColor * emissiveMask * energyStrength;

    float bevel = bevelAt(r);
    color += vec3(0.12, 0.15, 0.18) * bevel * 0.24;
    float alpha = circuitry * 0.34 + bevel * 0.18;
    if (uMode > 0.5 && uMode < 1.5) {
      color += vec3(0.055, 0.0, 0.006);
      alpha = max(alpha, 0.52);
    } else if (uMode > 1.5 && uMode < 2.5) {
      color += vec3(0.22, 0.0, 0.008) * (0.65 + heartbeat * 0.35);
      alpha = max(alpha, 0.34 + heartbeat * 0.12);
    }
    alpha = max(alpha, emissiveMask * energyStrength * 0.78);

    // Containment rim (uBoundaryGlow, contained phase only): a luminous
    // perimeter with a rotating six-lobe chase plus a slow breathing pulse, the
    // do-not-cross hint. Runs on raw uTime, not the slowed containment clock,
    // so the boundary stays visibly alive while the interior flow crawls.
    float rim = band(r, 0.965, 0.035);
    float rimChase = 0.62 + 0.38 * sin(angle * 6.0 - uTime * 2.6);
    float rimBreath = 0.7 + 0.3 * sin(uTime * 2.2);
    float rimStrength = rim * rimChase * rimBreath * uBoundaryGlow;
    color += vec3(1.9, 0.10, 0.08) * rimStrength;
    alpha = max(alpha, rimStrength * 0.85);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.96));
  }
`;

function buildSeal(): SealView {
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uMode: { value: 0 },
    uOccupancy: { value: 0 },
    uEnergy: { value: 0 },
    uPulseSpeed: { value: 0 },
    uFlowDirection: { value: 0 },
    uBoundaryGlow: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
  });
  material.name = 'source-cave-seal-aaa';
  const geometry = new THREE.CircleGeometry(SEAL_RADIUS, 128).rotateX(-Math.PI / 2);
  const stoneMaps = sourceCaveSealStoneMaps();
  const base = new THREE.Mesh(
    geometry,
    surfaceMat({
      color: 0xaab4c1,
      map: stoneMaps.map,
      normalMap: stoneMaps.normalMap,
      roughness: 0.88,
      metalness: 0.05,
    }),
  );
  base.receiveShadow = true;
  const energy = new THREE.Mesh(geometry, material);
  energy.position.y = 0.025;
  energy.renderOrder = 2;
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(SEAL_RADIUS * 0.965, 0.085, 10, 128).rotateX(Math.PI / 2),
    surfaceMat({ color: 0x313b47, roughness: 0.34, metalness: 0.72 }),
  );
  trim.position.y = 0.045;
  trim.castShadow = true;
  trim.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'source-cave-centre-seal';
  group.add(base, energy, trim);
  group.userData.renderCategory = 'props';
  return { group, material };
}

export class SourceCaveSealRenderer {
  private readonly views = new Map<number, SealView>();

  constructor(private readonly scene: THREE.Scene) {}

  ensureNear(
    px: number,
    pz: number,
    modules: readonly string[] | undefined,
    info: SourceCaveInfo,
  ): void {
    if (!modules?.length || !isSourceCavePos(px)) return;
    const slot = delveSlotAt(SOURCE_CAVE_DELVE_INDEX, pz, modules);
    const origin = delveOrigin(SOURCE_CAVE_DELVE_INDEX, slot);
    if (Math.abs(px - origin.x) >= BUILD_X_TOLERANCE) return;
    const endZ = origin.z + delveModuleStackEndRelZ(modules);
    if (pz < origin.z + DELVE_MODULE_Z_START - BUILD_SOUTH_MARGIN || pz > endZ) return;
    let view = this.views.get(slot);
    if (!view) {
      view = buildSeal();
      view.group.position.set(origin.x, SEAL_Y, origin.z + delveModuleZOffset(modules, 0));
      this.scene.add(view.group);
      this.views.set(slot, view);
    }
    const visual = sourceCaveSealVisualState(info);
    view.material.uniforms.uMode.value = sourceCaveSealModeNumber(visual.mode);
    view.material.uniforms.uOccupancy.value = visual.occupancy;
    view.material.uniforms.uEnergy.value = visual.energy;
    view.material.uniforms.uPulseSpeed.value = visual.pulseSpeed;
    view.material.uniforms.uFlowDirection.value = visual.flowDirection;
    view.material.uniforms.uBoundaryGlow.value = visual.boundaryGlow;
  }
}
