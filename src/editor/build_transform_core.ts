// Build-mode transform decisions. The host owns the placement and its undo entry.
import { scaleStep, wrapAngle } from './placement_transform_core';

export type BuildTransformAction = 'rotateLeft' | 'rotateRight' | 'smaller' | 'larger';

export interface BuildTransformState {
  rotY: number;
  scale: number;
}

export interface BuildTransformKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  typing?: boolean;
}

/** Keyboard mapping is deliberately modifier-free so browser/edit shortcuts win. */
export function buildTransformActionForKey(input: BuildTransformKey): BuildTransformAction | null {
  if (
    input.typing ||
    input.isComposing ||
    input.defaultPrevented ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey ||
    input.shiftKey
  ) {
    return null;
  }
  switch (input.key) {
    case ',':
      return 'rotateLeft';
    case '.':
      return 'rotateRight';
    case '[':
      return 'smaller';
    case ']':
      return 'larger';
    default:
      return null;
  }
}

/** Rotate in 45-degree steps (15 when fine), or resize using the shared 10% step. */
export function applyBuildTransform(
  current: BuildTransformState,
  action: BuildTransformAction,
  fineRotation = false,
): BuildTransformState {
  const next = { ...current };
  switch (action) {
    case 'rotateLeft':
    case 'rotateRight': {
      const step = fineRotation ? Math.PI / 12 : Math.PI / 4;
      const direction = action === 'rotateLeft' ? -1 : 1;
      next.rotY = wrapAngle(current.rotY + direction * step);
      break;
    }
    case 'smaller':
    case 'larger':
      next.scale = scaleStep(current.scale, action === 'smaller' ? 1 : -1);
      break;
  }
  return next;
}
