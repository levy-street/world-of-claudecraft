// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { hudOverlayHost } from '../src/ui/hud_overlay_host';

// The full-screen overlay layers (Cooldown Manager, aura overlays) share the
// Performance overlay's layering: inside #ui, under the window band at rest
// (Hud.bringWindowToFront raises windows within z 50 to 89), and raised over
// the Options window only while placing (#perf-overlay.placing is z 96).
const hudCss = readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8');
const WINDOW_BAND_FLOOR = 50;

function zIndexOf(selector: string): number {
  const escaped = selector.replace(/[.#]/g, (c) => `\\${c}`);
  const match = hudCss.match(new RegExp(`^\\s*${escaped}\\s*\\{[^}]*?z-index:\\s*(\\d+)`, 'm'));
  if (!match) throw new Error(`no z-index rule for ${selector}`);
  return Number(match[1]);
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('hudOverlayHost', () => {
  it('returns #ui when the game UI shell is mounted', () => {
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.appendChild(ui);
    expect(hudOverlayHost(document)).toBe(ui);
  });

  it('falls back to <body> without a game UI shell', () => {
    expect(hudOverlayHost(document)).toBe(document.body);
  });
});

describe('HUD overlay layer z-order', () => {
  it.each(['#cooldown-manager', '#aura-overlays'])(
    '%s rests under the window band and places like #perf-overlay',
    (id) => {
      expect(zIndexOf(id)).toBeLessThan(WINDOW_BAND_FLOOR);
      expect(zIndexOf(`${id}.placement`)).toBe(zIndexOf('#perf-overlay.placing'));
    },
  );
});
