// The compass strip's DOM half: building the rose-label pool, painting it from
// a CompassView, and RELABELLING it when the locale changes.
//
// NAMED `_painter` DELIBERATELY. The per-frame painter gates key on that suffix
// (tests/hud_perf_budget.test.ts PAINTER_FILE_RE), and this module IS on the
// fast band: Hud.updateCompass calls paintCompassMarks every frame the player
// turns. A bare name is the whole of that escape, so the first draft of this
// extraction landed outside every painter and classification sweep at once
// while doing raw style writes. Every per-frame write here goes through the
// PainterHost elided writer facet; the only raw writes left are in the
// build-once and relabel paths, and both are counted allowances in that suite.
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
import { type CardinalId, COMPASS_ROSE_IDS, type CompassView } from './compass';
import { t } from './i18n';
import type { PainterHostWriters } from './painter_host';

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
  writers: PainterHostWriters,
): void {
  visibleScratch.clear();
  for (const m of view.marks) {
    const el = marks.get(m.label);
    if (!el) continue;
    visibleScratch.add(m.label);
    // offsetFrac -1..1 to 0..100% across the strip; fade marks near the edges.
    writers.setStyleProp(el, 'left', `${(m.offsetFrac * 0.5 + 0.5) * 100}%`);
    writers.setStyleProp(el, 'opacity', `${Math.max(0.2, 1 - Math.abs(m.offsetFrac) * 0.85)}`);
    writers.setDisplay(el, 'block');
  }
  for (const [label, el] of marks) {
    if (!visibleScratch.has(label)) writers.setDisplay(el, 'none');
  }
}
