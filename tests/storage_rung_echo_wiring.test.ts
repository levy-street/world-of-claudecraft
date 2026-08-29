// Source-text wiring pins for the storage-rung refusal path in src/ui/hud.ts
// (hud.ts boots a full HUD on import, so the wiring is verified structurally,
// the tests/server/main_retention_wiring.test.ts idiom). Comment-stripped so a
// commented-out call can never satisfy a pin, and anchored to the repo root so
// the read cannot silently depend on the runner's cwd.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

const HUD = stripComments(readFileSync(join(__dirname, '..', 'src', 'ui', 'hud.ts'), 'utf8'));

describe('storage rung authoritative-refusal wiring', () => {
  it('observes raw error and log text before either localization path transforms it', () => {
    expect(HUD).toContain('this.localizeErrorText(this.bankWindow.observeStorageText(ev.text))');
    expect(HUD).toContain('this.localizeSystemText(this.bankWindow.observeStorageText(ev.text))');
    expect(HUD.match(/observeStorageText\(ev\.text\)/g)).toHaveLength(2);
  });
});

describe('store result closeAll wiring', () => {
  it('clears the nonmodal store result as the first closeAll rung', () => {
    // The panel sits above every window (z 96) and can outlive its Store
    // surface, so Escape must reach it through the HUD's single dispatcher
    // (main.ts game input -> hud.closeAll()), ahead of the window ladder.
    const rung = HUD.indexOf('if (clearOpenStoreResult()) return true;');
    expect(rung).toBeGreaterThan(-1);
    expect(rung).toBeLessThan(HUD.indexOf('if (closeOpenTouchMenu()) return true;'));
  });
});
