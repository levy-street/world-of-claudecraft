// The Buried Hoard reward chest: the Blender-authored model plus the ceremony
// around it (arrival, the waiting chest that can barely hold its light, the
// opening). Every number comes from hoard_reward_chest_core.ts.
//
// Same contract as its sibling hoard_entrance.ts: no scene attachment and no
// lights here, the renderer owns the body and its lifetime, and the first draw
// is protected by the entity compile gate. The body drives itself from one
// onBeforeRender callback, so a culled or removed chest costs nothing.
//
// What is Blender and what is runtime: the chest, its lid on a hinge, the clasp
// and the glowing inlays are the model. Rarity colour, the light leak, rays,
// motes, the ground pool, the arrival and the opening are runtime, because they
// depend on the map's rarity and on the moment, and because one model then
// serves every rarity. No dynamic light is used: the glow is emissive surfaces
// and additive cards, which the point-light budget never has to pay for.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import type { Entity } from '../sim/types';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import {
  CHEST_RARITY,
  CHEST_TUNING,
  type ChestMotePose,
  type ChestRarityProfile,
  type ChestRayPose,
  chestIdle,
  chestMote,
  chestMoteCount,
  chestOpen,
  chestRarity,
  chestRay,
  chestSpawn,
} from './hoard_reward_chest_core';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const URL = '/models/props/hoard_reward_chest.glb';
export const HOARD_REWARD_CHEST_TEMPLATES = ['hoard_reward_chest', 'hoard_reward_chest_open'];

let source: THREE.Group | undefined;
if (typeof window !== 'undefined')
  registerDeferredPreload(async () => {
    source = (await loadGltf(URL)).scene;
  });
export const hoardRewardChestPreloadInternalsForTest = { urls: [URL] };

const plane = markSharedGeometry(new THREE.PlaneGeometry(1, 1));
const disc = markSharedGeometry(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2));
const column = markSharedGeometry(
  new THREE.CylinderGeometry(0.5, 1, 1, 24, 1, true).translate(0, 0.5, 0),
);
const box = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));

type CardKind = 'glow' | 'ray' | 'ring' | 'column';
const cardMaterials = new Map<CardKind, THREE.ShaderMaterial>();

/** Soft additive cards. One shared material per shape; each mesh pushes its own
 *  tint and alpha from onBeforeRender, so nothing is cloned per chest. */
function cardMaterial(kind: CardKind): THREE.ShaderMaterial {
  let material = cardMaterials.get(kind);
  if (material) return material;
  const shape = {
    // A pool of light: bright heart, long soft falloff.
    glow: 'float d = length((vUv-.5)*2.); float a = pow(max(0.,1.-d),2.2);',
    // A wedge of light: born at the gap, widening and thinning as it climbs.
    ray: 'float w = mix(.18,1.,vUv.y); float s = 1.-smoothstep(0.,w,abs(vUv.x-.5)*2.); float a = s*s*pow(1.-vUv.y,1.6)*smoothstep(0.,.08,vUv.y);',
    // A shockwave: a thin bright band at the rim.
    ring: 'float d = length((vUv-.5)*2.); float a = smoothstep(.62,.9,d)*(1.-smoothstep(.9,1.,d));',
    // The burst the chest appears inside: bright at the ground, gone by the top.
    column: 'float a = pow(1.-vUv.y,1.4)*.85;',
  }[kind];
  material = markSharedMaterial(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { tint: { value: new THREE.Color(0xffffff) }, alpha: { value: 1 } },
      vertexShader:
        'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec2 vUv; uniform vec3 tint; uniform float alpha;
        void main(){ ${shape} gl_FragColor = vec4(tint*a*alpha, a*alpha); }`,
    }),
  );
  material.name = `HoardRewardChest:${kind}`;
  cardMaterials.set(kind, material);
  return material;
}

let moteMaterial: THREE.ShaderMaterial | undefined;
function motesMaterial(): THREE.ShaderMaterial {
  moteMaterial ??= markSharedMaterial(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { tint: { value: new THREE.Color(0xffffff) }, pixelScale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vAlpha; uniform float pixelScale;
        void main(){ vAlpha = alpha; vec4 mv = modelViewMatrix*vec4(position,1.);
        gl_PointSize = size*pixelScale/max(.1,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vAlpha; uniform vec3 tint;
        void main(){ float d = length(gl_PointCoord-.5)*2.; float a = pow(max(0.,1.-d),1.8)*vAlpha;
        gl_FragColor = vec4(mix(tint,vec3(1.),a*.6)*a, a); }`,
    }),
  );
  moteMaterial.name = 'HoardRewardChest:motes';
  return moteMaterial;
}

interface Card {
  mesh: THREE.Mesh;
  tint: THREE.Color;
  alpha: number;
}

function card(parent: THREE.Object3D, kind: CardKind, geometry: THREE.BufferGeometry): Card {
  const mesh = new THREE.Mesh(geometry, cardMaterial(kind));
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  const state: Card = { mesh, tint: new THREE.Color(0xffffff), alpha: 0 };
  mesh.onBeforeRender = () => {
    const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
    uniforms.tint.value.copy(state.tint);
    uniforms.alpha.value = state.alpha;
    (mesh.material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
  };
  parent.add(mesh);
  return state;
}

/** A stand-in while the model is still loading: same footprint, same pivot. */
function fallback(): THREE.Group {
  const root = new THREE.Group();
  const wood = surfaceMat({ color: 0x54260f });
  const base = new THREE.Mesh(box, wood);
  base.name = 'Chest_Base';
  base.scale.set(1.5, 0.62, 0.96);
  base.position.y = 0.33;
  const lid = new THREE.Mesh(box, wood);
  lid.name = 'Chest_Lid';
  lid.scale.set(1.6, 0.4, 1.06);
  lid.position.y = 0.84;
  root.add(base, lid);
  return root;
}

/** The orchestrator's optional body override: null for every other object. */
export function hoardRewardChest(entity: Entity, reducedMotion: () => boolean) {
  return HOARD_REWARD_CHEST_TEMPLATES.includes(entity.templateId)
    ? buildHoardRewardChest(entity, reducedMotion, source)
    : null;
}

export function buildHoardRewardChest(
  entity: Pick<Entity, 'templateId' | 'vaultRarity'>,
  reducedMotion: () => boolean,
  asset: THREE.Group | undefined = source,
): { body: THREE.Group; portal?: THREE.Mesh } {
  const fx = resolveUiEffectsProfile({
    presetLabel: GFX.tier,
    effectsQuality: 1,
    reduceMotion: reducedMotion(),
  });
  const low = fx.tier === 'low';
  const rarity = chestRarity(entity.vaultRarity);
  const profile: ChestRarityProfile = CHEST_RARITY[rarity];
  const opened = entity.templateId === 'hoard_reward_chest_open';
  const tint = new THREE.Color(profile.color);

  const body = new THREE.Group();
  body.name = 'hoardRewardChest';
  const rig = new THREE.Group();
  rig.scale.setScalar(CHEST_TUNING.CHEST_SCALE);
  body.add(rig);
  const model = asset ? asset.clone(true) : fallback();
  rig.add(model);
  model.updateMatrixWorld(true);

  // The model wears the game's own surface material; the two named glow
  // materials take the rarity colour. Geometry belongs to the cached asset.
  const glowing: THREE.MeshStandardMaterial[] = [];
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    // It casts its shadow on the floor but never takes shadows itself: the lid's
    // broad flat faces self-shadowed into stripes that crawled as the camera (and
    // the shadow map that follows it) moved (playtest).
    node.castShadow = true;
    node.receiveShadow = false;
    if (asset) markSharedGeometry(node.geometry);
    const convert = (material: THREE.Material) => {
      const original = material as THREE.MeshStandardMaterial;
      const glow = material.name === 'Glow' || material.name === 'InnerGlow';
      const converted = surfaceMat({
        color: glow ? profile.color : original.color?.getHex(),
        metalness: original.metalness,
        roughness: original.roughness,
        // The wood, iron and brass are lit a little in their OWN colour, so the
        // chest reads in a dark room without turning into a glowing box: the
        // rarity colour stays where the light is, inside and at the seams.
        emissive: glow ? profile.color : original.color?.getHex(),
        emissiveIntensity: glow ? 1 : CHEST_TUNING.BOUNCE_LIGHT,
      });
      if (!converted.name) converted.name = `HoardRewardChest:${material.name || 'Surface'}`;
      // The glow faces sit flush on the wood inside the lid; pulled a hair toward
      // the camera they always win, instead of fighting the wood in stripes that
      // shift as the camera moves (playtest).
      if (glow) {
        converted.polygonOffset = true;
        converted.polygonOffsetFactor = -1;
        converted.polygonOffsetUnits = -2;
      }
      if (glow && 'emissiveIntensity' in converted) {
        converted.userData.chestInner = material.name === 'InnerGlow';
        glowing.push(converted as THREE.MeshStandardMaterial);
      }
      return converted;
    };
    node.material = Array.isArray(node.material)
      ? node.material.map(convert)
      : convert(node.material);
  });

  // The shipped GLB is quantized, which moves node origins: hang the lid on a
  // hinge of our own, at the authored hinge line, keeping its world pose.
  const hinge = new THREE.Group();
  hinge.name = 'Chest_LidHinge';
  hinge.position.set(0, CHEST_TUNING.HINGE_Y, CHEST_TUNING.HINGE_Z);
  model.add(hinge);
  hinge.updateMatrixWorld(true);
  const lid = model.getObjectByName('Chest_Lid');
  if (lid) hinge.attach(lid);

  // ---- the light around it (all shed on the low tier except the model's own glow)
  const effects = new THREE.Group();
  body.add(effects);
  const s = CHEST_TUNING.CHEST_SCALE;
  const pool = card(effects, 'glow', disc);
  pool.mesh.position.y = 0.04;
  const seam = card(effects, 'glow', plane);
  const ringCard = card(effects, 'ring', disc);
  ringCard.mesh.position.y = 0.06;
  const burst = card(effects, 'column', column);
  const rays: Card[] = [];
  if (!low)
    for (let i = 0; i < profile.rays; i++) {
      rays.push(card(effects, 'ray', plane));
    }
  for (const item of [pool, seam, ringCard, burst, ...rays]) item.tint.copy(tint);

  const moteCount = low ? 0 : chestMoteCount(profile);
  let motes: THREE.Points | undefined;
  let motePosition: THREE.BufferAttribute | undefined;
  let moteSize: THREE.BufferAttribute | undefined;
  let moteAlpha: THREE.BufferAttribute | undefined;
  if (moteCount > 0) {
    const geometry = new THREE.BufferGeometry();
    motePosition = new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3);
    moteSize = new THREE.BufferAttribute(new Float32Array(moteCount), 1);
    moteAlpha = new THREE.BufferAttribute(new Float32Array(moteCount), 1);
    for (const attribute of [motePosition, moteSize, moteAlpha])
      attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', motePosition);
    geometry.setAttribute('size', moteSize);
    geometry.setAttribute('alpha', moteAlpha);
    motes = new THREE.Points(geometry, motesMaterial());
    motes.frustumCulled = false;
    motes.renderOrder = 22;
    motes.onBeforeRender = () => {
      motesMaterial().uniforms.tint.value.copy(tint);
      motesMaterial().uniformsNeedUpdate = true;
    };
    effects.add(motes);
  }

  let start = -1;
  let last = -1;
  const mote: ChestMotePose = { x: 0, y: 0, z: 0, size: 0, alpha: 0 };
  const rayPose: ChestRayPose = { yaw: 0, lean: 0, length: 0, width: 0, alpha: 0 };
  const lidZ = (CHEST_TUNING.HINGE_Z + 0.96) * s;
  const seamY = CHEST_TUNING.HINGE_Y * s + 0.03;

  // The pool is always drawn (every tier), so it is the body's clock. It starts
  // only after the entity gate reveals the body and stops when the body is culled.
  const drive = pool.mesh.onBeforeRender;
  pool.mesh.onBeforeRender = (...args) => {
    drive.apply(pool.mesh, args);
    const time = sharedUniforms.uTime.value;
    if (time === last) return;
    last = time;
    if (start < 0) start = time;
    const age = time - start;
    const calm = reducedMotion();

    let lidAngle: number;
    let glow: number;
    let leak: number;
    let gather = 0;
    let reveal = 1;
    let lift = 0;
    let squash = 1;
    let shakeX = 0;
    let shakeZ = 0;
    ringCard.alpha = 0;
    burst.alpha = 0;
    let flash = 0;
    if (opened) {
      const plan = chestOpen(age, profile, calm);
      lidAngle = plan.lidAngle;
      glow = plan.glow;
      leak = plan.leak;
      flash = plan.burst * 0.6;
      ringCard.alpha = plan.burst * 0.8;
      ringCard.mesh.scale.setScalar(1.2 + (1 - plan.burst) * 2.4);
    } else {
      const spawn = chestSpawn(age, calm);
      const idle = chestIdle(time, profile, calm);
      const settled = spawn.done ? 1 : spawn.reveal;
      lidAngle = idle.lidAngle * settled;
      glow = idle.glow * (0.25 + 0.75 * settled) + spawn.flash * profile.intensity;
      leak = idle.leak * settled;
      if (!spawn.done) {
        gather = spawn.gather;
        reveal = spawn.reveal;
        lift = spawn.lift;
        squash = spawn.squash;
        flash = spawn.flash;
        ringCard.alpha = spawn.ring;
        ringCard.mesh.scale.setScalar(spawn.ringRadius);
        burst.alpha = spawn.column * 0.75 * profile.intensity;
        burst.mesh.scale.set(1.5, 5.5 * (0.5 + spawn.column * 0.5), 1.5);
        pool.alpha = spawn.ground * 0.5 * profile.intensity;
      } else {
        shakeX = idle.shakeX;
        shakeZ = idle.shakeZ;
      }
    }

    // The chest itself: appears from nothing, drops, lands with a little weight.
    rig.visible = reveal > 0.001;
    rig.scale.set(s * reveal, s * reveal * squash, s * reveal);
    rig.position.set(shakeX, lift, shakeZ);
    hinge.rotation.x = -THREE.MathUtils.degToRad(lidAngle);
    for (const material of glowing) {
      material.emissiveIntensity =
        (material.userData.chestInner ? CHEST_TUNING.INNER_GLOW_INTENSITY : 1.1) * glow;
    }

    // Light hierarchy: an intense heart inside, a leak at the seam, a soft pool
    // outside. The brightest thing is always inside the chest.
    const open01 = Math.min(1, lidAngle / 60);
    if (opened || chestSpawn(age, calm).done) pool.alpha = (0.42 + 0.3 * leak) * profile.intensity;
    pool.mesh.scale.setScalar(3.0 + leak * 0.7 + flash * 1.6);
    seam.alpha = Math.min(1.5, leak * 0.85 + flash) * (low ? 0.6 : 1);
    seam.mesh.position.set(shakeX, seamY + lift + open01 * 0.5, lidZ * (1 - open01 * 0.6));
    seam.mesh.scale.set(3.0 * s, (0.5 + open01 * 1.8 + flash * 1.4) * s, 1);

    for (let i = 0; i < rays.length; i++) {
      chestRay(i, rays.length, time, leak * (opened ? 1.5 : 1), rayPose);
      const ray = rays[i];
      ray.alpha = rayPose.alpha * reveal;
      // Rays stand in the gap and fan forward and sideways out of it.
      ray.mesh.position.set(
        Math.sin(rayPose.yaw) * 0.55 * s,
        seamY + lift + rayPose.length * 0.5 * Math.cos(rayPose.lean),
        lidZ * (1 - open01 * 0.7) +
          Math.cos(rayPose.yaw) * rayPose.length * 0.5 * Math.sin(rayPose.lean),
      );
      ray.mesh.rotation.set(
        rayPose.lean * Math.cos(rayPose.yaw),
        rayPose.yaw * 0.6,
        -rayPose.lean * Math.sin(rayPose.yaw),
      );
      ray.mesh.scale.set(rayPose.width, rayPose.length, 1);
    }

    if (motes && motePosition && moteSize && moteAlpha) {
      for (let i = 0; i < moteCount; i++) {
        chestMote(i, time, profile, gather, mote);
        motePosition.setXYZ(i, mote.x + shakeX, mote.y + lift, mote.z + lidZ * 0.35 * (1 - gather));
        moteSize.setX(i, mote.size);
        moteAlpha.setX(i, mote.alpha * Math.max(gather, reveal) * (calm ? 0.6 : 1));
      }
      motePosition.needsUpdate = true;
      moteSize.needsUpdate = true;
      moteAlpha.needsUpdate = true;
    }
    body.updateMatrixWorld(true);
  };

  body.userData.hoardChestRarity = rarity;
  body.userData.hoardChestOpened = opened;
  // Where its label floats: just over the lid, not up where a door's would.
  body.userData.labelHeight = 2.3;
  return { body };
}
