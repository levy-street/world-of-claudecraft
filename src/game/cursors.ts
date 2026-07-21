// Game cursor PNGs live in public/ui/cursors/ (served from ./ui/cursors/ at runtime).

export type HoverCursorKind = 'default' | 'attack' | 'friendly';

const BASE = import.meta.env.BASE_URL;

function pngCursor(file: string, hotX: number, hotY: number, fallback: string): string {
  return `url("${BASE}ui/cursors/${file}") ${hotX} ${hotY}, ${fallback}`;
}

/** Default cursor — the ornate arrow. */
export const CURSOR_HAND = pngCursor('arrow.png', 7, 2, 'default');

/** Camera drag while mouse-look is enabled. */
export const CURSOR_GRAB = pngCursor('hand-grab.png', 11, 16, 'grabbing');

/** Anything interactive under the pointer — the ornate gauntlet finger. */
export const CURSOR_ATTACK = pngCursor('gauntlet.png', 6, 4, 'pointer');

/** Players, party members and friendly NPCs — also the gauntlet finger. */
export const CURSOR_FRIENDLY = pngCursor('gauntlet.png', 6, 4, 'pointer');

export function cursorForHover(kind: HoverCursorKind, draggingCamera: boolean): string {
  if (draggingCamera) return CURSOR_GRAB;
  switch (kind) {
    case 'attack': return CURSOR_ATTACK;
    case 'friendly': return CURSOR_FRIENDLY;
    default: return CURSOR_HAND;
  }
}
