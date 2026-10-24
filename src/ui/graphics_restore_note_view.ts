// What the "restoring graphics" note shows. The note sits over the 3D view
// while a WebGL context restore withholds the world draw
// (src/render/context_restore_hold.ts), so a player who saw the world go blank
// for a moment knows it was the graphics context coming back, not lag. The
// hold is the only input: the note has nothing to say outside it, and the
// HUD under it stays live either way.

export const GRAPHICS_RESTORE_NOTE_KEY = 'hudChrome.graphicsRestore.note' as const;

export interface GraphicsRestoreNoteView {
  visible: boolean;
  textKey: typeof GRAPHICS_RESTORE_NOTE_KEY;
}

const HIDDEN: GraphicsRestoreNoteView = Object.freeze({
  visible: false,
  textKey: GRAPHICS_RESTORE_NOTE_KEY,
});
const SHOWN: GraphicsRestoreNoteView = Object.freeze({
  visible: true,
  textKey: GRAPHICS_RESTORE_NOTE_KEY,
});

export function graphicsRestoreNoteView(held: boolean): GraphicsRestoreNoteView {
  return held ? SHOWN : HIDDEN;
}
