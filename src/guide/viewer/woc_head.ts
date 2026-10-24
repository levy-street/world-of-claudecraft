// The Guide viewer's WOC head: the modular head a split WOC body wears in game, at the
// DEFAULT look. Every WOC body in game hangs its fit's head files on the `head` bone (a
// base file ends at the neck: render/characters/woc_head_packs.ts +
// woc_head_dressing.ts), so this module drives those SAME runtime modules through the
// viewer's one-shot build instead of copying them: the type's default pieces
// (woc_head_catalog.ts WOC_HEAD_TYPES[t].defaults), the default face controls, bald crown
// and scalp tuck, and the default skin, eye, hair and brow tints on the head AND the body's
// skin paint (woc_head_look_core.ts wocHeadLookFromAppearance(null); which texels of the body
// are skin is the game's own rule, woc_skin_tint_core.ts), exactly what a character
// with no stored look draws. The hair hides under the kit's helm or hood as it does in game.
// The library ships split, so a figure fetches only the files its default look draws
// (woc_head_catalog.ts wocHeadLookUrls: the type's core, plus its default hairstyle's and
// facial hair's files), never the whole library.
//
// Reached only through model.ts (the lazy viewer chunk), never the main Guide bundle.
import type * as THREE from 'three';
import { loadGltf } from '../../render/assets/loader';
import { wocSetItems } from '../../render/characters/woc_armor_catalog';
import {
  parseWocArmorPackUrl,
  type WocFit,
  wocBaseUrl,
} from '../../render/characters/woc_armor_core';
import {
  type WocHeadType,
  wocHeadLookUrls,
  wocHeadTypeForGender,
} from '../../render/characters/woc_head_catalog';
import {
  WocHeadDressing,
  type WocHeadDressingHost,
} from '../../render/characters/woc_head_dressing';
import {
  ensureWocHeadFile,
  hangWocHead,
  onWocHeadFileReady,
  unhangWocHead,
  wocHeadFileResident,
  wocHeadRigOf,
} from '../../render/characters/woc_head_packs';
import { wocBodyAtlasOf } from '../../render/characters/woc_skin_tint_core';
import type { GuideModelSpec } from '../content.generated';

const WOC_FITS: readonly WocFit[] = ['male', 'female'];

/** The head a WOC body wears: its fit, the fit's head type, and whether the kit the viewer
 *  draws on it hides the hair (a helm or hood). */
export interface GuideWocHead {
  readonly fit: WocFit;
  readonly type: WocHeadType;
  readonly helm: boolean;
}

/**
 * The head a spec's body wears in game, or null for any rig that is not a WOC base (a
 * creature, a pet, a KayKit rig). The fit is read off the base file itself (manifest.ts
 * builds every WOC body's url with wocBaseUrl). The viewer draws each armor file it binds
 * whole, so the hair hides when any piece of those sets hides it (the helm or hood whose
 * catalog item lists `hair` in hidesAppearance), the rule the game applies to a worn kit.
 */
export function guideWocHeadOf(spec: Pick<GuideModelSpec, 'url' | 'armor'>): GuideWocHead | null {
  const fit = WOC_FITS.find((f) => wocBaseUrl(f) === spec.url);
  if (!fit) return null;
  const helm = (spec.armor ?? []).some((url) => {
    const pack = parseWocArmorPackUrl(url);
    if (!pack) return false;
    return Object.values(wocSetItems(pack.fit, pack.set)).some((item) =>
      (item.hidesAppearance ?? []).includes('hair'),
    );
  });
  return { fit, type: wocHeadTypeForGender(fit), helm };
}

/**
 * Settles once one head file is resident (true) or cannot be this build (false). The
 * registry's ready signal is the seam for a host with no per-frame poll; the file's own
 * memoized fetch guards it, because a failed fetch (or one landing while the registry sits
 * out its retry cooldown) never fires that signal. The residency read waits a macrotask so
 * the registry's own settle callback has run first, whatever order the two callbacks were
 * chained in.
 */
function guideWocHeadFileReady(url: string): Promise<boolean> {
  if (wocHeadFileResident(url)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let off: () => void = () => undefined;
    const settle = (ok: boolean): void => {
      off();
      resolve(ok);
    };
    off = onWocHeadFileReady((ready) => {
      if (ready === url) settle(true);
    });
    ensureWocHeadFile(url);
    loadGltf(url).then(
      () => setTimeout(() => settle(wocHeadFileResident(url)), 0),
      () => settle(false),
    );
  });
}

/**
 * Settles once every file a head type's DEFAULT look draws is resident (true: the core,
 * plus its default hairstyle's and facial hair's files) or any cannot be this build (false:
 * model.ts buildModel then fails the figure, never a headless or bald body).
 */
export function guideWocHeadReady(type: WocHeadType): Promise<boolean> {
  const urls = wocHeadLookUrls(type, null);
  return Promise.all(urls.map(guideWocHeadFileReady)).then((ok) => ok.every(Boolean));
}

/** assembleModel's head step: hang the default look's resident files on the model, hidden,
 *  before the model's own passes (the game hangs them right after the armor,
 *  render/characters/assets.ts). */
export function hangGuideWocHead(model: THREE.Object3D, head: GuideWocHead): void {
  hangWocHead(model, head.type, wocHeadLookUrls(head.type, null));
}

// The dressing reaches its host only on a late attach (poll), which the viewer never needs:
// it awaits every file before building, so its one poll goes live on the files the build
// hung. Should it ever attach one, there is no compile gate here (the viewer links every
// program before its first draw) and no per-mesh adoption. The viewer never asks for the
// merged head (a wiki page draws one character), so the rest of the seam is inert.
function viewerHost(model: THREE.Object3D): WocHeadDressingHost {
  return {
    model,
    adopt: (_node, retint) => retint(),
    forget: () => undefined,
    reveal: (_node, live) => live(true),
    relive: () => undefined,
    baseMaterial: (mesh) => mesh.material,
    rigDrawn: () => true,
  };
}

const noop = (): void => undefined;

/**
 * CharacterVisual's head step, after the model's material passes: dress the hung head at
 * the default look (its pieces shown, the default morphs, the hair hidden under the kit's
 * helm) and wrap the head and body-skin materials with the default tints. Returns the
 * disposer that frees this build's wrapped material clones and takes the head off the model
 * (the files' shared geometry and materials stay with them).
 *
 * buildModel builds a figure only once every file of the look landed, so the one poll below
 * goes live; a model handed in without its files hung is left untouched.
 */
export function dressGuideWocHead(model: THREE.Object3D, head: GuideWocHead): () => void {
  const rig = wocHeadRigOf(model);
  if (!rig) return noop;
  const dressing = new WocHeadDressing(viewerHost(model), head.type);
  dressing.setHelm(head.helm);
  // live on the files the build hung, or never: a partial head is no head
  dressing.poll();
  if (!dressing.isLive) {
    dressing.dispose();
    unhangWocHead(model);
    return noop;
  }
  // A figure's look never changes, so the library's pieces it does not draw leave the model
  // before the tint wrap: three's compile and the viewer's texture prewarm both walk hidden
  // meshes, and would link and upload every other hairstyle, beard and variant for nothing.
  for (const piece of rig.pieces.values()) if (!piece.visible) piece.removeFromParent();
  // the viewer swaps no under-armor atlas onto a body (model.ts draws the base file's own
  // suit), so the game's rule for that atlas applies: only its skin paint takes the tone
  dressing.retint(wocBodyAtlasOf(null));
  return () => {
    dressing.dispose();
    unhangWocHead(model);
  };
}
