// Equipment-dependent WOC far silhouettes use the existing posed static bake.
// Geometry is shared by class/gender, selected nodes, the armor files they are
// drawn from (a set's tier is its materials) and the modular head's frozen face
// (its morph influences on the far grid, woc_far_head_core.ts), never by item
// id, tint or atlas: the head's colours are tint uniforms on each character's
// own far materials (woc_far_tint.ts), resolved per baked group by the near
// dressing's rule (`tints`). The head is ONE group: every piece the merged
// material can draw is folded into it (woc_far_head.ts), so a far character is
// its body, its head, its armor's materials and nothing per face piece. Live
// visuals retain their entry; only idle entries age out. A LIVE entry holds its
// armor files resident (woc_armor_packs.ts), because its materials ARE those
// files' materials; an idle one lets go of them (so a set seen once at distance
// is still freed on time) and is re-used only while the very parse it was baked
// from is still resident. (Head files are never freed, woc_head_packs.ts.)
import * as THREE from 'three';
import {
  assembleModel,
  bakeStaticPose,
  composedFarMeshes,
  farBakeGroupKey,
  prepareVisual,
} from './assets';
import { characterMeshCastsShadow } from './shadow_policy';
import type { WocArmorFile } from './woc_armor_dressing';
import {
  releaseWocArmorOf,
  releaseWocArmorPack,
  retainWocArmorPack,
  wocArmorPackGeneration,
} from './woc_armor_packs';
import { foldWocHeadForBake, poseWocHeadForBake, setWocFarHeadSlots } from './woc_far_head';
import { WOC_FAR_HEAD_GROUP_KEY, type WocFarHeadPose, wocFarTintKey } from './woc_far_head_core';
import type { WocFarGroupTint } from './woc_far_tint';
import { wocHeadTypeForGender } from './woc_head_catalog';
import { applyWocHeadBakeVisibility, wocHeadTintTarget } from './woc_head_dressing';
import { WOC_FAR_BAKE_LOD } from './woc_lod_core';
import { applyWocPartVisibility, resolveWocPartNodes } from './woc_parts';

export interface WocFarBake {
  geo: THREE.BufferGeometry;
  shadowGeo: THREE.BufferGeometry | null;
  /** The far set's SOURCE materials: one per GROUP, then one per slot of the merged
   *  head. A slot's own material is never drawn at distance; it rides here so the
   *  one tier derivation (and the one claim set) that serves the groups serves it
   *  too, and the head's tint reads its surface off the result (woc_far_tint.ts). */
  mats: THREE.Material[];
  /** Aligned with `mats`: the body flag gating the skin/emissive override. */
  isBody: boolean[];
  /** One entry per GROUP (so its length is the group count): how that group's
   *  material is tinted. The tint its material takes on the near body
   *  (woc_head_dressing.ts wocHeadTintTarget), the merged head's slot table for
   *  the head group, or null for an untinted one. */
  tints: WocFarGroupTint[];
}

export interface WocFarBakeLease {
  bake: WocFarBake;
  release(): void;
}

interface Entry {
  bake: WocFarBake;
  refs: number;
  /** The armor files the bake's materials belong to, held resident while it is live. */
  files: readonly string[];
  /** The parse of each file it was baked from (wocArmorPackGeneration). */
  generations: readonly number[];
}
const cache = new Map<string, Entry>();
const MAX_IDLE_BAKES = 32;

/** Identity of what a far bake freezes: the drawn nodes, the armor files and the
 *  head's far pose (null: the head pack's own influences). */
export function wocFarPartsKey(
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[] = [],
  head: WocFarHeadPose | null = null,
): string {
  return JSON.stringify([[...parts].sort(), files.map((f) => f.url).sort(), head?.key ?? '']);
}

function cacheKey(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[],
  head: WocFarHeadPose | null,
): string {
  return `${key}:${wocFarPartsKey(parts, files, head)}`;
}

/** Whether an entry's materials are still the resident parses of its files. */
function current(entry: Entry): boolean {
  return entry.files.every((url, i) => wocArmorPackGeneration(url) === entry.generations[i]);
}

function drop(id: string, entry: Entry): void {
  cache.delete(id);
  entry.bake.geo.dispose();
  if (entry.bake.shadowGeo !== entry.bake.geo) entry.bake.shadowGeo?.dispose();
}

export function peekWocFarBake(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[] = [],
  head: WocFarHeadPose | null = null,
): WocFarBake | null {
  const entry = cache.get(cacheKey(key, parts, files, head));
  return entry && (entry.refs > 0 || current(entry)) ? entry.bake : null;
}

/** Idle entries hold no files, so trimming one frees only its geometry. */
function trimIdle(): void {
  let idle = 0;
  for (const entry of cache.values()) if (entry.refs === 0) idle++;
  for (const [key, entry] of cache) {
    if (idle <= MAX_IDLE_BAKES) break;
    if (entry.refs > 0) continue;
    drop(key, entry);
    idle--;
  }
}

/** Caller pays takeFarBakeBudget before a cache miss, and compiles the new
 *  mesh through gateFarMint before replacing its articulated stand-in. */
export function retainWocFarBake(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[] = [],
  head: WocFarHeadPose | null = null,
): WocFarBakeLease | null {
  const id = cacheKey(key, parts, files, head);
  let entry = cache.get(id);
  // an idle entry whose files were freed (or refetched) since draws disposed materials
  if (entry && entry.refs === 0 && !current(entry)) {
    drop(id, entry);
    entry = undefined;
  }
  if (!entry) {
    const bake = bakeWocParts(key, parts, files, head);
    if (!bake) return null;
    const urls = files.map((f) => f.url);
    entry = { bake, refs: 0, files: urls, generations: urls.map(wocArmorPackGeneration) };
    cache.set(id, entry);
  }
  // live again: hold its files resident while it draws
  if (entry.refs === 0) for (const url of entry.files) retainWocArmorPack(url);
  entry.refs++;
  const retained = entry;
  let released = false;
  return {
    bake: entry.bake,
    release() {
      if (released) return;
      released = true;
      retained.refs--;
      // Release order is the LRU order, as in the modular variant cache.
      if (retained.refs === 0) {
        cache.delete(id);
        cache.set(id, retained);
        for (const url of retained.files) releaseWocArmorPack(url);
      }
      trimIdle();
    },
  };
}

function bakeWocParts(
  key: string,
  parts: ReadonlySet<string>,
  files: readonly WocArmorFile[],
  head: WocFarHeadPose | null,
): WocFarBake | null {
  const prep = prepareVisual(key);
  const def = prep.def;
  const manifest = def.wocCharacter;
  if (!manifest) return null;
  // Held items have a separate lifetime and are absent from the part-set key,
  // exactly like composedFarMeshes' policy for the existing modular bake. The
  // armor is exactly the files the live body draws (resident: it draws them).
  // Every piece draws its FAR level (woc_lod_core.ts), whatever the detail of the
  // characters sharing the bake, so the key needs no level of its own.
  const temp = assembleModel({ ...def, attach: [] }, null, null, null, {
    skipDecals: true,
    wocArmor: files,
    wocLod: WOC_FAR_BAKE_LOD,
  });
  const skeletons = new Set<THREE.Skeleton>();
  temp.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((o as THREE.SkinnedMesh).skeleton);
  });
  const mixer = new THREE.AnimationMixer(temp);
  let scratch: THREE.BufferGeometry[] = [];
  try {
    applyWocPartVisibility(resolveWocPartNodes(temp, manifest), manifest, parts);
    // the modular head's drawn pieces ride the part set too (woc_head_dressing.ts),
    // posed with the character's frozen face (woc_far_head.ts)
    applyWocHeadBakeVisibility(temp, parts);
    scratch = poseWocHeadForBake(temp, head);
    const idle = prep.clips.get(def.clips.idle);
    if (idle) {
      mixer.clipAction(idle).play();
      mixer.update(Math.min(0.5, idle.duration * 0.5));
    }
    temp.updateMatrixWorld(true);
    for (const skeleton of skeletons) skeleton.update();
    const norm = new THREE.Matrix4()
      .makeTranslation(0, prep.yOffset, 0)
      .multiply(new THREE.Matrix4().makeRotationY(def.yaw ?? 0))
      .multiply(new THREE.Matrix4().makeScale(prep.normScale, prep.normScale, prep.normScale));
    const meshes = composedFarMeshes(temp);
    // the head pieces one material can draw share ONE group (woc_far_head.ts)
    const fold = foldWocHeadForBake(temp, meshes, scratch);
    // every other group's head tint, by the near dressing's rule, partitioning the groups
    const type = wocHeadTypeForGender(manifest.fit);
    const tintOf = new Map(meshes.map((m) => [m, wocHeadTintTarget(m, type)]));
    const baked = bakeStaticPose(norm, meshes, (m) =>
      fold?.slotOf.has(m)
        ? WOC_FAR_HEAD_GROUP_KEY
        : `${farBakeGroupKey(m)}|${wocFarTintKey(tintOf.get(m) ?? null)}`,
    );
    if (!baked.geo) return null;
    const casters = meshes.filter(characterMeshCastsShadow);
    const shadowGeo =
      casters.length === meshes.length ? baked.geo : bakeStaticPose(norm, casters).geo;
    const { mats, isBody } = baked;
    const tints: WocFarGroupTint[] = baked.slots.map((slot) => tintOf.get(meshes[slot]) ?? null);
    const headAt = fold ? baked.slots.findIndex((slot) => fold.slotOf.has(meshes[slot])) : -1;
    if (fold && headAt >= 0) {
      setWocFarHeadSlots(baked.geo, meshes, baked.order, fold.slotOf);
      // the head group draws the merged source; its slots' own materials follow the
      // groups', for the far tier to derive beside them
      const groups = mats.length;
      mats[headAt] = fold.source;
      tints[headAt] = {
        slots: fold.slots,
        sources: fold.slotSources.map((_, slot) => groups + slot),
        hairMap: fold.hairMap,
        beardMap: fold.beardMap,
        scalpMap: fold.scalpMap,
      };
      for (const material of fold.slotSources) {
        mats.push(material);
        isBody.push(false);
      }
    }
    return { geo: baked.geo, shadowGeo, mats, isBody, tints };
  } finally {
    // never drawn, so three holds nothing for them; they share the pieces' attributes and a
    // level's index list, which a drawn scratch's dispose would free under every wearer
    for (const geometry of scratch) geometry.dispose();
    mixer.stopAllAction();
    mixer.uncacheRoot(temp);
    for (const skeleton of skeletons) skeleton.dispose();
    releaseWocArmorOf(temp);
  }
}
