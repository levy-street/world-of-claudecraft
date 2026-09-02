// The compass strip's DOM half: building the rose-label pool, painting it from
// a CompassView, and RELABELLING it when the locale changes.
//
// Extracted out of the HUD coordinator by masterwrought ruling
// qr-19-hud-coordinator-fanout-exemption. The relabel is why it exists: the
// eight rose labels are written ONCE when the pool is built, so a runtime
// language change left them in the previous locale forever, and the fix wanted
// a home the coordinator could call in one line. The build and paint halves
// came with it because a label pool whose creator and painter live in different
// files is how the two drift apart.
//
// src/ui/compass.ts stays the DOM-free derivation (bearing math, the rose, the
// visible window). This file only ever turns that view into element writes.
import type { CardinalId, CompassView } from './compass';
import { t } from './i18n';

/** The rose points, left to right, in the order the strip stacks them. */
export const COMPASS_ROSE_IDS: readonly CardinalId[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The strip's element pool, keyed by the language-agnostic rose id. */
export type CompassMarkElements = Map<CardinalId, HTMLElement>;

/**
 * Build the eight rose-label spans under `track` and return the pool. The
 * labels are localized here, which is exactly why {@link relabelCompassMarks}
 * has to exist: nothing else ever writes them again.
 */
export function buildCompassMarks(track: HTMLElement, doc: Document): CompassMarkElements {
  const marks: CompassMarkElements = new Map();
  for (const id of COMPASS_ROSE_IDS) {
    const el = doc.createElement('span');
    el.className = `compass-mark${id.length === 1 ? ' major' : ''}`;
    el.textContent = t(`hudChrome.compass.${id}`);
    track.appendChild(el);
    marks.set(id, el);
  }
  return marks;
}

/**
 * Rewrite every rose label with fresh `t()`. The language fan-out calls this;
 * clearing the compass repaint memos alone would relabel the heading readout
 * and leave the strip itself in the language the player just left.
 */
export function relabelCompassMarks(marks: CompassMarkElements): void {
  for (const [id, el] of marks) el.textContent = t(`hudChrome.compass.${id}`);
}

/**
 * Slide the visible marks across the strip and hide the rest. `visibleScratch`
 * is the caller's reused Set, so the per-frame path allocates nothing.
 */
export function paintCompassMarks(
  marks: CompassMarkElements,
  view: CompassView,
  visibleScratch: Set<string>,
): void {
  visibleScratch.clear();
  for (const m of view.marks) {
    const el = marks.get(m.label);
    if (!el) continue;
    visibleScratch.add(m.label);
    // offsetFrac -1..1 to 0..100% across the strip; fade marks near the edges.
    el.style.left = `${(m.offsetFrac * 0.5 + 0.5) * 100}%`;
    el.style.opacity = `${Math.max(0.2, 1 - Math.abs(m.offsetFrac) * 0.85)}`;
    el.style.display = 'block';
  }
  for (const [label, el] of marks) {
    if (!visibleScratch.has(label)) el.style.display = 'none';
  }
}
