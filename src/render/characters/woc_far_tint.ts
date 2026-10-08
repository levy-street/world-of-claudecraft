// One WOC character's far-LOD head tints: the baked far mesh's tinted groups
// (woc_far_bake.ts WocFarBake.tints, resolved by the near dressing's own rule)
// wear the SAME tint layer the near body wears (woc_head_tint.ts), on this
// character's own clones of the shared far materials, so the chosen skin, hair,
// eye and brow colours survive the LOD swap instead of reverting to the pack's
// baked colours. The bake is shared by every character drawing the same parts,
// whatever atlas its body wears, so the body group's STRENGTH is this character's
// own (woc_skin_tint_core.ts wocTintStrength): off while its body draws a class
// under-armor atlas, exactly as on its near body.
//
// The HEAD is one group (woc_far_head.ts folds every piece one material can
// draw), and its clone wears the MERGED layer the near merged head wears: the
// four role colours as one uniform table, and one row per slot carrying what
// its own piece material would have drawn with (its tint role and reference,
// its colour, emissive, roughness and metalness, the texture it samples, the
// side it drew). The surfaces are read off the FAR tier derivation of each
// slot's own source material (the far set derives them beside the groups',
// WocFarHeadTint.sources), so a far head shades piece for piece as its groups
// did when each was a draw.
//
// Programs: the layer's GLSL is fixed per role and folded into the program key
// (`woc_head_tint|<layer>|<base key>`), so every character's far set shares ONE
// program per layer per base far program, whatever its colours (the merged layer
// has two variants: a head with a one sided slot compiles the back-face drop, an
// all two sided head does not); a colour change is a uniform write (setColors),
// never a link. The wrapped clones are minted only when a far set is built (the
// mint, or a far re-skin) and ride that set's compile gate (CharacterVisual
// gateFarMint / stageFarMaterials), so a tinted far program never links inside
// a live frame.
//
// A clone is reused while its source (the shared far clone of the tinted-material
// cache) is unchanged, so a re-bake over the same materials (an equipment change,
// a new face) re-mounts the clones it already linked: the merged head's slot rows
// and its hair, beard and scalp textures are uniforms, rewritten for the new head.
// Freed with the visual.
//
// One clone is NOT per character: the body's skin layer SWITCHED OFF (its body draws a
// class under-armor atlas). At strength 0 the layer leaves every texel exactly as sampled,
// whatever colour it holds, so every character on the same far material draws the same
// thing, and they share one wrapped clone (sharedOffLayer). A far crowd is sorted by
// material: a clone per body put a material of its own, on a program of its own, between
// every two far heads, and each of those is a program switch and a full uniform upload for
// a layer that draws nothing. Shared, the bodies of one class draw back to back.
//
// Three dev A/B arms (render_dev_flags.ts), for attributing what a far crowd costs, one
// layer at a time: `?wocfarheadtint=off` draws the head group with its plain far material
// (no merged layer: the colours are wrong on purpose, a hair slot samples the core atlas),
// `?wocfarbodytint=off` draws the body's own group with the far material itself (no skin
// layer, no clone at all), and `?wocfarshare=off` gives every body a clone of its own for
// a switched-off layer again (the shape before the sharing above: same pixels, a
// material and a program switch more per body). None is a player setting.
import type * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import { renderLayerDisabled } from '../render_dev_flags';
import type { WocHeadTintedRole, WocHeadTintRef, WocLinearRgb } from './woc_head_look_core';
import { wocHeadMergeSurfaceOf } from './woc_head_merge';
import type { WocHeadMergeSlot } from './woc_head_merge_core';
import {
  attachWocHeadMergedTint,
  attachWocHeadTint,
  setWocHeadMergedColors,
  setWocHeadMergedSlots,
  setWocHeadTint,
  type WocHeadMergedTintUniforms,
  type WocHeadTintUniforms,
  wocHeadMergedTintOf,
  wocHeadMergeOneSided,
  wocHeadTintOf,
} from './woc_head_tint';
import { type WocBodyAtlas, wocTintStrength } from './woc_skin_tint_core';

/** A head look's four tint colours (woc_head_look_core.ts WocHeadLookState.colors). */
export type WocHeadColors = Readonly<Record<WocHeadTintedRole, WocLinearRgb>>;

/** What the merged layer needs of a far bake's head group (woc_far_bake.ts). */
export interface WocFarHeadTint {
  /** The merged material's slot table: slot i is what `aWocHmSlot` i draws. */
  readonly slots: readonly WocHeadMergeSlot[];
  /** Per slot, where its own source material sits in the far set's materials (past
   *  the groups': it is derived for the far tier with them and never drawn). */
  readonly sources: readonly number[];
  /** The worn hairstyle's, the beard's and the scalp cap's textures (the core atlas
   *  rides `map`). */
  readonly hairMap: THREE.Texture | null;
  readonly beardMap: THREE.Texture | null;
  readonly scalpMap: THREE.Texture | null;
}

/** How one baked group's far material is tinted: one role's layer, the merged head's,
 *  or not at all. */
export type WocFarGroupTint = WocHeadTintRef | WocFarHeadTint | null;

/** Each far source's switched-off skin layers, by layer and reference: shared by every
 *  character that draws that source with the layer off, and freed with the source (the
 *  tinted-material cache disposes a far clone once no visual mounts it). */
const offLayers = new WeakMap<THREE.Material, Map<string, THREE.Material>>();

/** The clone of `source` wearing `tint`'s layer at strength 0: one for all its wearers. */
function sharedOffLayer(source: THREE.Material, tint: WocHeadTintRef): THREE.Material {
  let layers = offLayers.get(source);
  if (!layers) {
    const made = new Map<string, THREE.Material>();
    offLayers.set(source, made);
    source.addEventListener('dispose', () => {
      for (const material of made.values()) material.dispose();
      made.clear();
    });
    layers = made;
  }
  const key = `${tint.role}|${tint.surface ?? ''}|${tint.ref.join(',')}`;
  let out = layers.get(key);
  if (!out) {
    out = cloneMaterialWithHooks(source);
    // born switched off (the strength uniform starts at 0) and never written again: no
    // character's colours reach it
    attachWocHeadTint(out, tint.role, tint.ref, tint.surface);
    layers.set(key, out);
  }
  return out;
}

/** The dev A/B arms above: the far head's merged layer, the far body's skin layer, and
 *  the sharing of that layer where it is switched off. */
export const WOC_FAR_HEAD_TINT_FLAG = 'wocfarheadtint';
export const WOC_FAR_BODY_TINT_FLAG = 'wocfarbodytint';
export const WOC_FAR_SHARE_FLAG = 'wocfarshare';

export class WocFarTint {
  /** `${source uuid}|${role}|${surface}|${reference}` (the merged head: `${source
   *  uuid}|merged|${program variant}`) -> this character's wrapped clone. */
  private readonly wrapped = new Map<string, THREE.Material>();
  /** Every wrapped clone's uniforms, with the strength its colour writes carry (the
   *  body atlas its source was built for: a far source is one atlas for good). */
  private readonly uniforms = new Map<WocHeadTintUniforms, number>();
  /** Every merged head clone's uniforms (a head piece tints at full strength, whatever
   *  the body wears). */
  private readonly merged = new Set<WocHeadMergedTintUniforms>();
  private colors: WocHeadColors | null = null;

  /**
   * The far set a bake's groups draw, each tinted group's material swapped for
   * this character's wrapped clone of it; untinted groups pass through untouched.
   * `tints` is one entry per group, as the bake returns them, and `mats` the far
   * tier derivation of the bake's materials: the groups' first, then the merged
   * head's slot sources, which stay out of the set returned (one material per
   * group). `bodyAtlas` is what the body draws in THIS set (`mats` were built over
   * it). Writes `colors` to every uniform this character owns, the fresh ones
   * included.
   */
  wrap(
    mats: readonly THREE.Material[],
    tints: readonly WocFarGroupTint[],
    colors: WocHeadColors,
    bodyAtlas: WocBodyAtlas = 'suit',
  ): THREE.Material[] {
    const out = tints.map((tint, i) => {
      const source = mats[i];
      if (!tint) return source;
      if ('slots' in tint) {
        return renderLayerDisabled(WOC_FAR_HEAD_TINT_FLAG)
          ? source
          : this.wrapHead(source, tint, mats);
      }
      // the body's own group is the one tinted on the suit surface
      if (tint.surface === 'suit' && renderLayerDisabled(WOC_FAR_BODY_TINT_FLAG)) return source;
      return this.wrapOne(source, tint, wocTintStrength(tint, bodyAtlas));
    });
    this.setColors(colors);
    return out;
  }

  /** Point every wrapped far material at a look's colours (a uniform write each). */
  setColors(colors: WocHeadColors): void {
    this.colors = colors;
    for (const [u, strength] of this.uniforms) setWocHeadTint(u, colors[u.role], strength);
    for (const u of this.merged) setWocHeadMergedColors(u, colors);
  }

  /** Free this character's wrapped clones (their programs are shared and stay linked). */
  dispose(): void {
    for (const m of this.wrapped.values()) m.dispose();
    this.wrapped.clear();
    this.uniforms.clear();
    this.merged.clear();
    this.colors = null;
  }

  private wrapOne(source: THREE.Material, tint: WocHeadTintRef, strength: number): THREE.Material {
    // a layer that draws nothing is the same for everyone on this source: share it
    if (strength === 0 && !renderLayerDisabled(WOC_FAR_SHARE_FLAG)) {
      return sharedOffLayer(source, tint);
    }
    const key = `${source.uuid}|${tint.role}|${tint.surface ?? ''}|${tint.ref.join(',')}`;
    let out = this.wrapped.get(key);
    if (!out) {
      out = cloneMaterialWithHooks(source);
      attachWocHeadTint(out, tint.role, tint.ref, tint.surface);
      this.wrapped.set(key, out);
    }
    const u = wocHeadTintOf(out);
    if (u) {
      this.uniforms.set(u, strength);
      if (this.colors) setWocHeadTint(u, this.colors[tint.role], strength);
    }
    return out;
  }

  /** The head group's clone under the merged layer, its slot rows written from the far
   *  tier's own derivation of each slot's source material (`mats[head.sources[i]]`). */
  private wrapHead(
    source: THREE.Material,
    head: WocFarHeadTint,
    mats: readonly THREE.Material[],
  ): THREE.Material {
    // the program variant follows the head (a one sided slot compiles the back-face
    // drop), so a clone is kept per source and variant
    const oneSided = wocHeadMergeOneSided(head.slots);
    const key = `${source.uuid}|merged|${oneSided ? 1 : 2}`;
    let out = this.wrapped.get(key);
    if (!out) {
      out = cloneMaterialWithHooks(source);
      attachWocHeadMergedTint(out, oneSided);
      this.wrapped.set(key, out);
    }
    const u = wocHeadMergedTintOf(out);
    if (u) {
      setWocHeadMergedSlots(
        u,
        head.slots,
        head.sources.map((at) => wocHeadMergeSurfaceOf(mats[at])),
        wocHeadMergeSurfaceOf(out),
      );
      u.hair.value = head.hairMap;
      u.beard.value = head.beardMap;
      u.scalp.value = head.scalpMap;
      this.merged.add(u);
      if (this.colors) setWocHeadMergedColors(u, this.colors);
    }
    return out;
  }
}
