// The Rising Phoenix proc overlay markup (owner design 2026-07-11, replacing
// the twin proc arcs): painted phoenixes plus persistent class-resource banks.
// Creation-time DOM only (built once by the Hud): the per-frame work stays the
// two toggled classes in proc_overlay_painter, and the pure state rule stays
// in proc_overlay_view. Both variants reuse a single transparent asset across
// their layers, keeping the silhouettes perfectly aligned during transitions.

/** Build the #proc-overlay element (not yet attached to the document). */
export function buildProcOverlay(
  soulFragmentsLabel: string,
  doc: Document = document,
): HTMLElement {
  const el = doc.createElement('div');
  el.id = 'proc-overlay';
  el.setAttribute('role', 'meter');
  el.setAttribute('aria-label', soulFragmentsLabel);
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '5');
  el.setAttribute('aria-valuenow', '0');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('tabindex', '-1');
  el.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
  el.innerHTML = `
<div class="fire-bird" aria-hidden="true">
  <img class="fire-part fire-embers" src="/ui/procs/fire-phoenix-v2.webp" alt="" draggable="false" />
  <img class="fire-part fire-left" src="/ui/procs/fire-phoenix-v2.webp" alt="" draggable="false" />
  <img class="fire-part fire-right" src="/ui/procs/fire-phoenix-v2.webp" alt="" draggable="false" />
  <img class="fire-part fire-core" src="/ui/procs/fire-phoenix-v2.webp" alt="" draggable="false" />
</div>
<div class="chrono-bird" aria-hidden="true">
  <img class="chrono-part chrono-left" src="/ui/procs/chronomancy-phoenix-v2.webp" alt="" draggable="false" />
  <img class="chrono-part chrono-right" src="/ui/procs/chronomancy-phoenix-v2.webp" alt="" draggable="false" />
  <img class="chrono-part chrono-core" src="/ui/procs/chronomancy-phoenix-v2.webp" alt="" draggable="false" />
  <img class="chrono-part chrono-final" src="/ui/procs/chronomancy-phoenix-v2.webp" alt="" draggable="false" />
</div>
<div class="frost-bird" aria-hidden="true">
  <span class="frost-crystal frost-crystal-1"></span>
  <span class="frost-crystal frost-crystal-2"></span>
  <span class="frost-crystal frost-crystal-3"></span>
  <span class="frost-crystal frost-crystal-4"></span>
  <span class="frost-crystal frost-crystal-5"></span>
  <img class="frost-part frost-tail" src="/ui/procs/frost-phoenix-v1.webp" alt="" draggable="false" />
  <img class="frost-part frost-left" src="/ui/procs/frost-phoenix-v1.webp" alt="" draggable="false" />
  <img class="frost-part frost-right" src="/ui/procs/frost-phoenix-v1.webp" alt="" draggable="false" />
  <img class="frost-part frost-core" src="/ui/procs/frost-phoenix-v1.webp" alt="" draggable="false" />
  <img class="frost-part frost-ready" src="/ui/procs/frost-phoenix-v1.webp" alt="" draggable="false" />
</div>
<div class="necromancy-bank" aria-hidden="true">
  <span class="soul-rail"></span>
  <span class="soul-crystal soul-crystal-1"></span>
  <span class="soul-crystal soul-crystal-2"></span>
  <span class="soul-crystal soul-crystal-3"></span>
  <span class="soul-crystal soul-crystal-4"></span>
  <span class="soul-crystal soul-crystal-5"></span>
</div>
<div class="ruin-ritual" aria-hidden="true">
  <span class="ruin-ring"></span>
  <span class="ruin-mark ruin-mark-1"></span>
  <span class="ruin-mark ruin-mark-2"></span>
  <span class="ruin-mark ruin-mark-3"></span>
  <span class="ruin-mark ruin-mark-4"></span>
  <span class="ruin-mark ruin-mark-5"></span>
</div>`;
  return el;
}
