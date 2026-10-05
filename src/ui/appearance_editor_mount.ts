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

import type { WocHeadSlot } from '../render/characters/woc_head_catalog';
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
  const builder = mountWocHeadBuilder(host, {
    value: opts.value,
    onChange: opts.onChange,
    onFocus: (focus) => opts.stage?.()?.setFocus(focus),
    onOpen: (cat) => {
      const slot = wocPrefetchSlotOf(cat);
      if (slot) prefetchWocHeadSlot(headTypeOf(builder.value), slot);
    },
  });
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
      opts.stage?.()?.setFocus(builder.focus);
    },
    destroy() {
      builder.destroy();
    },
  };
}
