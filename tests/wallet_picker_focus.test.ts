import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The pre-game $WOC wallet picker routes through the ONE shared FocusManager
// (src/ui/focus_manager), not a second hand-rolled focus trap (the single-FocusManager
// invariant). src/main.ts is the whole client entry (it boots the app on import, far too
// heavy for a Node test), so this pins the unification by source-grep: the old ad-hoc trap is
// gone and the shared manager is used. The trap WIRING itself (the Tab/Shift+Tab cycle,
// focus-first-skip-close, return-to-opener, the do-not-trap-from-the-game-world guard) is
// covered behaviorally by tests/focus_manager.test.ts; a bare vitest run stays browser-free,
// so the real-browser keyboard E2E over this modal is out of scope here.
const mainSrc = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

describe('wallet picker uses the shared FocusManager', () => {
  it('imports the shared FocusManager from src/ui/focus_manager', () => {
    expect(mainSrc).toMatch(
      /import\s*\{[^}]*\bFocusManager\b[^}]*\}\s*from\s*'\.\/ui\/focus_manager'/,
    );
  });

  it('opens the trap over the panel via a module-local FocusManager instance and releases it', () => {
    // A module-local INSTANCE (no module singleton is exported from
    // focus_manager); the wallet picker opens the trap over its panel and releases it on close.
    expect(mainSrc).toContain('new FocusManager()');
    expect(mainSrc).toMatch(/walletPickerFocusHandle\s*=\s*walletFocusManager\.open\(/);
    expect(mainSrc).toContain('focusHandle?.release(returnFocus);');
    // The re-entrant re-open path closes the prior picker WITHOUT returning focus, so the
    // deferred opener focus cannot steal focus from the new modal opening synchronously.
    expect(mainSrc).toContain('closeWalletPicker(null, false);');
  });

  it('preserves the original opener across a re-entrant re-open (return focus is byte-faithful)', () => {
    // The re-entrant close detaches the prior modal (dropping focus to document.body), so the
    // opener is captured ONCE on the first open into walletPickerOpener and reused, not re-read
    // from document.activeElement on the re-open; release(true) returns there, never to body.
    expect(mainSrc).toMatch(/const reentrant\s*=\s*walletPickerResolve\s*!==\s*null;/);
    expect(mainSrc).toMatch(/returnFocusTo:\s*walletPickerOpener/);
    expect(mainSrc).toMatch(/if\s*\(!reentrant\)\s*\{/);
  });

  it('deletes the old hand-rolled focus trap (no walletPickerFocusable / walletPickerReturnFocus)', () => {
    expect(mainSrc).not.toContain('walletPickerFocusable');
    expect(mainSrc).not.toContain('walletPickerReturnFocus');
  });

  it('keeps the modal-owned Escape (the manager owns no Escape) and the backdrop-click close', () => {
    // The wallet picker is a pre-game shell modal, not a hud.closeAll window, so it retains
    // its own Escape and backdrop-click close after the FocusManager unification; the inline
    // Tab cycle (which used the deleted focusable list) is gone with that list.
    expect(mainSrc).toContain("if (e.key !== 'Escape') return;");
    expect(mainSrc).toContain('if (e.target === back) close();');
  });
});
