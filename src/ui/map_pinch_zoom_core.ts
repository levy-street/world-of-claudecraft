// Pure gesture state for world-map pinch zoom.
//
// Pointer-shaped inputs enter here, while the DOM binding owns PointerEvent,
// pointer capture, and preventDefault. Keeping the state machine host-free makes
// deadzone, pointer replacement, and tap arbitration directly testable.

import { MAP_MAX_ZOOM } from './map_window_view';

export const MAP_MIN_ZOOM = 1;
export const MAP_PINCH_DEADZONE_PX = 8;
export const MAP_TAP_MOVE_TOLERANCE_PX = 10;

export interface MapPinchPointer {
  pointerId: number;
  x: number;
  y: number;
}

export interface MapPinchTransition {
  pinchStarted: boolean;
  preventDefault: boolean;
  zoomFactor: number | null;
}

export interface MapTapPoint {
  x: number;
  y: number;
}

export interface MapTapRelease {
  pointerId: number;
  pointerType: string;
  start: MapTapPoint | null;
  end: MapTapPoint;
  tolerance: number;
}

export type MapTapDecision = 'ignore' | 'show' | 'suppressed';

const idleTransition = (): MapPinchTransition => ({
  pinchStarted: false,
  preventDefault: false,
  zoomFactor: null,
});

export function mapPinchZoomFactor(
  previousDistance: number,
  currentDistance: number,
  deadzone = MAP_PINCH_DEADZONE_PX,
): number {
  if (
    !Number.isFinite(previousDistance) ||
    !Number.isFinite(currentDistance) ||
    previousDistance <= 0 ||
    currentDistance <= 0 ||
    Math.abs(currentDistance - previousDistance) < deadzone
  )
    return 1;
  return currentDistance / previousDistance;
}

export function nextMapZoom(currentZoom: number, factor: number): number {
  return Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, currentZoom * factor));
}

export class MapPinchZoomCore {
  private readonly pointers = new Map<number, MapTapPoint>();
  private readonly suppressedTaps = new Set<number>();
  private previousDistance: number | null = null;

  pointerDown(pointer: MapPinchPointer): MapPinchTransition {
    this.pointers.set(pointer.pointerId, { x: pointer.x, y: pointer.y });
    if (this.pointers.size < 2) return idleTransition();
    for (const pointerId of this.pointers.keys()) this.suppressedTaps.add(pointerId);
    if (this.pointers.size !== 2) {
      this.previousDistance = null;
      return idleTransition();
    }
    this.previousDistance = this.pinchDistance();
    return {
      pinchStarted: true,
      preventDefault: true,
      zoomFactor: null,
    };
  }

  pointerMove(pointer: MapPinchPointer): MapPinchTransition {
    if (!this.pointers.has(pointer.pointerId)) return idleTransition();
    this.pointers.set(pointer.pointerId, { x: pointer.x, y: pointer.y });
    if (this.pointers.size !== 2 || this.previousDistance === null) return idleTransition();

    const currentDistance = this.pinchDistance();
    if (!Number.isFinite(currentDistance) || currentDistance <= 0) {
      this.previousDistance = currentDistance;
      return {
        pinchStarted: false,
        preventDefault: true,
        zoomFactor: null,
      };
    }
    if (!Number.isFinite(this.previousDistance) || this.previousDistance <= 0) {
      this.previousDistance = currentDistance;
      return {
        pinchStarted: false,
        preventDefault: true,
        zoomFactor: null,
      };
    }

    const factor = mapPinchZoomFactor(this.previousDistance, currentDistance);
    if (factor === 1) {
      return {
        pinchStarted: false,
        preventDefault: true,
        zoomFactor: null,
      };
    }
    this.previousDistance = currentDistance;
    return {
      pinchStarted: false,
      preventDefault: true,
      zoomFactor: factor,
    };
  }

  pointerEnd(pointerId: number): MapPinchTransition {
    if (!this.pointers.delete(pointerId)) return idleTransition();
    // Replacing one finger after a third touch only establishes a new baseline.
    // The original pinch already cancelled map pan, so this is not a new start.
    this.previousDistance = this.pointers.size === 2 ? this.pinchDistance() : null;
    return idleTransition();
  }

  pointerLost(pointerId: number): MapPinchTransition {
    const transition = this.pointerEnd(pointerId);
    this.suppressedTaps.delete(pointerId);
    return transition;
  }

  isPinching(): boolean {
    return this.pointers.size > 1;
  }

  resolveTap(release: MapTapRelease): MapTapDecision {
    if (this.suppressedTaps.delete(release.pointerId)) return 'suppressed';
    if (release.pointerType === 'mouse' || !release.start) return 'ignore';
    const moved = Math.hypot(release.end.x - release.start.x, release.end.y - release.start.y);
    return moved <= release.tolerance ? 'show' : 'ignore';
  }

  private pinchDistance(): number {
    if (this.pointers.size !== 2) return 0;
    const [first, second] = [...this.pointers.values()];
    return Math.hypot(second.x - first.x, second.y - first.y);
  }
}
