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

  it('never half-applies a tablist / listbox contract over plain toggle buttons', () => {
    // aria-pressed buttons with no role=tab / role=option children read WORSE to a
    // screen reader under role=tablist / role=listbox than under a labelled group.
    expect(src).not.toContain('role="tablist"');
    expect(src).not.toContain('role="listbox"');
    expect(src).toContain('class="df-tabs" role="group"');
    expect(src).toContain('class="df-rail" role="group"');
  });

  it('composes every localizable sentence from tokens, never from a concat', () => {
    // Count-plus-role, the needs line, the mm:ss clock and the slot fraction are all
    // token templates, so a locale owns the ORDER (and the clock separator).
    expect(src).toContain(
      "t('hudChrome.finder.roleCount', { count: num(n), role: this.roleLabel(role) })",
    );
    expect(src).toContain("htmlTemplate('hudChrome.finder.needs', { roles: neededRoles })");
    expect(src).toContain("t('hudChrome.finder.clock', {");
    expect(src).toContain("tPlural('hudChrome.plurals.finderPartySize'");
    // No hand-rolled ':' clock and no `${count} ${label}` role concat.
    expect(src).not.toMatch(/seconds < 10 \? '0' : ''/);
    expect(src).not.toMatch(/\$\{num\(n\)\} \$\{esc\(this\.roleLabel/);
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

  // The window's own components rule sits in @layer components, which OUTRANKS the
  // shared `.window { display: none }` in @layer layout: a `display: flex` there would
  // leave the closed window on screen from HUD boot (issue found in review of #1789).
  // The house pattern (#market-window) is: closed state in the components rule, painter
  // opens with inline flex. These three assertions pin all three halves of it.
  it('opens and closes with inline flex, matching its flex-column components rule', () => {
    expect(src).toContain("root.style.display = 'flex';");
    expect(src).toContain("el.style.display = 'none';");
    expect(src).toContain("return this.deps.root().style.display === 'flex';");
    expect(src).not.toContain("style.display = 'block'");
  });
});

describe('dungeon finder group-found popup (source contract)', () => {
  const popup = readFileSync(
    resolve(process.cwd(), 'src/ui/dungeon_finder_proposal_popup.ts'),
    'utf8',
  );

  it('announces itself to a screen reader without stealing focus', () => {
    // The popup deliberately never moves focus (the player may be fighting), so with no
    // live region an SR user misses the whole 30-second answer window.
    expect(popup).toContain("setAttribute('role', 'alert')");
    expect(popup).toContain("setAttribute('aria-live', 'assertive')");
    expect(popup).not.toContain('.focus()');
  });

  it('builds the accepted/total meter from the shared slots template', () => {
    expect(popup).toContain(
      "t('hudChrome.finder.slots', { size: num(s.accepted), capacity: num(s.total) })",
    );
    expect(popup).not.toMatch(/\$\{num\(s\.accepted\)\}\/\$\{num\(s\.total\)\}/);
  });
});

describe('dungeon finder window stylesheet contract', () => {
  const components = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
  const mobile = readFileSync(resolve(process.cwd(), 'src/styles/hud.mobile.css'), 'utf8');

  it('defaults the window to display: none in its own components rule', () => {
    const rule = /#dungeon-finder-window \{([^}]*)\}/.exec(components);
    expect(rule, 'the #dungeon-finder-window base rule').toBeTruthy();
    expect(rule?.[1]).toContain('display: none;');
    expect(rule?.[1]).not.toContain('display: flex;');
  });

  it('keeps every mobile finder rule inside @layer hud-mobile and sets no root display', () => {
    // Unlayered rules outrank every layer: a block appended after the wrapper closes
    // would beat both the closed-state default and the painter's own cascade.
    const afterLayer = mobile.slice(mobile.lastIndexOf('\n}\n') + 3).trim();
    expect(afterLayer, 'no CSS may sit after the @layer hud-mobile wrapper closes').toBe('');
    expect(mobile).toContain('body.mobile-touch #dungeon-finder-window {');
    const rule = /body\.mobile-touch #dungeon-finder-window \{([^}]*)\}/.exec(mobile);
    expect(rule?.[1]).not.toContain('display:');
  });

  it('gives the HUD render gate the same flex open-state check the painter writes', () => {
    const hud = readFileSync(resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain("$('#dungeon-finder-window').style.display === 'flex'");
  });
});
