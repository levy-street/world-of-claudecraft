import type { SimEvent } from '../sim/types';

/**
 * Accept authoritative simulation seconds from a server wire frame.
 * Missing or malformed additive fields leave the last valid mirror intact.
 */
export function presentationTimeAfterWire(current: number, candidate: unknown): number {
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
    ? candidate
    : current;
}

/** Preserve the event batch's clock until presentation consumers drain it. */
export function stampScenePresentationTime(event: SimEvent, presentationTime: number): SimEvent {
  switch (event.type) {
    case 'scene':
    case 'sceneChoice':
    case 'sceneChoiceResult':
    case 'sceneSync':
    case 'sceneChoiceSync':
      return { ...event, presentationTime };
    default:
      return event;
  }
}
