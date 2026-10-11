// A buried timber hatch, with its first draw protected by the entity compile gate.
// No scene attachment or lights here: the renderer owns the body and its lifetime.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import type { Entity } from '../sim/types';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import {
  hoardEntranceProfile,
  hoardMotePose,
  hoardRevealPose,
  hoardRimScale,
  hoardTerrainSample,
} from './hoard_entrance_core';
import { HOARD_REWARD_CHEST_TEMPLATES, hoardRewardChest } from './hoard_reward_chest';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const URL = '/models/props/hoard_entrance.glb';
let source: THREE.Group | undefined;
if (typeof window !== 'undefined')
  registerDeferredPreload(async () => {
    source = (await loadGltf(URL)).scene;
  });
export const hoardEntrancePreloadInternalsForTest = { urls: [URL] };

const box = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
const pebble = markSharedGeometry(new THREE.IcosahedronGeometry(1, 0));
const plane = markSharedGeometry(new THREE.PlaneGeometry(1, 1));
const materials = new Map<string, THREE.Material>();

/** Every object the hoard gives a bespoke body through the override below. */
export const HOARD_BODY_IDS = ['hoard_entrance', ...HOARD_REWARD_CHEST_TEMPLATES];

/** The orchestrator's optional body override leaves every ordinary door unchanged. */
export function hoardEntrance(
  entity: Entity,
  ground: (x: number, z: number) => number,
  reducedMotion: () => boolean,
  /** The live world: a floor already running (riftFloor set) opens the entrance at once. */
  world: { readonly riftFloor: unknown } | null = null,
) {
  const alreadyOpen = world !== null && world.riftFloor !== null;
  // The hoard's other bespoke object rides the same override: the reward chest.
  return entity.templateId === 'hoard_entrance'
    ? buildHoardEntrance(entity, ground, reducedMotion, source, alreadyOpen)
    : hoardRewardChest(entity, reducedMotion);
}

function lightMaterial(color: number, shaft = false): THREE.ShaderMaterial {
  const key = `${color}:${shaft}`;
  let material = materials.get(key) as THREE.ShaderMaterial | undefined;
  if (!material) {
    material = markSharedMaterial(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          tint: { value: new THREE.Color(color) },
          alpha: { value: 1 },
        },
        vertexShader:
          'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: `varying vec2 vUv; uniform vec3 tint; uniform float alpha;
        void main(){ float edge = ${shaft ? 'pow(max(0.,sin(vUv.x*3.14159265)),2.)*pow(max(0.,1.-vUv.y),2.)*.16' : 'pow(max(0.,1.-length((vUv-.5)*2.)),2.)*.55'};
          gl_FragColor=vec4(tint,edge*alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      }),
    );
    material.name = shaft ? 'HoardEntranceLightShaft' : 'HoardEntranceGroundSpill';
    materials.set(key, material);
  }
  return material;
}

function fallback(): THREE.Group {
  const root = new THREE.Group();
  const soil = surfaceMat({ color: 0x60412a });
  const wood = surfaceMat({ color: 0x78512c });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const clump = new THREE.Mesh(pebble, soil);
    clump.position.set(Math.cos(a) * 1.65, 0.22, Math.sin(a) * 1.55);
    clump.scale.set(0.58, 0.4, 0.5);
    root.add(clump);
  }
  const hole = new THREE.Mesh(box, surfaceMat({ color: 0x100b08 }));
  hole.scale.set(2.5, 0.1, 2.1);
  hole.position.y = 0.2;
  root.add(hole);
  const hatch = new THREE.Group();
  hatch.name = 'HatchAssembly';
  hatch.position.set(0, 0.3, -1);
  const lid = new THREE.Mesh(box, wood);
  lid.scale.set(2.4, 0.16, 2);
  lid.position.z = 1;
  hatch.add(lid);
  root.add(hatch);
  return root;
}

/** Clone the immutable asset; only earth vertices are instance-owned for slope seating. */
export function buildHoardEntrance(
  entity: Pick<Entity, 'pos' | 'facing' | 'vaultRarity'>,
  ground: (x: number, z: number) => number,
  reducedMotion: () => boolean,
  asset: THREE.Group | undefined = source,
  alreadyOpen = false,
): { body: THREE.Group; portal?: THREE.Mesh } {
  const fx = resolveUiEffectsProfile({
    presetLabel: GFX.tier,
    effectsQuality: 1,
    reduceMotion: reducedMotion(),
  });
  const profile = hoardEntranceProfile(entity.vaultRarity, fx.tier);
  const body = new THREE.Group();
  body.name = 'hoardEntrance';
  const model = asset ? asset.clone(true) : fallback();
  const base = ground(entity.pos.x, entity.pos.z);
  model.position.y = base - entity.pos.y - (asset ? 0.4 : 0);
  body.add(model);
  model.updateMatrixWorld(true);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = node.receiveShadow = true;
    if (node.name === 'HoardEarthAndStone') {
      node.geometry = node.geometry.clone();
      const originalPosition = node.geometry.getAttribute('position');
      // Optimized GLBs carry normalized integer positions and decode transforms.
      // Terrain deformation needs unclamped floats in the mesh's own frame.
      const position = new THREE.Float32BufferAttribute(originalPosition.count * 3, 3);
      const inverseWorld = node.matrixWorld.clone().invert();
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(originalPosition, i).applyMatrix4(node.matrixWorld);
        const sample = hoardTerrainSample(
          entity.pos.x,
          entity.pos.z,
          entity.facing,
          vertex.x,
          vertex.z,
        );
        vertex.y += ground(sample.x, sample.z) - base;
        vertex.applyMatrix4(inverseWorld);
        position.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      node.geometry.setAttribute('position', position);
      node.geometry.computeVertexNormals();
      node.geometry.computeBoundingBox();
      node.geometry.computeBoundingSphere();
    } else markSharedGeometry(node.geometry);
    const tint = (material: THREE.Material) => {
      const original = material as THREE.MeshStandardMaterial;
      const converted = surfaceMat({
        color: material.name === 'HoardRarityMetalwork' ? profile.color : original.color?.getHex(),
        vertexColors: original.vertexColors,
        metalness: original.metalness,
        roughness: original.roughness,
        emissive: original.emissive?.getHex(),
        emissiveIntensity: original.emissiveIntensity,
      });
      if (!converted.name) converted.name = `HoardEntrance:${material.name || 'Surface'}`;
      return converted;
    };
    node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
  });
  const hatch = model.getObjectByName('HatchAssembly');
  if (hatch) hatch.rotation.x = reducedMotion() || alreadyOpen ? -1.42 : 0;
  const effects = new THREE.Group();
  effects.position.y = base - entity.pos.y + 0.08;
  body.add(effects);
  const rim = new THREE.Group();
  effects.add(rim);
  const terrainDelta = (x: number, z: number) => {
    const sample = hoardTerrainSample(entity.pos.x, entity.pos.z, entity.facing, x, z);
    return ground(sample.x, sample.z) - base;
  };
  const rimMaterial = surfaceMat({
    color: profile.color,
    emissive: profile.color,
    emissiveIntensity: 0.5,
  });
  for (const x of [-1.22, 1.22]) {
    const edge = new THREE.Mesh(box, rimMaterial);
    edge.position.set(x, 0.06 + terrainDelta(x, 0), 0);
    edge.rotation.x = -Math.atan2(terrainDelta(x, 0.925) - terrainDelta(x, -0.925), 1.85);
    edge.scale.set(0.045, 0.045, 1.85);
    rim.add(edge);
  }
  for (const z of [-0.94, 0.94]) {
    const edge = new THREE.Mesh(box, rimMaterial);
    edge.position.set(0, 0.06 + terrainDelta(0, z), z);
    edge.rotation.z = Math.atan2(terrainDelta(1.24, z) - terrainDelta(-1.24, z), 2.48);
    edge.scale.set(2.48, 0.045, 0.045);
    rim.add(edge);
  }
  const lights: THREE.Mesh[] = [];
  if (profile.glow) {
    // A draped ground spill cannot float downhill or disappear uphill.
    const glowGeometry = new THREE.PlaneGeometry(6, 5, 8, 8);
    glowGeometry.rotateX(-Math.PI / 2);
    const glowVertices = glowGeometry.getAttribute('position');
    for (let i = 0; i < glowVertices.count; i++)
      glowVertices.setY(i, terrainDelta(glowVertices.getX(i), glowVertices.getZ(i)));
    glowGeometry.computeBoundingSphere();
    const glow = new THREE.Mesh(glowGeometry, lightMaterial(0xffbf5a));
    glow.position.y = 0.02;
    effects.add(glow);
    lights.push(glow);
    for (let i = 0; i < 3; i++) {
      const shaft = new THREE.Mesh(plane, lightMaterial(0xffca72, true));
      shaft.scale.set(2.3, profile.shaftHeight, 1);
      shaft.position.y = profile.shaftHeight / 2;
      shaft.rotation.y = (i * Math.PI) / 3;
      effects.add(shaft);
      lights.push(shaft);
    }
  }
  const moteMaterial = surfaceMat({
    color: profile.color,
    emissive: profile.color,
    emissiveIntensity: 1.8,
  });
  const motes: THREE.Mesh[] = [];
  for (let i = 0; i < profile.motes; i++) {
    const mote = new THREE.Mesh(pebble, moteMaterial);
    mote.scale.setScalar(0.017 + (i % 3) * 0.005);
    effects.add(mote);
    motes.push(mote);
  }
  const dirt: THREE.Mesh[] = [];
  if (!reducedMotion())
    for (let i = 0; i < 12; i++) {
      const clod = new THREE.Mesh(pebble, surfaceMat({ color: 0x745038 }));
      clod.scale.setScalar(0.06 + (i % 3) * 0.035);
      effects.add(clod);
      dirt.push(clod);
    }
  let start = -1,
    last = -1;
  let lightAlpha = alreadyOpen ? 1 : 0;
  const motePose = { x: 0, y: 0, z: 0, scale: 0 };
  for (const light of lights)
    light.onBeforeRender = () => {
      (light.material as THREE.ShaderMaterial).uniforms.alpha.value = lightAlpha;
      (light.material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
    };
  // The opaque rim is always drawn, including Low. This callback starts only after
  // the existing entity gate reveals the body, and stops naturally when culled.
  const driver = rim.children[0] as THREE.Mesh;
  driver.frustumCulled = false;
  driver.onBeforeRender = () => {
    const time = sharedUniforms.uTime.value;
    if (time === last) return;
    last = time;
    if (start < 0) start = time;
    const age = time - start,
      calm = reducedMotion();
    const pose = alreadyOpen ? { hatch: 1, light: 1, earth: 0 } : hoardRevealPose(age, calm);
    if (hatch) hatch.rotation.x = -1.42 * pose.hatch;
    rim.scale.setScalar(hoardRimScale(profile.rarity, time, calm));
    lightAlpha = pose.light;
    for (let i = 0; i < motes.length; i++) {
      hoardMotePose(i, age, profile.shaftHeight, calm, motePose);
      motes[i].position.set(motePose.x, motePose.y, motePose.z);
      motes[i].scale.setScalar(pose.light * motePose.scale);
    }
    for (let i = 0; i < dirt.length; i++) {
      const a = (i * Math.PI) / 6;
      dirt[i].position.set(
        Math.cos(a) * (1.3 + pose.earth),
        pose.earth * (2 + (i % 3)),
        Math.sin(a) * (1.15 + pose.earth),
      );
      dirt[i].visible = !alreadyOpen && !calm && age < 0.65;
    }
    body.updateMatrixWorld(true);
  };
  body.userData.hoardRarity = profile.rarity;
  body.userData.alreadyOpen = alreadyOpen;
  return { body };
}
