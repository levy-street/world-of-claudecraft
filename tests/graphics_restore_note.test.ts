// @vitest-environment happy-dom
// The "restoring graphics" note over the 3D view while a WebGL context
// restore holds the world draw (src/ui/graphics_restore_note_view.ts and its
// controller): shown on the hold's raise, hidden on its release, a polite
// status line that never takes a pointer.
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginContextRestoreHold,
  endContextRestoreHold,
  resetContextRestoreHoldForTest,
} from '../src/render/context_restore_hold';
import {
  GRAPHICS_RESTORE_NOTE_ID,
  installGraphicsRestoreNote,
} from '../src/ui/graphics_restore_note_controller';
import {
  GRAPHICS_RESTORE_NOTE_KEY,
  graphicsRestoreNoteView,
} from '../src/ui/graphics_restore_note_view';
import { t } from '../src/ui/i18n';

afterEach(() => {
  resetContextRestoreHoldForTest();
  document.body.innerHTML = '';
});

describe('graphicsRestoreNoteView', () => {
  it('shows only while the world draw is held, with the one key', () => {
    expect(graphicsRestoreNoteView(true)).toEqual({
      visible: true,
      textKey: GRAPHICS_RESTORE_NOTE_KEY,
    });
    expect(graphicsRestoreNoteView(false)).toEqual({
      visible: false,
      textKey: GRAPHICS_RESTORE_NOTE_KEY,
    });
    expect(t(GRAPHICS_RESTORE_NOTE_KEY)).toBe('Restoring graphics');
  });
});

describe('installGraphicsRestoreNote', () => {
  it('mints an empty hidden live region, then shows and hides the status line on the hold edges', () => {
    const ui = document.createElement('div');
    document.body.appendChild(ui);
    const teardown = installGraphicsRestoreNote(ui);
    const note = document.getElementById(GRAPHICS_RESTORE_NOTE_ID) as HTMLElement;
    // Present before any hold, empty and hidden: a region inserted together
    // with its text is often not announced.
    expect(note).not.toBeNull();
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
    beginContextRestoreHold(3000, 0);
    expect(note.parentElement).toBe(ui);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Restoring graphics');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.getAttribute('aria-live')).toBe('polite');
    expect(note.classList.contains('ui-pill')).toBe(true);
    endContextRestoreHold();
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
    // A second restore reuses the same node.
    beginContextRestoreHold(3000, 0);
    expect(document.querySelectorAll(`#${GRAPHICS_RESTORE_NOTE_ID}`)).toHaveLength(1);
    expect(note.hidden).toBe(false);
    teardown();
    expect(document.getElementById(GRAPHICS_RESTORE_NOTE_ID)).toBeNull();
    endContextRestoreHold();
  });

  it('a note mounted during a hold shows at once', () => {
    beginContextRestoreHold(3000, 0);
    const teardown = installGraphicsRestoreNote(document.body);
    expect((document.getElementById(GRAPHICS_RESTORE_NOTE_ID) as HTMLElement).hidden).toBe(false);
    teardown();
  });

  it('the section keeps the note off the pointer path and centred over the blank view', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '../src/styles/hud.css'), 'utf8');
    const section = css.slice(
      css.indexOf('/* ---------- graphics restore note ---------- */'),
      css.indexOf('/* ---------- Hide Interface'),
    );
    expect(section).toContain('pointer-events: none;');
    expect(section).toContain('.graphics-restore-note[hidden]');
    expect(section).toContain('display: none;');
    expect(section).toContain('prefers-reduced-motion');
    // Reduced motion keeps the delay (no flash on a short hold), drops the fade.
    expect(section).not.toContain('animation: none');
    expect(section).toContain('animation-duration: 0s;');
  });
});
