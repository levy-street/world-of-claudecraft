// Thin DOM binding for the pure world-map pinch state machine.

import {
  MapPinchZoomCore,
  type MapTapDecision,
  type MapTapPoint,
  type MapTapRelease,
} from './map_pinch_zoom_core';

export interface MapPinchZoomBinding {
  isPinching(): boolean;
  resolveTap(release: MapTapRelease): MapTapDecision;
}

interface MapPinchZoomHooks {
  onPinchStart(): void;
  onZoom(factor: number): void;
}

export function mapTapReleaseFromPointer(
  event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId' | 'pointerType'>,
  start: MapTapPoint | null,
  tolerance: number,
): MapTapRelease {
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    start,
    end: { x: event.clientX, y: event.clientY },
    tolerance,
  };
}

export function finishMapTap(
  binding: MapPinchZoomBinding,
  release: MapTapRelease,
  showTap: (x: number, y: number) => unknown,
): void {
  if (binding.resolveTap(release) === 'show') showTap(release.end.x, release.end.y);
}

export function bindMapPinchZoom(
  canvas: HTMLCanvasElement,
  hooks: MapPinchZoomHooks,
): MapPinchZoomBinding {
  const core = new MapPinchZoomCore();

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    const transition = core.pointerDown({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    canvas.setPointerCapture(event.pointerId);
    if (transition.preventDefault) event.preventDefault();
    if (transition.pinchStarted) hooks.onPinchStart();
  });

  canvas.addEventListener('pointermove', (event) => {
    const transition = core.pointerMove({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    if (transition.preventDefault) event.preventDefault();
    if (transition.zoomFactor !== null) hooks.onZoom(transition.zoomFactor);
  });

  const endPinchPointer = (event: PointerEvent): void => {
    core.pointerEnd(event.pointerId);
  };
  const losePinchPointer = (event: PointerEvent): void => {
    core.pointerLost(event.pointerId);
  };
  canvas.addEventListener('pointerup', endPinchPointer);
  canvas.addEventListener('pointercancel', endPinchPointer);
  canvas.addEventListener('lostpointercapture', losePinchPointer);

  return {
    isPinching: () => core.isPinching(),
    resolveTap: (release) => core.resolveTap(release),
  };
}
