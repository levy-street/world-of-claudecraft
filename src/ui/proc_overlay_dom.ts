// The Rising Phoenix proc overlay markup (owner design 2026-07-11, replacing
// the twin proc arcs): painted Fire and Chronomancy phoenixes whose image layers
// are clipped in CSS so their wings can animate independently.
// Creation-time DOM only (built once by the Hud): the per-frame work stays the
// two toggled classes in proc_overlay_painter, and the pure state rule stays
// in proc_overlay_view. Both variants reuse a single transparent asset across
// their layers, keeping the silhouettes perfectly aligned during transitions.

/** Build the #proc-overlay element (not yet attached to the document). */
export function buildProcOverlay(doc: Document = document): HTMLElement {
  const el = doc.createElement('div');
  el.id = 'proc-overlay';
  el.setAttribute('aria-hidden', 'true'); // decorative fire, never announced
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
</div>`;
  return el;
}
