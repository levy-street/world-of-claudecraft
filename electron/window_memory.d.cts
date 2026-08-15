// Hand-written declarations for electron/window_memory.cjs so the Vitest suite
// (tests/electron_window_memory.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts).

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  workArea: WindowRect;
}

export interface SavedWindowMemory {
  windowBounds?: WindowRect;
  displayId?: number;
  maximized?: boolean;
}

export interface WindowRestoreInput {
  saved?: SavedWindowMemory | null;
  displays?: DisplayLike[];
  primaryId?: number;
  defaults?: { width?: number; height?: number };
}

export interface WindowRestore extends WindowRect {
  maximized: boolean;
  restored: boolean;
}

export const MIN_WINDOW_WIDTH: number;
export const MIN_WINDOW_HEIGHT: number;
export const MAX_WINDOW_DIMENSION: number;
export const MIN_WINDOW_POSITION: number;
export const MAX_WINDOW_POSITION: number;
export const MIN_VISIBLE_WIDTH: number;
export const MIN_VISIBLE_HEIGHT: number;
export function boundsUsableOn(bounds: WindowRect, workArea: WindowRect): boolean;
export function nearestDisplay(
  displays: DisplayLike[],
  point: { x: number; y: number },
): DisplayLike | null;
export function resolveWindowRestore(input?: WindowRestoreInput): WindowRestore;
