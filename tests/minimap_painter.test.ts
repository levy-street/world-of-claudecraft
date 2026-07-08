// No-magic-values + cadence guard for the overworld minimap painter (canvas
// sub-rule). The painter's paintOverworld needs a real 2D context +
// getComputedStyle, so its draw is not exercised in this Node suite; the pure marker
// geometry it draws is covered by tests/minimap_markers.test.ts. This guard pins the
// painter contract a 2D context cannot express: zero literal colors (the
// --color-minimap-* tokens resolved once per redraw, never per-marker), the Hud-owned
// cached terrain background blitted (not rebuilt), and the ~10Hz fastHud cadence + the
// '#zone-label' setText preserved from the inline site.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const painter = readFileSync(new URL('../src/ui/minimap_painter.ts', import.meta.url), 'utf8');
// Drop comments so prose can't create a false positive (mirrors architecture.test).
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const MINIMAP_COLOR_TOKENS = [
  '--color-minimap-ally-friend',
  '--color-minimap-ally-guild',
  '--color-minimap-npc-quest',
  '--color-minimap-portal',
  '--color-minimap-object-loot',
  '--color-minimap-mob-aggro',
  '--color-minimap-mob',
  '--color-minimap-mob-loot',
  '--color-minimap-party-dead',
  '--color-minimap-party-pip',
  '--color-minimap-player',
  '--color-minimap-outline',
];

describe('minimap_painter: no magic values (canvas sub-rule)', () => {
  it('carries no literal hex or rgb color in TS', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('resolves --color-minimap-* tokens via getComputedStyle exactly once per redraw', () => {
    expect(code).toContain('getComputedStyle');
    expect(code).toContain('getPropertyValue');
    expect(code).toContain('--color-minimap-');
    expect(code).toContain('resolveColors');
    // One getComputedStyle call site total: resolved once per paint into a colors
    // object, never re-read inside a per-marker draw loop.
    expect(code.match(/getComputedStyle/g) ?? []).toHaveLength(1);
  });

  it('resolves the tokens once in paintOverworld, never inside the per-marker draw loop', () => {
    // Cadence teeth that survive a call-site MOVE (the textual getComputedStyle count
    // alone would not catch relocating the resolve into the per-marker loop, since the
    // string lives only at the definition site). The per-marker loop lives in
    // drawMarkers; assert resolveColors() is called exactly once per entry point
    // (paintOverworld + the Protect Yumi paintYumiMaze) and is never referenced inside
    // the drawMarkers body. A runtime getComputedStyle spy is deferred to the browser
    // suite.
    expect(code.match(/this\.resolveColors\(\)/g) ?? []).toHaveLength(2);
    const drawMarkersBody = code.slice(code.indexOf('private drawMarkers('));
    expect(drawMarkersBody.length).toBeGreaterThan(0);
    expect(drawMarkersBody).not.toContain('resolveColors');
  });

  it('defines every minimap color token it reads in the design-token sheet', () => {
    for (const tok of MINIMAP_COLOR_TOKENS) {
      expect(code, `painter never reads ${tok}`).toContain(tok);
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });
});

describe('minimap_painter: cached background + ~10Hz cadence preserved', () => {
  it('blits the Hud-owned cached terrain background rather than rebuilding it', () => {
    // The painter receives the cached bg and only drawImages it (no terrain build).
    expect(code).toContain('ctx.drawImage(');
    expect(code).not.toContain('renderTerrainCanvas');
    // Hud passes the cached canvas + the current zoom in each redraw.
    expect(hud).toContain('this.minimapPainter.paintOverworld(');
    expect(hud).toContain('this.minimapBg');
  });

  it("still redraws updateMinimap from hud.update()'s fastHud (~10Hz) band", () => {
    // The minimap stays gated on the fast band, NOT every frame (graphics tiering may later throttle it).
    expect(hud).toContain('const fastHud = now - this.lastHudFastAt >= 100;');
    expect(hud).toContain('this.updateMinimap();');
  });

  it("routes the '#zone-label' text through the elided setText (the one DOM write)", () => {
    expect(code).toContain('this.writers.setText(zoneLabelEl');
  });
});
