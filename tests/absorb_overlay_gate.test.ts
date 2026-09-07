// The Show Absorb Shields gate for the player / target unit-frame overlays
// (src/ui/absorb_overlay_gate.ts): the option flips ONE root class, hud.css hides
// every `.bar-absorb` beneath it, and main.ts routes the `partyFrameShowAbsorbs`
// option through the gate (the party rows keep reading the same key live). Before
// this seam the option only reached the party rows, so a player / target frame
// kept its shield hatch with the option off.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOL_SETTINGS } from '../src/game/settings';
import { ABSORB_OVERLAY_HIDDEN_CLASS, applyAbsorbOverlayGate } from '../src/ui/absorb_overlay_gate';

function host() {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle(token: string, force?: boolean): boolean {
        const on = force ?? !classes.has(token);
        if (on) classes.add(token);
        else classes.delete(token);
        return on;
      },
    },
  };
}

describe('applyAbsorbOverlayGate', () => {
  it('adds the hidden class when shields are turned off and removes it when on', () => {
    const h = host();
    applyAbsorbOverlayGate(h, false);
    expect(h.classes.has(ABSORB_OVERLAY_HIDDEN_CLASS)).toBe(true);
    applyAbsorbOverlayGate(h, true);
    expect(h.classes.has(ABSORB_OVERLAY_HIDDEN_CLASS)).toBe(false);
  });

  it('is idempotent (applying the same state twice leaves one class state)', () => {
    const h = host();
    applyAbsorbOverlayGate(h, false);
    applyAbsorbOverlayGate(h, false);
    expect(h.classes.has(ABSORB_OVERLAY_HIDDEN_CLASS)).toBe(true);
    applyAbsorbOverlayGate(h, true);
    applyAbsorbOverlayGate(h, true);
    expect(h.classes.has(ABSORB_OVERLAY_HIDDEN_CLASS)).toBe(false);
  });
});

describe('absorb overlay gate wiring', () => {
  it('hud.css hides every .bar-absorb under the root hidden class', () => {
    const css = readFileSync('src/styles/hud.css', 'utf8');
    const rule = new RegExp(
      `\\.${ABSORB_OVERLAY_HIDDEN_CLASS}\\s+\\.bar-absorb\\s*\\{[^}]*display:\\s*none`,
    );
    expect(css).toMatch(rule);
  });

  it('main.ts routes the partyFrameShowAbsorbs option through the gate', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(/import \{ applyAbsorbOverlayGate \} from '\.\/ui\/absorb_overlay_gate'/);
    const branch = main.indexOf("if (key === 'partyFrameShowAbsorbs') {");
    expect(branch).toBeGreaterThan(-1);
    const body = main.slice(branch, main.indexOf('return;', branch));
    expect(body).toContain('applyAbsorbOverlayGate(document.documentElement');
    expect(body).toContain('settings.set(key, !!value)');
  });

  it('main.ts replays every persisted setting through applySetting at boot, so a saved off survives reload', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(
      /const saved = settings\.all\(\);\s*for \(const k of Object\.keys\(saved\) as \(keyof GameSettings\)\[\]\) applySetting\(k, saved\[k\]\);/,
    );
  });

  it('the option key still exists with shields shown by default', () => {
    expect(BOOL_SETTINGS.partyFrameShowAbsorbs).toEqual({ def: true });
  });
});
