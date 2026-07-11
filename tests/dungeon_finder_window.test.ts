// Source-scan guard for src/ui/dungeon_finder_window.ts (the arena_window.test.ts
// shape): the painter must stay a thin, accessible, token-driven consumer of the
// pure core, with the perf contract (signature skip + in-place clock slots)
// visible in source. Node-only: reads the file as text, no DOM.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(process.cwd(), 'src/ui/dungeon_finder_window.ts'), 'utf8');

describe('dungeon finder window painter (source contract)', () => {
  it('renders from the pure core, never from raw world state', () => {
    expect(src).toContain('buildDungeonFinderView(');
  });

  it('skips the DOM rebuild on an unchanged signature and refreshes clocks in place', () => {
    expect(src).toContain('if (sig === this.lastSig) {');
    expect(src).toContain('this.updateClocks(view.clocks);');
    expect(src).toContain('data-df-clock');
  });

  it('owns WCAG focus: dialog root marked once on open, focus captured and restored', () => {
    expect(src).toContain("markDialogRoot(root, { labelledBy: 'dfinder-title' })");
    expect(src).toContain('this.openerFocus = this.deps.captureFocus();');
    expect(src).toContain('this.deps.restoreFocus(this.openerFocus);');
    // Keyboard focus moves into the freshly opened window.
    expect(src).toContain("querySelector('[data-close]') as HTMLElement | null)?.focus()");
  });

  it('closes through close() with a real labelled close button', () => {
    expect(src).toMatch(/data-close aria-label="\$\{esc\(t\('hudChrome\.finder\.close'\)\)\}"/);
  });

  it('escapes every interpolated name and uses t() for every label', () => {
    // Player/leader names and localized entity names always pass through esc().
    expect(src).toContain('esc(a.name)');
    expect(src).toContain("t('hudChrome.finder.leader', { name: l.leaderName })");
    // No raw innerHTML of unescaped world text: interpolations inside template
    // literals must call esc(, tEntity via esc(, or a builder.
    expect(src).not.toMatch(/\$\{a\.name\}/);
    expect(src).not.toMatch(/\$\{l\.leaderName\}/);
  });

  it('keeps tab and role toggles stateful with aria-pressed / role=checkbox semantics', () => {
    expect(src).toMatch(/data-tab="\$\{tab\}" aria-pressed=/);
    expect(src).toMatch(/data-role="\$\{r\.role\}" aria-pressed=/);
    expect(src).toMatch(/role="checkbox" aria-checked=/);
  });

  it('ships prerendered portraits with fixed dimensions and lazy decode (no live 3D)', () => {
    expect(src).toContain('width="64" height="64" loading="lazy" decoding="async"');
    // No renderer import: the header may SAY "no Three.js", the code must not use it.
    expect(src).not.toMatch(/from 'three'|from "three"|\.\.\/render\//);
  });

  it('carries no literal hex/rgb colors in TS beyond the shared quality map', () => {
    // Colors live in the stylesheet; the one sanctioned inline color is the
    // shared QUALITY_COLOR lookup every item window uses.
    expect(src).toContain('QUALITY_COLOR[i.quality]');
    expect(src).not.toMatch(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
    expect(src).not.toMatch(/rgb\(/);
  });

  it('names its cadence constants instead of inlining thresholds', () => {
    expect(src).toContain("const FINDER_LOADING_SIG = 'dfinder-loading'");
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });

  it('routes the map action through the injected non-teleporting hook', () => {
    expect(src).toContain('this.deps.showOnMap(detail.entrance.x, detail.entrance.z)');
    expect(src).not.toMatch(/enterDungeon|leaveDungeon|setDungeonDifficulty/);
  });
});
