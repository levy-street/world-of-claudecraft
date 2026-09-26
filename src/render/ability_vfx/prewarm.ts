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
import {
  CAST_VFX_FAMILIES,
  type CastVfxFamilyId,
  castVfxFamilyBitOf,
  inCastVfxFamily,
} from '../cast_vfx_family';
import { drawProgramSignature } from '../draw_program_signature_core';
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
 * blocks a live frame for long. The Warrior kit's sheets are not here: they
 * load on demand, and every one a cast draws is uploaded by the kit's own paced
 * recipe (active_kit_prewarm.ts), on each renderer (a recycled one included),
 * for a local and a remote Warrior alike.
 */
export function abilityVfxTexturePrewarmSteps(): AbilityVfxPrewarmTextureStep[] {
  const steps: AbilityVfxPrewarmTextureStep[] = FLIPBOOK_STYLES.map((style) => ({
    id: `flipbook:${style}`,
    build: () => [flipbookSheet(style)],
  }));
  steps.push({
    id: 'shared-canvases',
    // ~140 KB of small canvases built in one memoized call, so they stay one
    // unit rather than eight that would each re-enter the same builder.
    build: () => Object.values(abilityVfxTextures()),
  });
  return steps;
}

/** One pooled draw per distinct PROGRAM under `root`, in walk order: the
 *  object whose compile links it and the material that stands for every
 *  other material on it. That representative must live as long as its pool:
 *  disposing it would release the program the uncompiled clones rely on.
 *  Keyed by drawProgramSignature, never by material
 *  instance: the verdict pools build one MeshBasicMaterial per part per slot,
 *  hundreds of instances over a handful of programs, and a clone sharing a
 *  linked program reuses it on its first draw (three's acquireProgram hands
 *  back the cached WebGLProgram, so no link). Only objects that carry the
 *  renderCategory tag themselves are pooled VFX; a spirit holder group has
 *  no material and so no program of its own. `accept` narrows the walk to
 *  one family, and `seen` carries the programs an earlier walk already took. */
function pooledPrograms(
  root: THREE.Object3D,
  accept: (object: THREE.Object3D) => boolean = () => true,
  seen: Set<string> = new Set(),
): Array<{
  object: THREE.Object3D;
  materials: THREE.Material[];
}> {
  const found: Array<{ object: THREE.Object3D; materials: THREE.Material[] }> = [];
  root.traverse((child) => {
    if (child.userData?.renderCategory !== 'vfx' || !accept(child)) return;
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    const fresh: THREE.Material[] = [];
    for (const mat of Array.isArray(material) ? material : [material]) {
      const signature = drawProgramSignature(child, mat);
      if (seen.has(signature)) continue;
      seen.add(signature);
      fresh.push(mat);
    }
    if (fresh.length > 0) found.push({ object: child, materials: fresh });
  });
  return found;
}

/** The representative material of each distinct program the cast gate
 *  waits on, family by family (cast_vfx_family.ts, in CAST_VFX_FAMILIES
 *  order), from the same walk as the compile targets: the gate asks whether
 *  each one's program is proved linked, and a proof of that program covers
 *  every clone that shares it. A program two families share is listed under
 *  the first, which every cast needing the later one needs too. The other
 *  pooled programs keep their compile units and never hold a cast. One
 *  material instance drawn by two objects of different shapes is two units
 *  but one entry here, since the gate reads one current program per
 *  material; no gated pool does that, which
 *  tests/cast_vfx_engine_family.test.ts pins. */
export function abilityVfxFamilyMaterials(
  root: THREE.Object3D,
): Map<CastVfxFamilyId, THREE.Material[]> {
  const seen = new Set<string>();
  const byFamily = new Map<CastVfxFamilyId, THREE.Material[]>();
  for (const { id } of CAST_VFX_FAMILIES) {
    const materials: THREE.Material[] = [];
    for (const entry of pooledPrograms(root, (object) => inCastVfxFamily(object, id), seen)) {
      for (const material of entry.materials) {
        if (!materials.includes(material)) materials.push(material);
      }
    }
    byFamily.set(id, materials);
  }
  return byFamily;
}

/** Every gated family's representatives, in family order. */
export function abilityVfxGateMaterials(root: THREE.Object3D): THREE.Material[] {
  return [...abilityVfxFamilyMaterials(root).values()].flat();
}

/** One compile target per distinct pooled program: the unit only needs SOME
 *  object drawing that program. The gated families come first, in family
 *  order, so the resume lane closes the gate's window before it links any
 *  other pool, and a gated drawable represents a program it shares with any
 *  other pool, so the unit and the gate entry name the same object. */
export function collectAbilityVfxCompileTargets(root: THREE.Object3D): AbilityVfxCompileTarget[] {
  const seen = new Set<string>();
  const gated = CAST_VFX_FAMILIES.flatMap(({ id }) =>
    pooledPrograms(root, (object) => inCastVfxFamily(object, id), seen),
  );
  const rest = pooledPrograms(root, (object) => castVfxFamilyBitOf(object) === 0, seen);
  return [...gated, ...rest].map((entry, index) => ({
    id: `${entry.object.name || entry.object.type}:${index}`,
    object: entry.object,
  }));
}
