import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Load-bearing CSS pins for the character-sheet / inspect showcase. CSS is pinned
// against a WHITESPACE-NORMALIZED view so that biome re-wrapping a long value
// across lines (the known trap) never breaks a pin: only a real VALUE change does.
// Run AFTER formatting (format-then-pin), never before.
const norm = (css: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '') // drop comments so an inline comment cannot split a pin
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

const read = (rel: string) =>
  norm(readFileSync(new URL(`../src/styles/${rel}`, import.meta.url), 'utf8'));
const components = read('components.css');
const shell = read('shell.css');
const mobile = read('hud.mobile.css');

describe('character sheet showcase CSS', () => {
  it('the window is 740px wide', () => {
    expect(components).toContain('#char-window { width: 740px; }');
  });

  it('the model stage is FIXED width (310px) with the 330px min-height (columns flex around it)', () => {
    // The centering contract hinges on a non-greedy stage: fixed width, so the two
    // columns own all leftover width. flex:1 here would regress the band centering.
    expect(components).toContain(
      '.char-model-panel { flex: 0 0 310px; min-width: 0; min-height: 330px;',
    );
  });

  it('sockets are 44px with a 2px border and radius 7', () => {
    expect(components).toContain(
      '.equip-slot .item-icon { width: 44px; height: 44px; flex: 0 0 44px; border-width: 2px; border-radius: 7px;',
    );
  });

  it('the text box is a fixed 100px (so every icon lands at the identical x per column)', () => {
    expect(components).toContain('.equip-slot > div { flex: 0 0 100px;');
  });

  it('item names wrap (never ellipsize)', () => {
    expect(components).toContain(
      '.equip-slot .slot-item { font-size: 11.5px; line-height: 1.3; white-space: normal;',
    );
  });

  it('the unequip control is an ABSOLUTE corner overlay (never a flex child that would shove the unit)', () => {
    expect(components).toContain('.equip-slot .equip-unequip-btn { position: absolute;');
    // Anchored per column so it cannot regress centering.
    expect(components).toContain(
      '.equip-col:not(.equip-col-right) .equip-slot .equip-unequip-btn { left: calc(50% - 88px); }',
    );
    expect(components).toContain(
      '.equip-col-right .equip-slot .equip-unequip-btn { right: calc(50% - 88px); }',
    );
  });

  it('stats render as tiles + panels, with a spanning attributes row', () => {
    expect(components).toContain('.stat-panels { display: grid; grid-template-columns: 1fr 1fr;');
    expect(components).toContain('.stat-panel.attrs-tiles { grid-column: 1 / -1;');
    expect(components).toContain(
      '.attrs-tiles .stat-cell b { color: #fff; font-weight: normal; font-size: 21px;',
    );
  });
});

describe('inspect showcase CSS', () => {
  it('the inspect window is 740px wide', () => {
    expect(shell).toContain('#inspect-window { width: 740px; }');
  });

  it('the model stage takes the inspected player class color via a CSS custom property', () => {
    expect(shell).toContain(
      '#inspect-window .inspect-model-panel { min-height: 400px; border: 1px solid var(--inspect-class-color',
    );
    expect(shell).toContain('var(--inspect-class-color, #5a4a20) 35%, transparent)');
  });

  it('the honor chip drops its gold override to the shared muted chip color', () => {
    expect(shell).toContain(
      '.panel-title.char-title-portrait .char-honor-balance { color: var(--color-text-muted); margin-top: 0; }',
    );
  });

  it('header meta renders as pill chips', () => {
    expect(shell).toContain('.char-title-text .panel-subtitle { display: inline-block;');
    expect(shell).toContain('border-radius: 999px;');
  });

  it('keeps the archetype crest and label aligned inside their pill', () => {
    expect(shell).toContain(
      '.char-title-text .panel-subtitle.char-archetype-title { display: inline-flex; align-items: center; gap: 4px; }',
    );
    expect(components).not.toContain('.char-archetype-title { display: inline-flex;');
  });
});

describe('mobile showcase CSS', () => {
  it('compacts sockets to 38px and the text box to 92px', () => {
    expect(mobile).toContain(
      'body.mobile-touch .equip-slot .item-icon { width: 38px; height: 38px; flex: 0 0 38px;',
    );
    expect(mobile).toContain('body.mobile-touch .equip-slot > div { flex: 0 0 92px; }');
  });

  it('compacts the model stage to 230px wide / 220px min-height for both windows', () => {
    expect(mobile).toContain('flex: 0 0 230px; width: 230px; min-height: 220px;');
    expect(mobile).toContain('body.mobile-touch #inspect-window .inspect-model-panel {');
  });

  it('lays stat panels in a 2-column grid with 16px tile numerals', () => {
    expect(mobile).toContain('body.mobile-touch .stat-panels { grid-template-columns: 1fr 1fr;');
    expect(mobile).toContain('body.mobile-touch .attrs-tiles .stat-cell b { font-size: 16px; }');
  });

  it('keeps the unequip control a ~22px corner chip on touch', () => {
    expect(mobile).toContain(
      'body.mobile-touch .equip-slot .equip-unequip-btn { top: -7px; width: 22px; height: 22px;',
    );
  });

  it('holds the >=40x40 tap-target floor for the small unequip chip via a hit-expander', () => {
    // The visible chip is 22px but the touch target must not drop below the 40x40
    // floor (src/ui/CLAUDE.md; WCAG 2.2 SC 2.5.8): an invisible centered pseudo
    // enlarges the tap area. Never weaken this back to a 22/24px hit target.
    expect(mobile).toContain(
      'body.mobile-touch .equip-slot .equip-unequip-btn::before { content: ""; position: absolute;',
    );
    expect(mobile).toContain('width: 40px; height: 40px; transform: translate(-50%, -50%); }');
  });

  it('keeps the interactive attribute tiles at the >=40px long-press floor', () => {
    // The tiles are focusable stat cells with a long-press tooltip, so they keep the
    // same 40px floor as their Offense/Defense siblings (not min-height: 0).
    expect(mobile).toContain(
      'body.mobile-touch .attrs-tiles .stat-cell { min-height: 40px; justify-content: center;',
    );
  });
});
