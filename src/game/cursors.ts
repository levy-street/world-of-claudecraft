// Game cursor PNGs live in public/ui/cursors/ (served from ./ui/cursors/ at runtime).
import { resolvePublicAssetUrl } from '../runtime_assets';

export type HoverCursorKind = 'default' | 'attack' | 'friendly';

export function cursorUrlForBase(
  file: string,
  hotX: number,
  hotY: number,
  fallback: string,
  baseUrl = import.meta.env.BASE_URL,
): string {
  return `url("${resolvePublicAssetUrl(`/ui/cursors/${file}`, baseUrl)}") ${hotX} ${hotY}, ${fallback}`;
}

/** Default cursor: the ornate arrow. */
export const CURSOR_HAND = cursorUrlForBase('arrow.png', 7, 2, 'default');

/** Camera drag while mouse-look is enabled. */
export const CURSOR_GRAB = cursorUrlForBase('hand-grab.png', 11, 16, 'grabbing');

/** Anything interactive under the pointer: the ornate gauntlet finger. */
export const CURSOR_ATTACK = cursorUrlForBase('gauntlet.png', 6, 4, 'pointer');

/** Players, party members and friendly NPCs: also the gauntlet finger. */
export const CURSOR_FRIENDLY = cursorUrlForBase('gauntlet.png', 6, 4, 'pointer');

export function cursorForHover(kind: HoverCursorKind, draggingCamera: boolean): string {
  if (draggingCamera) return CURSOR_GRAB;
  switch (kind) {
    case 'attack':
      return CURSOR_ATTACK;
    case 'friendly':
      return CURSOR_FRIENDLY;
    default:
      return CURSOR_HAND;
  }
}
