// The 2D layer that stands in for the character turntable while the cold-open
// gate holds its draws (src/render/characters/preview_open_gate_core.ts).
//
// Every gate in this repo names its stand-in: a gate hides a still-linking
// object so its reveal draw cannot stall the frame, and that is fair only
// while something else still tells the player what is there. The paperdoll's
// stand-in is a CACHED headshot of the character, else the class CREST: the
// same ladder the portrait chips already climb when a 3D portrait is not ready
// yet, honest (the player's own class, not a fake body), free (an already
// cached data URL either way), and NO new string, so this adds no i18n
// surface at all. The container it paints into already carries
// t('hudChrome.character.modelPreview') as its aria-label; the layer only adds
// aria-busy while the warm runs, and its image is decorative.
//
// Not chosen: a "loading" word (a new player string for a sub-200 ms state) or
// a spinner (motion for what is one frame on a warm context).
//
// Cold path only: one element per open, never touched per frame, so it is
// outside the HUD's per-frame write-elision budget by construction.
//
// Every mount of the shared turntable (Hud.mountSharedPreview) arms through
// armPreviewOpen below, so the sheet, the skin picker and Inspect all hold
// their first draw behind this layer while that context links, uploads and
// touches what was just mounted.

import { cachedPortraitDataUrl } from '../render/characters/portrait';
import type { LinkedProgramTouchQueue } from '../render/linked_program_touch_lane';
import type { PlayerClass } from '../sim/types';
import { crestUrl } from './portrait_chip';

/** What CharacterPreview.armOpen drives. Both halves are idempotent. */
interface PreviewStandIn {
  show(): void;
  hide(): void;
}

export const PREVIEW_STAND_IN_CLASS = 'preview-stand-in';

interface PreviewStandInOpts {
  /** Whose crest to draw, and whose cached headshot to prefer. */
  cls: PlayerClass;
  /** Which body skin the mount is showing, so the peeked headshot is this
   *  character's rather than another chroma's. */
  skin?: number;
}

/**
 * Build the stand-in layer for `container` (`#char-model-preview` or
 * `#inspect-model-preview`). Nothing is created until `show()`, so an open
 * that skips the gate (already linked) costs one object and no DOM.
 *
 * The image is a cached headshot of this exact (class, skin) when the portrait
 * cache already holds one (truer than the crest, and the common case once the
 * post-entry lane has warmed the class headshots), else the class crest. The
 * lookup is a PEEK that never kicks a capture: this runs at the moment the
 * sheet's own context is linking, and a second-context capture there would put
 * its 43 to 201 ms build, upload and encode on the very frame the gate exists
 * to keep clear.
 */
export function createPreviewStandIn(
  container: HTMLElement,
  opts: PreviewStandInOpts,
): PreviewStandIn {
  let layer: HTMLElement | null = null;
  return {
    show(): void {
      if (layer) return;
      const el = document.createElement('div');
      el.className = PREVIEW_STAND_IN_CLASS;
      el.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.src =
        cachedPortraitDataUrl(`player_${opts.cls}`, opts.skin ?? 0, 'headshot') ??
        crestUrl(opts.cls);
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
      container.setAttribute('aria-busy', 'true');
      container.appendChild(el);
      layer = el;
    },
    hide(): void {
      layer?.remove();
      layer = null;
      container.removeAttribute('aria-busy');
    },
  };
}

/** The slice of CharacterPreview this arming needs (structural, so the arm is
 *  testable without a WebGL context). */
interface PreviewOpenGateHost {
  setTouchQueue(queue: LinkedProgramTouchQueue | null): void;
  armOpen(standIn: PreviewStandIn | null): void;
}

/**
 * Arm the preview's cold-open gate for a mount: hand it the world renderer's
 * GPU work queue and the stand-in to show while it links. One call so the HUD
 * stays a thin caller (its mount path is inside a monolith ceiling).
 *
 * `rendererHost` is read STRUCTURALLY for `backgroundGpuWork`, the renderer's
 * public GPU work queue (the one arbiter for work reaching WebGL): src/ui then
 * needs no Renderer import for it, and the renderer needs no preview import. A
 * host without the queue still links and uploads on open and skips only the
 * touch tail, so this can never be the thing that breaks an open.
 */
export function armPreviewOpen(
  preview: PreviewOpenGateHost,
  container: HTMLElement,
  opts: PreviewStandInOpts,
  rendererHost: object,
): void {
  preview.setTouchQueue(previewTouchQueueOf(rendererHost));
  preview.armOpen(createPreviewStandIn(container, opts));
}

/** The renderer's public GPU work queue, read structurally; null on a host
 *  without one (previews, tests), which only skips the touch tail. */
export function previewTouchQueueOf(rendererHost: object): LinkedProgramTouchQueue | null {
  const queue = (rendererHost as { backgroundGpuWork?: LinkedProgramTouchQueue | null })
    .backgroundGpuWork;
  return queue ?? null;
}
