import { CONTACT_SHEETS, contactTexture } from './contact_assets';
import {
  bakedTexture,
  warriorBloodTexture,
  warriorPressureTexture,
  warriorRockTexture,
  warriorSteelTexture,
} from './production_assets';
// The SAFE half of the ability-VFX boot warm-up, expressed as explicit small
// units the renderer can run outside its world-entry window.
//
// AbilityVfxFx.prewarmSpawn is the boot-window warm-up: it spawns one of every
// pooled primitive so the loading-screen frames draw them. That spawn can only
// ever run BEHIND the loading screen, because a resumed one would pop a white
// ring/decal/flipbook burst at the player's feet in a live frame. What CAN run
// live is everything the spawn was really paying for:
//
//   - the six 8x8 impact sheets, each a procedurally drawn 512px canvas that is
//     otherwise generated on the first impact of that school (the measured
//     mid-combat stall on phone-class profiles, where the whole
//     vfx.ability-primitives entry is skipped by the constrained manifest), and
//     the shared canvas set every pool binds;
//   - the pooled primitives' program links, one small ShaderMaterial at a time.
//
// Both are idempotent and invisible: building a sheet paints nothing, and a
// compile only links a program for a mesh that stays visible=false until its
// first real spawn. Renderer.prewarmInitialScene turns these steps into
// PrewarmResumeUnits (see prewarm_resume.ts).

import type * as THREE from 'three';
import { abilityVfxTextures, FLIPBOOK_STYLES, flipbookSheet } from './fx_textures';

export interface AbilityVfxPrewarmTextureStep {
  id: string;
  /** Builds (memoized in fx_textures) and returns the textures this step warms. */
  build: () => THREE.Texture[];
}

export interface AbilityVfxCompileTarget {
  id: string;
  object: THREE.Object3D;
}

/**
 * One unit per procedurally drawn impact sheet, plus one for the shared canvas
 * set. The sheets are deliberately separate: each is an independent 64-frame
 * canvas draw, and the whole point of the resume lane is that no single unit
 * blocks a live frame for long.
 */
export function abilityVfxTexturePrewarmSteps(): AbilityVfxPrewarmTextureStep[] {
  // Analytic Shaman contacts use the prepared contact_cut binding, not atlases.
  const steps: AbilityVfxPrewarmTextureStep[] = FLIPBOOK_STYLES.filter(
    (style) => !style.startsWith('shaman_'),
  ).map((style) => ({
    id: `flipbook:${style}`,
    build: () => [flipbookSheet(style)],
  }));
  steps.push({
    id: 'shared-canvases',
    // Cached shared canvases, including the 4 MiB Shaman fracture. One unit
    // avoids repeatedly entering the shared builder; nothing is drawn here.
    build: () => Object.values(abilityVfxTextures()),
  });
  for (const kind of CONTACT_SHEETS)
    steps.push({
      id: kind,
      build: () => {
        const texture = contactTexture(kind);
        return texture ? [texture] : [];
      },
    });
  for (const kind of [
    'smoke',
    'shockwave',
    'shout_dust',
    'warrior_power',
    'warrior_fervor',
    'harvest_impact',
    'warrior_bite',
    'warrior_shear',
    'warrior_crush',
  ] as const)
    steps.push({
      id: kind,
      build: () => {
        const texture = bakedTexture(kind);
        return texture ? [texture] : [];
      },
    });
  for (const [id, load] of [
    ['warrior-blood', warriorBloodTexture],
    ['warrior-pressure', warriorPressureTexture],
    ['warrior-rock', warriorRockTexture],
    ['warrior-steel', warriorSteelTexture],
  ] as const)
    steps.push({
      id,
      build: () => {
        const texture = load();
        return texture ? [texture] : [];
      },
    });
  return steps;
}

/**
 * Program identity for dedupe purposes. A pool that clones one prototype
 * material per slot (the six flipbook slots) links ONE program for the set,
 * because three derives a ShaderMaterial's program key from its shader source
 * plus defines. Everything else falls back to material identity, which is the
 * conservative answer: an extra unit only costs an idle slot and a cache hit,
 * while a missed one is a link left for combat.
 */
function programIdentity(material: THREE.Material): string {
  const shader = material as THREE.ShaderMaterial;
  if (!shader.isShaderMaterial) return `material:${material.uuid}`;
  // material.type separates the raw and non-raw variants, which compile
  // differently from the same source.
  return `shader:${material.type}|${shader.vertexShader}|${shader.fragmentShader}|${JSON.stringify(shader.defines ?? null)}`;
}

/**
 * Pooled VFX meshes reachable from `root`, one per distinct program: the
 * compile unit only needs SOME mesh carrying that program, and the pools stamp
 * the renderCategory tag the scene-census diagnostics also key off. Objects
 * without a material (a spirit holder group) carry no program of their own.
 */
/** The distinct materials the compile targets carry, in the same walk: the
 *  cast readiness gate asks whether each one's program is linked. */
export function abilityVfxCompileMaterials(root: THREE.Object3D): THREE.Material[] {
  const seen = new Set<string>();
  const materials: THREE.Material[] = [];
  root.traverse((child) => {
    if (child.userData?.renderCategory !== 'vfx') return;
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    for (const mat of Array.isArray(material) ? material : [material]) {
      const identity = programIdentity(mat);
      if (seen.has(identity)) continue;
      seen.add(identity);
      materials.push(mat);
    }
  });
  return materials;
}

export function collectAbilityVfxCompileTargets(root: THREE.Object3D): AbilityVfxCompileTarget[] {
  const seen = new Set<string>();
  const targets: AbilityVfxCompileTarget[] = [];
  root.traverse((child) => {
    if (child.userData?.renderCategory !== 'vfx') return;
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    const mats = Array.isArray(material) ? material : [material];
    let fresh = false;
    for (const mat of mats) {
      const identity = programIdentity(mat);
      if (seen.has(identity)) continue;
      seen.add(identity);
      fresh = true;
    }
    if (!fresh) return;
    targets.push({ id: `${child.name || child.type}:${targets.length}`, object: child });
  });
  return targets;
}

/** The successful boot path and resumed path have the same texture contract.
 * A visible pool has fewer slots than sheet styles; walking its final bindings
 * cannot prove that every cached sheet and registry-only decal is resident. */
export function abilityVfxBootTextureDependencies(): THREE.Texture[] {
  return [...new Set(abilityVfxTexturePrewarmSteps().flatMap((step) => step.build()))];
}
