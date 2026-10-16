// The launcher creator's one-time gesture hint: a slim tab docked to the 3D stage's left edge,
// beside the model and never over it, where two fingertips spread apart (a pinch) over the
// words "Pinch to zoom". It tells a phone player the model takes a pinch, and it goes for
// good the first time they move the model.
//
// Contracts:
// - Structural seam. CharacterPreview declares its own copy of the hint's interface
//   (PreviewTouchHint), so src/render never imports this module; the launcher hands one in
//   (src/game/launcher_preview_stage.ts). The stage decides WHEN the hint is offered (a touch
//   creator with its model drawn: preview_touch_core.ts touchHintOffered); this module
//   decides whether the player still needs it (preview_touch_hint_core.ts).
// - Called every frame. The stage calls show() or hide() once per frame, so the repeat path
//   is the hot one: a steady frame (same container, same i18n revision) returns before any
//   DOM write, and hide() on a hidden hint does nothing. Nothing is created, and storage is
//   not read, until the first show(); a retired hint creates nothing at all.
// - Once, until a gesture. The first pinch, slide, turn or double tap made while the tab is
//   up stores one flag (PREVIEW_TOUCH_HINT_STORAGE_KEY) and plays the exit; a stored flag
//   means the hint never shows on that device again. A gesture while it is off screen (the
//   character select's stage, a model still loading) leaves it be: the player never saw it.
//   Storage that throws or is missing (a private window, a blocked origin) only costs the
//   memory: the hint still retires for the visit.
// - It takes no touches: pointer-events: none in shell.css, so a pinch that starts on the
//   tab reaches the canvas under it.
// - Accessibility. A role=note with its visible text; the glyph is aria-hidden.
// - Tokens only. Every color and the whole animation live in src/styles/shell.css
//   ("character preview touch hint"); this module mints the node, the glyph's geometry and
//   the label text.

import { getI18nRevision, t } from './i18n';
import {
  PREVIEW_TOUCH_HINT_LEAVE_MS,
  PREVIEW_TOUCH_HINT_SEEN,
  PREVIEW_TOUCH_HINT_STORAGE_KEY,
  type TouchHintPhase,
  touchHintFirstGesture,
  touchHintOnInteract,
  touchHintOnLeft,
  touchHintOnOffer,
  touchHintStartPhase,
} from './preview_touch_hint_core';
import { safeLocalStorage } from './safe_local_storage';

/** The hint the stage drives (CharacterPreview's PreviewTouchHint, structurally). */
export interface PreviewTouchHintLayer {
  /** Show beside the model in `container` (appending it there, or moving it). Idempotent. */
  show(container: HTMLElement): void;
  /** Take it off (a no-op when it is not on screen). */
  hide(): void;
  /** The player moved the model: remember it, and play the exit if the hint is up. */
  interacted(): void;
}

/** The slice of Storage the hint uses. */
export interface PreviewTouchHintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The root class; the stylesheet section and the tests key on it. */
export const PREVIEW_TOUCH_HINT_CLASS = 'preview-touch-hint';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

/** The pinch glyph: a faint ring, the diagonal the fingers travel, a chevron at each end
 *  pointing outward, and two fingertips (the stylesheet spreads them apart and back). */
function buildGlyph(doc: Document): SVGSVGElement {
  const svg = svgEl(doc, 'svg', {
    class: 'pth-glyph',
    viewBox: '0 0 40 40',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  svg.append(
    svgEl(doc, 'circle', { class: 'pth-ring', cx: '20', cy: '20', r: '13' }),
    svgEl(doc, 'path', { class: 'pth-trail', d: 'M11 11L29 29' }),
    svgEl(doc, 'path', { class: 'pth-arrow', d: 'M6 11.5V6h5.5' }),
    svgEl(doc, 'path', { class: 'pth-arrow', d: 'M34 28.5V34h-5.5' }),
    svgEl(doc, 'circle', { class: 'pth-tip pth-tip-a', cx: '16.5', cy: '16.5', r: '3.4' }),
    svgEl(doc, 'circle', { class: 'pth-tip pth-tip-b', cx: '23.5', cy: '23.5', r: '3.4' }),
  );
  return svg;
}

/**
 * Build the hint. Nothing touches the DOM until the first show(); the node it builds then is
 * reused across hides, shows and container moves. `storage` defaults to the page's
 * localStorage (tests pass their own, or null for none).
 */
export function createPreviewTouchHint(
  doc: Document = document,
  storage: PreviewTouchHintStorage | null = safeLocalStorage(),
): PreviewTouchHintLayer {
  let root: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  /** The container the hint sits in now (null while it is off screen). */
  let host: HTMLElement | null = null;
  /** The i18n revision the label was filled under (-1: not filled yet). */
  let labelRevision = -1;
  /** Read from storage on the first show(), so a hint never offered (a desktop launcher, the
   *  character select) reads nothing; null until then. */
  let phase: TouchHintPhase | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const current = (): TouchHintPhase => {
    if (phase === null) {
      let stored: string | null = null;
      try {
        stored = storage?.getItem(PREVIEW_TOUCH_HINT_STORAGE_KEY) ?? null;
      } catch {
        stored = null;
      }
      phase = touchHintStartPhase(stored);
    }
    return phase;
  };

  const build = (): HTMLElement => {
    const el = doc.createElement('div');
    el.className = PREVIEW_TOUCH_HINT_CLASS;
    el.setAttribute('role', 'note');
    el.appendChild(buildGlyph(doc));
    const text = doc.createElement('span');
    text.className = 'pth-label';
    el.appendChild(text);
    label = text;
    return el;
  };

  /** Take the node off the page, wherever it is. */
  const detach = (): void => {
    root?.remove();
    host = null;
  };

  const stopLeaving = (): void => {
    if (leaveTimer === null) return;
    clearTimeout(leaveTimer);
    leaveTimer = null;
  };

  return {
    show(container) {
      phase = touchHintOnOffer(current(), true);
      // a retired hint mints nothing; an exit under way finishes where it is
      if (phase !== 'shown') return;
      const node = root ?? build();
      root = node;
      if (host !== container || node.parentNode !== container) {
        node.dataset.state = 'shown';
        container.appendChild(node);
        host = container;
      }
      const revision = getI18nRevision();
      if (labelRevision !== revision && label) {
        // latched before t(): were it to throw (a release build with the key pending), once
        labelRevision = revision;
        label.textContent = t('auth.previewPinchHint');
      }
    },
    hide() {
      // never shown: nothing on screen, nothing to read
      if (phase === null) return;
      const before = phase;
      phase = touchHintOnOffer(before, false);
      if (before === 'leaving') stopLeaving();
      if (host) detach();
    },
    interacted() {
      // only a gesture made while the tab is up retires it (never shown: phase is null)
      if (phase === null || !touchHintFirstGesture(phase)) return;
      try {
        storage?.setItem(PREVIEW_TOUCH_HINT_STORAGE_KEY, PREVIEW_TOUCH_HINT_SEEN);
      } catch {
        // a blocked write only costs the memory: the hint still retires for this visit
      }
      phase = touchHintOnInteract(phase);
      if (!root || !host) {
        // shown means attached; were it ever not, retire without an exit to play
        phase = 'done';
        detach();
        return;
      }
      root.dataset.state = 'leaving';
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        phase = touchHintOnLeft(current());
        detach();
      }, PREVIEW_TOUCH_HINT_LEAVE_MS);
    },
  };
}
