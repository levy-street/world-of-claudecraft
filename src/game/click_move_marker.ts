// The click-to-move destination marker's DOM writes, called once per frame from
// the client loop in src/main.ts (moved out of it verbatim; the marker is the
// input layer's own overlay, composed where no PainterHost facet exists, so its
// writes are raw and elided here). Every class flip goes through
// DOMTokenList.toggle with a force flag: with the token already in the requested
// state it returns without touching the attribute, where add/remove rewrite the
// class attribute on every call and hand the HUD's window observer a
// MutationRecord per frame. The transform write is per frame while the marker
// shows (the target moves under the camera) and Blink drops a same-value
// declaration; the one forced-reflow read restarts the pulse animation and runs
// only when the pulse counter changes.

export interface ClickMoveMarkerShown {
  x: number;
  y: number;
  entity: boolean;
  blocked: boolean;
  pulse: number;
  pulseChanged: boolean;
}

/** 'hidden' drops every state class; 'offscreen' keeps only the entity tint. */
export type ClickMoveMarkerPaint = 'hidden' | 'offscreen' | ClickMoveMarkerShown;

export function paintClickMoveMarker(el: HTMLElement, paint: ClickMoveMarkerPaint): void {
  const cls = el.classList;
  if (paint === 'hidden' || paint === 'offscreen') {
    cls.toggle('active', false);
    cls.toggle('pulse', false);
    cls.toggle('blocked', false);
    if (paint === 'hidden') cls.toggle('entity', false);
    return;
  }
  el.style.transform = `translate(${paint.x.toFixed(0)}px, ${paint.y.toFixed(0)}px) translate(-50%, -50%)`;
  cls.toggle('entity', paint.entity);
  cls.toggle('blocked', paint.blocked);
  cls.toggle('active', true);
  const pulse = String(paint.pulse);
  if (paint.pulseChanged || el.dataset.pulse !== pulse) {
    el.dataset.pulse = pulse;
    cls.remove('pulse');
    void el.offsetWidth;
    cls.add('pulse');
  }
}
