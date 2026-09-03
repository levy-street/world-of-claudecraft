// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GamepadBindingEntry } from '../src/game/gamepad_bindings';
import { GAMEPAD_CYCLE_HUD, type GamepadKind, GP } from '../src/game/gamepad_map';
import { createLauncherHintController } from '../src/ui/launcher_hint_controller';

const repoRoot = process.cwd();

function hintMarkup(): HTMLElement {
  const root = document.createElement('div');
  root.hidden = true;
  root.innerHTML = `
    <span class="launcher-cycle-hint-key tut-keycap"></span>
    <span class="launcher-cycle-hint-label"></span>
  `;
  return root;
}

describe('launcher hint controller', () => {
  let entries: GamepadBindingEntry[];
  let kind: GamepadKind;

  beforeEach(() => {
    entries = [{ button: GP.R3, action: GAMEPAD_CYCLE_HUD }];
    kind = 'xbox';
  });

  it('resolves the live binding and controller label family', () => {
    const root = hintMarkup();
    const controller = createLauncherHintController(root, {
      entries: () => entries,
      kind: () => kind,
    });

    controller.refresh();
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.launcher-cycle-hint-key')?.textContent).toBe('R3');
    expect(root.querySelector('.launcher-cycle-hint-label')?.textContent).toBe('Cycle Interface');

    entries = [
      { button: GP.R3, action: 'target' },
      { button: GP.L3, action: GAMEPAD_CYCLE_HUD },
    ];
    kind = 'nintendo';
    controller.refresh();
    expect(root.querySelector('.launcher-cycle-hint-key')?.textContent).toBe('L Stick');
  });

  it('hides and clears the hint when Cycle Interface is unbound', () => {
    const root = hintMarkup();
    const controller = createLauncherHintController(root, {
      entries: () => entries,
      kind: () => kind,
    });
    controller.refresh();

    entries = [{ button: GP.R3, action: 'none' }];
    controller.refresh();

    expect(root.hidden).toBe(true);
    expect(root.querySelector('.launcher-cycle-hint-key')?.textContent).toBe('');
  });

  it('suppresses the hint while virtual mouse owns controller input', () => {
    const root = hintMarkup();
    const controller = createLauncherHintController(root, {
      entries: () => entries,
      kind: () => kind,
    });
    controller.refresh();

    controller.setSuppressed(true);
    expect(root.hidden).toBe(true);

    controller.setSuppressed(false);
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.launcher-cycle-hint-key')?.textContent).toBe('R3');
  });

  it('rejects incomplete entry markup instead of silently losing the key label', () => {
    expect(() =>
      createLauncherHintController(document.createElement('div'), {
        entries: () => entries,
        kind: () => kind,
      }),
    ).toThrow('Launcher hint markup is incomplete');
  });
});

describe('launcher hint entry and CSS contract', () => {
  const htmlEntries = ['index.html', 'play.html'];

  it.each(htmlEntries)('%s exposes the same semantic launcher entry', (entry) => {
    const html = readFileSync(join(repoRoot, entry), 'utf8');
    expect(html).toContain('<div id="side-buttons" data-pad-launcher-root>');
    expect(html).toContain(
      'id="side-buttons-col-a" class="side-buttons-col" data-pad-launcher-entry-column',
    );
    expect(html).toContain('id="mm-char" data-pad-launcher-entry');
    expect(html).toContain('id="side-buttons-cycle-hint" class="launcher-cycle-hint" hidden');
    expect(html).toContain('data-i18n="hudChrome.controller.cycleHudAction"');
    expect(html).not.toMatch(/launcher-cycle-hint-key[^>]*>\s*(?:R3|R Stick)/);
  });

  it('shows only for pad ownership and explicitly stays out of touch layouts', () => {
    const desktopCss = readFileSync(join(repoRoot, 'src/styles/hud.css'), 'utf8');
    const mobileCss = readFileSync(join(repoRoot, 'src/styles/hud.mobile.css'), 'utf8');

    expect(desktopCss).toContain(
      'body.pad-active:not(.mobile-touch) .launcher-cycle-hint:not([hidden])',
    );
    expect(desktopCss).toMatch(/\.launcher-cycle-hint\s*{[^}]*display:\s*none;/s);
    expect(desktopCss).toMatch(
      /\.launcher-cycle-hint\s*{[^}]*border-radius:\s*var\(--radius-md\);[^}]*background:\s*var\(--panel-bg\);[^}]*color:\s*var\(--color-accent\);/s,
    );
    expect(desktopCss).toMatch(/\.launcher-cycle-hint\[hidden\]\s*{[^}]*display:\s*none;/s);
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.launcher-cycle-hint\s*{[^}]*display:\s*none !important;/s,
    );
    expect(desktopCss).not.toMatch(/\.launcher-cycle-hint[^}]*animation:/s);
    expect(desktopCss).toMatch(
      /@media \(forced-colors: active\)\s*{\s*\.launcher-cycle-hint\s*{[^}]*CanvasText/s,
    );
  });
});
