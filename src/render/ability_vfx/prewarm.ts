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

import * as THREE from 'three';
import { HunterShellskinVisual, shellskinMaterial } from '../hunter_shellskin_visual';
import { hunterTrapMaterial } from '../hunter_trap_geometry';
import { HunterTrapVisuals } from '../hunter_trap_visual';
import { PaladinAegisVisual } from '../paladin_aegis_visual';
import { syncPaladinAvengingWrathVisual } from '../paladin_avenging_wrath_visual';
import { RuneOfPowerVisual } from '../rune_of_power_visual';
import { SupportRecipientVisual } from '../support_recipient_visual';
import { CONTACT_SHEETS, contactTexture } from './contact_assets';
import { abilityVfxTextures, FLIPBOOK_STYLES, flipbookSheet } from './fx_textures';
import {
  bakedTexture,
  warriorBloodTexture,
  warriorPressureTexture,
  warriorSteelTexture,
} from './production_assets';
import { signatureTexture } from './signature_texture';
import { liquidSurfaceMaps } from './simulation_assets';

export interface AbilityVfxPrewarmTextureStep {
  id: string;
  /** Builds (memoized in fx_textures) and returns the textures this step warms. */
  build: () => THREE.Texture[];
}

export interface AbilityVfxCompileTarget {
  id: string;
  object: THREE.Object3D;
}

/** Gated layers cannot bind their map in the boot spawn before upload. Prepare
 * this small explicit dependency first, including observers of other classes. */
export function abilityVfxBootTextureDependencies(): THREE.Texture[] {
  const power = bakedTexture('warrior_power');
  const harvest = bakedTexture('harvest_impact');
  return [...(power ? [power] : []), ...(harvest ? [harvest] : [])];
}

// Retain one invisible set so its linked programs stay cached between casts.
let persistentWarm: THREE.Group | null = null;
const shellskinWarmVariants = new Map<string, HunterShellskinVisual>();
const trapWarmVariants = new Map<string, HunterTrapVisuals>();
export function persistentClassVfxPrewarmGroup(): THREE.Group {
  persistentClassVfxCompileTargets();
  if (!persistentWarm) throw new Error('Persistent class prewarm group was not prepared');
  persistentWarm.visible = false;
  return persistentWarm;
}
export function persistentClassVfxCompileTargets(): AbilityVfxCompileTarget[] {
  if (!persistentWarm) {
    persistentWarm = new THREE.Group();
    persistentWarm.add(new PaladinAegisVisual().group);
    const recipient = new SupportRecipientVisual();
    recipient.update(7, 1.8, null);
    persistentWarm.add(recipient.group);
    const rune = new RuneOfPowerVisual();
    rune.sync(
      {
        id: 'prewarm',
        sourceId: 1,
        disposition: 'eligible',
        x: 0,
        z: 0,
        radius: 8,
        duration: 15,
        remaining: 15,
      },
      () => 0,
    );
    persistentWarm.add(rune.group);
    syncPaladinAvengingWrathVisual(null, persistentWarm, 1.8, true, 0, true);
  }
  // surfaceMat has distinct Standard/Lambert variants. Prepare the active
  // variant on every renderer entry, retaining already warmed variants.
  const carapaceMaterial = shellskinMaterial();
  const previous = shellskinWarmVariants.get(carapaceMaterial.type);
  if (previous?.plates.material !== carapaceMaterial) {
    previous?.dispose();
    const hunter = new HunterShellskinVisual();
    hunter.update(
      { id: 'shellskin', kind: 'shield_wall', value: 0.6, remaining: 7, duration: 8 },
      1.8,
      null,
    );
    persistentWarm.add(hunter.group);
    shellskinWarmVariants.set(carapaceMaterial.type, hunter);
  }
  const targets: AbilityVfxCompileTarget[] = [];
  const trapMaterial = hunterTrapMaterial();
  const previousTrap = trapWarmVariants.get(trapMaterial.type);
  if (previousTrap?.jaws.material !== trapMaterial) {
    previousTrap?.dispose();
    const trap = new HunterTrapVisuals(persistentWarm, () => 0);
    trap.sync([
      {
        id: 'prewarm',
        sourceId: 1,
        abilityId: 'frostjaw_trap',
        x: 0,
        z: 0,
        radius: 4,
        duration: 30,
        remaining: 29,
        armTime: 0.75,
        armRemaining: 0,
      },
    ]);
    trapWarmVariants.set(trapMaterial.type, trap);
  }
  const keys = new Set<string>();
  persistentWarm.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material || Array.isArray(mesh.material)) return;
    const key = `${object.type}:${!!(mesh as THREE.InstancedMesh).isInstancedMesh}:${!!(mesh as THREE.InstancedMesh).instanceColor}:${programIdentity(mesh.material)}`;
    if (keys.has(key)) return;
    keys.add(key);
    targets.push({ id: `class-state-prepared:${targets.length}`, object });
  });
  return targets;
}

/**
 * One unit per procedurally drawn impact sheet, plus one for the shared canvas
 * set. The sheets are deliberately separate: each is an independent 64-frame
 * canvas draw, and the whole point of the resume lane is that no single unit
 * blocks a live frame for long.
 */
export function abilityVfxTexturePrewarmSteps(): AbilityVfxPrewarmTextureStep[] {
  const steps: AbilityVfxPrewarmTextureStep[] = FLIPBOOK_STYLES.map((style) => ({
    id: `flipbook:${style}`,
    build: () => [flipbookSheet(style)],
  }));
  for (const kind of CONTACT_SHEETS)
    steps.push({
      id: kind,
      build: () => {
        const texture = contactTexture(kind);
        return texture ? [texture] : [];
      },
    });
  steps.push({
    id: 'signature-atlas',
    build: () => {
      const texture = signatureTexture();
      return texture ? [texture] : [];
    },
  });
  for (const key of ['normal', 'motion', 'lighting'] as const)
    steps.push({
      id: `liquid-surface:${key}`,
      build: () => {
        const maps = liquidSurfaceMaps();
        return maps ? [maps[key]] : [];
      },
    });
  for (const kind of [
    'smoke',
    'shout_dust',
    'warrior_power',
    'harvest_impact',
    'shockwave',
    'pyroblast',
    'frost_nova',
    'chain_heal',
  ] as const)
    steps.push({
      id: `production:${kind}`,
      build: () => {
        const texture = bakedTexture(kind);
        return texture ? [texture] : [];
      },
    });
  steps.push({
    id: 'warrior-blood',
    build: () => {
      const texture = warriorBloodTexture();
      return texture ? [texture] : [];
    },
  });
  steps.push({
    id: 'warrior-steel',
    build: () => {
      const texture = warriorSteelTexture();
      return texture ? [texture] : [];
    },
  });
  steps.push({
    id: 'warrior-pressure',
    build: () => {
      const texture = warriorPressureTexture();
      return texture ? [texture] : [];
    },
  });
  steps.push({
    id: 'shared-canvases',
    // ~140 KB of small canvases built in one memoized call, so they stay one
    // unit rather than eight that would each re-enter the same builder.
    build: () => Object.values(abilityVfxTextures()),
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
