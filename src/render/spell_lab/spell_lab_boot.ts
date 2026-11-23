// Boots the Spell & VFX Review Lab (`?spells=on`, or `Alt+Shift+S` in dev builds).
// Imported for its side effect by `post.ts` (the game renderer's composer) so the
// guide and editor pages never load it, and normal sessions fetch the runtime
// chunk only when `?spells=on` is present or the developer presses `Alt+Shift+S`.
// The literal `import.meta.env.DEV` in this module's own condition is what lets the
// production bundler drop the `import()` and never emit the runtime chunk: a flag
// read from another module is not folded (tests/spell_lab_boot.test.ts).

import { spellLabAutoOpen, spellLabDevEnabled } from './spell_lab_flag';

if (import.meta.env.DEV && typeof document !== 'undefined') {
  if (spellLabAutoOpen()) {
    void import('./spell_lab_runtime').then((m) => m.startSpellLab());
  } else if (spellLabDevEnabled() && typeof window !== 'undefined') {
    const onShortcut = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        window.removeEventListener('keydown', onShortcut);
        void import('./spell_lab_runtime').then((m) => m.startSpellLab().open());
      }
    };
    window.addEventListener('keydown', onShortcut);
  }
}
