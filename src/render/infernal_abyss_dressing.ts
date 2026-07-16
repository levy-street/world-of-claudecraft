// Infernal Abyss authored dressing. The room graph and collision radii live in
// sim/dungeon_layout.ts; this module only turns those decor records into visuals.
import * as THREE from 'three';
import type { DungeonLayout } from '../sim/dungeon_layout';
import type { AuthoredDecor } from '../sim/dungeon_rooms';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { sharedUniforms } from './gfx';

const PROP_URLS: Record<string, string> = {
  abyssal_heart_altar: 'models/props/abyssal_heart_altar.glb',
  infernal_forge_anvil: 'models/props/infernal_forge_anvil.glb',
  chained_demon_obelisk: 'models/props/chained_demon_obelisk.glb',
  lost_armory_weapon_rack: 'models/props/lost_armory_weapon_rack.glb',
  lava_brazier: 'models/props/lava_brazier.glb',
  infernal_furnace: 'models/props/monumental_infernal_furnace.glb',
  demonic_basalt_throne: 'models/props/horned_basalt_demon_throne.glb',
  volcanic_spire_cluster: 'models/props/volcanic_magma_spire_cluster.glb',
  infernal_portcullis: 'models/props/infernal_horned_portcullis.glb',
  infernal_chain_crane: 'models/props/infernal_forge_chain_crane.glb',
  gladiator_chain_gantry: 'models/props/gladiator_chain_weapon_clutter.glb',
  modular_lava_maze_wall: 'models/props/modular_lava_maze_wall.glb',
  abyss_giant_demonic_skull_gate: 'models/props/abyss_giant_demonic_skull_gate.glb',
  abyss_basalt_lavafall_shrine: 'models/props/abyss_basalt_lavafall_shrine.glb',
  abyss_cracked_obsidian_floor_plate: 'models/props/abyss_cracked_obsidian_floor_plate.glb',
  abyss_battlefield_debris_cluster: 'models/props/abyss_battlefield_debris_cluster.glb',
  abyss_molten_crucible: 'models/props/abyss_molten_crucible.glb',
  abyss_infernal_tongs_rack: 'models/props/abyss_infernal_tongs_rack.glb',
  abyss_forge_bellows_pipes: 'models/props/abyss_forge_bellows_pipes.glb',
  abyss_armory_crates_pile: 'models/props/abyss_armory_crates_pile.glb',
  abyss_wall_weapon_display: 'models/props/abyss_wall_weapon_display.glb',
  abyss_gladiator_spectator_stand: 'models/props/abyss_gladiator_spectator_stand.glb',
  abyss_hanging_chain_cage: 'models/props/abyss_hanging_chain_cage.glb',
  abyss_horned_guardian_statue: 'models/props/abyss_horned_guardian_statue.glb',
  abyss_demonic_basalt_buttress: 'models/props/abyss_demonic_basalt_buttress.glb',
  abyss_furnace_demon_wall_relief: 'models/props/abyss_furnace_demon_wall_relief.glb',
  abyss_torn_chained_war_banner: 'models/props/abyss_torn_chained_war_banner.glb',
  abyss_skull_bone_ossuary_pile: 'models/props/abyss_skull_bone_ossuary_pile.glb',
  abyss_molten_ingot_mold_pile: 'models/props/abyss_molten_ingot_mold_pile.glb',
  abyss_arena_chain_carnage_clutter: 'models/props/abyss_arena_chain_carnage_clutter.glb',
  abyss_horned_wall_sconce: 'models/props/abyss_horned_wall_sconce.glb',
  abyss_magma_crystal_cluster: 'models/props/abyss_magma_crystal_cluster.glb',
};

const sources = new Map<string, THREE.Object3D>();
let assetsPromise: Promise<void> | null = null;
let lavaMat: THREE.ShaderMaterial | null = null;
let poolGeo: THREE.CircleGeometry | null = null;
let fissureGeo: THREE.BufferGeometry | null = null;
let moatGeo: THREE.RingGeometry | null = null;

export function ensureInfernalAbyssAssets(): Promise<void> {
  assetsPromise ??= Promise.all(
    Object.entries(PROP_URLS).map(async ([key, url]) => {
      const gltf = await loadGltf(url);
      sources.set(key, gltf.scene);
    }),
  ).then(() => undefined);
  return assetsPromise;
}

if (typeof window !== 'undefined') registerPreload(ensureInfernalAbyssAssets());

function lavaMaterial(): THREE.ShaderMaterial {
  if (lavaMat) return lavaMat;
  lavaMat = new THREE.ShaderMaterial({
    // fog: true + the fog GLSL chunks require the fog uniforms to exist:
    // refreshFogUniforms writes fogColor/fogNear/fogFar (or fogDensity) every
    // frame and crashes the whole render loop on a material that lacks them.
    // uTime stays the LIVE shared object (never cloned) so the lava animates.
    uniforms: {
      uTime: sharedUniforms.uTime,
      fogColor: { value: new THREE.Color(0x140406) },
      fogNear: { value: 1 },
      fogFar: { value: 120 },
      fogDensity: { value: 0.00025 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      #include <fog_pars_vertex>
      void main() {
        vP = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vP;
      #include <fog_pars_fragment>
      void main() {
        float a = sin(vP.x * 0.58 + uTime * 0.9 + sin(vP.y * 0.24) * 1.8);
        float b = sin(vP.y * 0.34 - uTime * 0.65 + sin(vP.x * 0.31) * 1.25);
        float crust = smoothstep(0.22, 0.82, abs(a * 0.68 + b * 0.32));
        float pulse = 0.78 + 0.22 * sin(uTime * 1.6 + vP.x * 0.3 + vP.y * 0.2);
        vec3 hot = vec3(1.0, 0.28, 0.015) * pulse;
        vec3 dark = vec3(0.16, 0.012, 0.004);
        gl_FragColor = vec4(mix(hot, dark, crust), 0.96);
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  return lavaMat;
}

function fissureGeometry(): THREE.BufferGeometry {
  if (fissureGeo) return fissureGeo;
  const slices = 18;
  const positions = new Float32Array((slices + 1) * 2 * 3);
  const uvs = new Float32Array((slices + 1) * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i <= slices; i++) {
    const t = i / slices;
    const z = -5 + t * 10;
    const center = Math.sin(t * 13.7) * 0.22 + Math.sin(t * 29.1 + 0.7) * 0.08;
    const halfWidth = 0.72 + Math.sin(t * 19.3 + 1.4) * 0.18 + Math.sin(t * 41) * 0.08;
    const left = i * 2;
    const right = left + 1;
    positions[left * 3] = center - halfWidth;
    positions[left * 3 + 1] = 0;
    positions[left * 3 + 2] = z;
    positions[right * 3] = center + halfWidth;
    positions[right * 3 + 1] = 0;
    positions[right * 3 + 2] = z;
    uvs[left * 2] = 0;
    uvs[left * 2 + 1] = t;
    uvs[right * 2] = 1;
    uvs[right * 2 + 1] = t;
    if (i < slices) {
      indices.push(left, left + 2, right, right, left + 2, right + 2);
    }
  }
  fissureGeo = new THREE.BufferGeometry();
  fissureGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  fissureGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  fissureGeo.setIndex(indices);
  fissureGeo.computeVertexNormals();
  fissureGeo.computeBoundingSphere();
  return fissureGeo;
}

// Brazier light on the pillar-torch contract (see dungeon.ts addPillarTorch):
// initial intensity 10, budget-managed via userData.baseIntensity on high tier,
// short throw on low. The braziers are the interior's primary light source; the
// lava lights below are the bonus ember wash.
const BRAZIER_LIGHT_COLOR = 0xff7a2a;
const BRAZIER_LIGHT_Y = 2.8;
const BRAZIER_LIGHT_DISTANCE = 34;
const BRAZIER_LIGHT_DISTANCE_LOW = 22;
const BRAZIER_LIGHT_INTENSITY_HIGH = 60;
// A dim warm ember ambient so no room reads pure black away from a light
// source (the global underground hemi is a cold 0.22). High tier only: low
// gfx never applies the underground dimming, so it is already readable.
const EMBER_HEMI_SKY = 0x8a3a1e;
const EMBER_HEMI_GROUND = 0x140505;
const EMBER_HEMI_INTENSITY = 0.72;
const EMBER_AMBIENT_COLOR = 0xffc19b;

function placeLava(
  group: THREE.Group,
  decor: AuthoredDecor,
  lowGfx: boolean,
  fireLights: THREE.PointLight[],
): void {
  const scale = decor.scale ?? 1;
  let geometry: THREE.BufferGeometry;
  if (decor.key === 'lava_pool') {
    poolGeo ??= new THREE.CircleGeometry(5, 40).rotateX(-Math.PI / 2);
    geometry = poolGeo;
  } else if (decor.key === 'lava_moat') {
    moatGeo ??= new THREE.RingGeometry(3.4, 5, 96).rotateX(-Math.PI / 2);
    geometry = moatGeo;
  } else {
    geometry = fissureGeometry();
  }
  const mesh = new THREE.Mesh(geometry, lavaMaterial());
  mesh.position.set(decor.x, 0.035, decor.z);
  mesh.rotation.y = decor.yaw;
  if (decor.key === 'lava_moat') {
    mesh.scale.set((decor.scaleX ?? 12) / 10, 1, (decor.scaleZ ?? 12) / 10);
  } else if (decor.key === 'lava_fissure') {
    mesh.scale.set(decor.scaleX ?? scale, 1, decor.scaleZ ?? scale);
  } else {
    mesh.scale.setScalar(scale);
  }
  mesh.renderOrder = 1;
  group.add(mesh);
  if (!lowGfx) {
    const lightScale =
      decor.key === 'lava_moat'
        ? Math.min(2.5, Math.max(decor.scaleX ?? 12, decor.scaleZ ?? 12) / 24)
        : Math.min(1.8, scale);
    const light = new THREE.PointLight(0xff4a12, 28 * lightScale, 28 + lightScale * 8, 2);
    light.position.set(decor.x, 1.1, decor.z);
    light.userData.baseIntensity = light.intensity;
    group.add(light);
    // Join the renderer's ranked point-light budget: an unbudgeted light
    // inflates numPointLights and recompiles every lit material as it streams.
    fireLights.push(light);
  }
}

function placeProp(
  group: THREE.Group,
  decor: AuthoredDecor,
  lowGfx: boolean,
  fireLights: THREE.PointLight[],
  portcullises: InfernalPortcullis[],
): void {
  const source = sources.get(decor.key);
  if (!source) return;
  const model = source.clone(true);
  model.position.set(decor.x, decor.y ?? 0, decor.z);
  model.rotation.y = decor.yaw;
  model.scale.setScalar(decor.scale ?? 1);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = !lowGfx;
    node.receiveShadow = true;
  });
  group.add(model);
  if (decor.key === 'infernal_portcullis') {
    portcullises.push({
      model,
      x: decor.x,
      z: decor.z,
      closedY: decor.y ?? 0,
      raisedY: (decor.y ?? 0) + 6.2,
      open: false,
    });
  }
  if (decor.key === 'lava_brazier' || decor.key === 'abyss_horned_wall_sconce') {
    const wallSconce = decor.key === 'abyss_horned_wall_sconce';
    const light = new THREE.PointLight(
      BRAZIER_LIGHT_COLOR,
      10,
      lowGfx
        ? wallSconce
          ? 16
          : BRAZIER_LIGHT_DISTANCE_LOW
        : wallSconce
          ? 25
          : BRAZIER_LIGHT_DISTANCE,
      2,
    );
    if (!lowGfx) {
      light.userData.baseIntensity = wallSconce ? 42 : BRAZIER_LIGHT_INTENSITY_HIGH;
    }
    light.position.set(decor.x, wallSconce ? 2.35 : BRAZIER_LIGHT_Y, decor.z);
    group.add(light);
    fireLights.push(light);
  }
}

function placeBarrierProps(group: THREE.Group, layout: DungeonLayout, lowGfx: boolean): void {
  const source = sources.get('modular_lava_maze_wall');
  if (!source) return;
  for (const barrier of layout.barriers ?? []) {
    if (barrier.style === 'pit') continue;
    const horizontal = barrier.hw >= barrier.hd;
    const length = horizontal ? barrier.hw * 2 : barrier.hd * 2;
    const count = Math.max(1, Math.round(length / 7.13));
    const segmentLength = length / count;
    for (let i = 0; i < count; i++) {
      const along = -length / 2 + segmentLength * (i + 0.5);
      const model = source.clone(true);
      model.position.set(
        horizontal ? barrier.x + along : barrier.x,
        0,
        horizontal ? barrier.z : barrier.z + along,
      );
      model.rotation.y = horizontal ? (i % 2) * Math.PI : Math.PI / 2 + (i % 2) * Math.PI;
      model.scale.x = segmentLength / 7.13;
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = !lowGfx;
        node.receiveShadow = true;
      });
      group.add(model);
    }
  }
}

export interface InfernalPortcullis {
  model: THREE.Object3D;
  x: number;
  z: number;
  closedY: number;
  raisedY: number;
  open: boolean;
}

export function placeInfernalAbyssDressing(
  group: THREE.Group,
  layout: DungeonLayout,
  lowGfx: boolean,
  fireLights: THREE.PointLight[],
): InfernalPortcullis[] {
  const portcullises: InfernalPortcullis[] = [];
  placeBarrierProps(group, layout, lowGfx);
  for (const decor of layout.decor ?? []) {
    if (decor.key === 'lava_pool' || decor.key === 'lava_fissure' || decor.key === 'lava_moat') {
      placeLava(group, decor, lowGfx, fireLights);
    } else if (decor.key === 'lava_chasm') {
    } else {
      placeProp(group, decor, lowGfx, fireLights, portcullises);
    }
  }
  if (!lowGfx) {
    const ember = new THREE.HemisphereLight(
      EMBER_HEMI_SKY,
      EMBER_HEMI_GROUND,
      EMBER_HEMI_INTENSITY,
    );
    group.add(ember);
  }
  group.add(new THREE.AmbientLight(EMBER_AMBIENT_COLOR, lowGfx ? 0.42 : 0.68));
  return portcullises;
}
