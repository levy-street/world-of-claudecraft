// Shared inner-mount + reuse helper for the AAA window frame.
//
// The generalization of vendor_window.ts's private ensureFrame: a single-tenant
// window (leaderboard, calendar, daily rewards) mounts the shared window frame on
// a direct-child container of its .window.panel root, rather than stamping the
// builder's classes / role / aria onto the root itself. The host root then stays
// a plain .window.panel (its legacy chrome neutralized in CSS with
// #<id>:has(> .window-frame), the documented engine floor), while the inner
// .window-frame draws the AAA titlebar / body / footer. An intact mounted frame
// (its .window-body present) is the reuse marker, so repaints keep the same nodes
// and only refill the body; anything else (first open, or a wiped root) rebuilds
// the frame cold. Cold path only (window open / rebuild), never the per-frame loop.
//
// vendor_window.ts keeps its OWN copy: its #vendor-window root is shared with the
// Heroic Quartermaster tenant, so its reuse marker and cold-rebuild timing are
// load-bearing for that handoff and must not be coupled to this helper.
//
// LEDGER (later consolidation, not this task): this helper (batch 3) and the inline
// ensureFrame copies in options_window.ts + the batch 4/5 window painters + vendor
// currently coexist. They share the ":scope > .window-frame with a live .window-body
// is the reuse marker" contract but were not unified (risk/scope); a follow-up should
// migrate the non-shared-root copies onto ensureWindowFrame and keep vendor bespoke.

import { renderWindowFrame, type WindowFrameDeps, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

/**
 * Return the frame mounted inside `el`, building it cold if absent.
 *
 * The frame lives on `el`'s direct-child `.window-frame`; a reuse returns the
 * existing titlebar / body / footer nodes so the caller repaints only the body.
 * On the reuse path `descriptor` and `deps` are IGNORED: the frame keeps the
 * chrome and callbacks it was built with, so passing different values on a
 * repaint has no effect until the frame is rebuilt cold.
 */
export function ensureWindowFrame(
  el: HTMLElement,
  descriptor: WindowFrameDescriptor,
  deps: WindowFrameDeps,
): WindowFrameParts {
  const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
  const body = mounted?.querySelector<HTMLElement>('.window-body');
  if (mounted && body) {
    return {
      root: mounted,
      body,
      footer: mounted.querySelector<HTMLElement>('.window-footer'),
      tabButtons: Array.from(mounted.querySelectorAll<HTMLButtonElement>('[data-window-tab]')),
    };
  }
  const mount = document.createElement('div');
  const parts = renderWindowFrame(mount, descriptor, deps);
  el.replaceChildren(mount);
  return parts;
}
