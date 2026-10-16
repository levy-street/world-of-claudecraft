// Which appearance editor a class's body gets: the WOC face builder
// (woc_head_builder.ts) on every WOC modular body, the KayKit modular
// customizer (appearance_customizer.ts) otherwise. Both return the same
// AppearanceCustomizer shape, so character creation and the Redesign editor
// mount through this one call and keep their onChange wiring unchanged.
//
// The WOC head library streams file by file (woc_head_packs.ts), so the face
// builder's mount prefetches what it is about to show: the body type's default
// look the moment it opens, and every hairstyle (or facial hair) file of the
// current type when that category opens, so each option is resident by the
// time it is clicked.
//
// The face builder's mount is also what tells the stage a character was CHOSEN
// (AppearanceEditorStage.markChosen): the creator draws a class's armor at the
// crowd's detail while classes and bodies are flipped through, and at full
// detail once the player works on the one that is there
// (render/characters/preview_armor_detail_core.ts).

import type { WocHeadSlot, WocHeadType } from '../render/characters/woc_head_catalog';
import { prefetchWocHeadLook, prefetchWocHeadSlot } from '../render/characters/woc_head_packs';
import { WOC_BODY_CLASSES } from '../render/characters/woc_parts_core';
import type { PlayerClass } from '../sim/types';
import {
  type AppearanceCustomizer,
  type AppearanceCustomizerOptions,
  mountAppearanceCustomizer,
} from './appearance_customizer';
import { mountWocHeadBuilder } from './woc_head_builder';
import {
  headTypeOf,
  type WocBuilderCategory,
  type WocBuilderFocus,
} from './woc_head_builder_model';

export type { AppearanceCustomizer } from './appearance_customizer';

/** The slice of the creation stage the face builder drives. */
export interface AppearanceEditorStage {
  setFocus(focus: WocBuilderFocus): void;
  /** The player acted on the appearance of the character on the stage: it is the one
   *  being made (CharacterPreview.markChosen: the creator draws its armor at full detail
   *  from here on). Required, so the stage a host hands in cannot lose the call to a
   *  rename: a stage that draws one detail answers with nothing. */
  markChosen(): void;
}

export interface AppearanceEditorOptions extends AppearanceCustomizerOptions {
  /** The 3D stage, read live (it may not exist yet at mount). */
  stage?: () => AppearanceEditorStage | null;
}

/** Whether a class's body is edited with the WOC face builder. */
export function usesWocHeadBuilder(cls: PlayerClass): boolean {
  return WOC_BODY_CLASSES.has(cls);
}

/** The streamed head slot a face-builder category browses (its files are prefetched when
 *  it opens), or null for a category whose options all ride the head's core file. */
export function wocPrefetchSlotOf(cat: WocBuilderCategory): WocHeadSlot | null {
  if (cat === 'hairstyle') return 'hair';
  if (cat === 'facialHair') return 'beard';
  return null;
}

export function mountAppearanceEditor(
  host: HTMLElement,
  cls: PlayerClass,
  opts: AppearanceEditorOptions,
): AppearanceCustomizer {
  if (!usesWocHeadBuilder(cls)) return mountAppearanceCustomizer(host, opts);
  // The stage is told when the player CHOOSES the character on it (markChosen): by
  // opening a face category (the camera's close-up) or changing any option of the look
  // on the body that is there. Picking the body type is browsing, like picking a class:
  // it puts another body on the stage, which nobody chose yet. Neither does the panel
  // being shown again (set, below): that is the host, not the player.
  let body: WocHeadType | null = null;
  const builder = mountWocHeadBuilder(host, {
    value: opts.value,
    onChange: (next) => {
      const sameBody = headTypeOf(next) === body;
      body = headTypeOf(next);
      opts.onChange(next);
      if (sameBody) opts.stage?.()?.markChosen();
    },
    onFocus: (focus) => {
      const stage = opts.stage?.();
      stage?.setFocus(focus);
      if (focus === 'face') stage?.markChosen();
    },
    onOpen: (cat) => {
      const slot = wocPrefetchSlotOf(cat);
      if (slot) prefetchWocHeadSlot(headTypeOf(builder.value), slot);
    },
  });
  body = headTypeOf(builder.value);
  // the head the creator opens on: its body type's default look
  prefetchWocHeadLook(headTypeOf(builder.value));
  return {
    get value() {
      return builder.value;
    },
    // The caller pokes set() whenever its panel is shown again (a class switch,
    // a return to the creator): re-assert the open category's camera focus,
    // since a stage change reset the camera to the full body.
    set(next) {
      builder.set(next);
      body = headTypeOf(builder.value);
      opts.stage?.()?.setFocus(builder.focus);
    },
    destroy() {
      builder.destroy();
    },
  };
}
