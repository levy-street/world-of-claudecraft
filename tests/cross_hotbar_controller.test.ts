// @vitest-environment jsdom
// Behavioral pins for the cross-hotbar overlay's DOM adapter (round 8/11/12 review
// findings). Three properties, none of which the pure view can hold: the cells are
// real buttons (so the shared action-bar painter's aria-label and aria-disabled land
// on a role ARIA allows them on), they join the focus order only while the bar is
// being arranged (a resting cell is cast by its hardware chord, and a reachable one
// swallowed the confirm press), and every text write routes through the injected
// PainterHost writers instead of a second read-back cache.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FOCUSABLE_SELECTOR } from '../src/ui/focus_manager';
import {
  CrossHotbarController,
  type CrossHotbarResolvers,
} from '../src/ui/hud/cross_hotbar/cross_hotbar_controller';
import type { CrossHotbarHold } from '../src/ui/hud/cross_hotbar/cross_hotbar_view';
import { makeWriterFacet } from '../src/ui/painter_host';

const CELL_COUNT = 16;

const resolvers: CrossHotbarResolvers = {
  abilityById: () => null,
  itemById: () => null,
  activeAimAbilityId: () => null,
  abilityName: (def) => def.id,
  itemName: (item) => item.id,
};

let writes = 0;
let skips = 0;

function build(): CrossHotbarController {
  document.body.innerHTML = '<div id="cross-hotbar" class="xhb"></div>';
  writes = 0;
  skips = 0;
  const writers = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {
      writes++;
    },
    () => {
      skips++;
    },
  );
  const controller = CrossHotbarController.create(writers, () => '', resolvers);
  expect(controller).toBeDefined();
  return controller as CrossHotbarController;
}

function cells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.xhb-slot')];
}

function hold(expanded: boolean): CrossHotbarHold {
  return {
    layer: expanded ? 'right' : null,
    slots: Array.from({ length: CELL_COUNT }, () => null),
    expanded,
    buttons: Array.from({ length: CELL_COUNT }, (_, i) => `B${i}`),
    triggers: { left: 'LT', right: 'RT' },
    arrange: { bumper: 'LB', button: 'Y' },
    swap: 'RB',
  };
}

describe('the cells', () => {
  beforeEach(() => {
    build();
  });

  it('are real buttons, so the painter may write aria-label and aria-disabled on them', () => {
    const all = cells();
    expect(all).toHaveLength(CELL_COUNT);
    for (const cell of all) {
      expect(cell.tagName).toBe('BUTTON');
      expect((cell as HTMLButtonElement).type).toBe('button');
    }
  });

  it('stay out of the focus order at rest', () => {
    // A resting cell is fired by its trigger chord, never by walking focus onto it,
    // and a reachable one made the pad's confirm press land on a dead control.
    expect(document.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0);
    for (const cell of cells()) expect(cell.getAttribute('tabindex')).toBe('-1');
  });

  it('composes every action cell from the shared socket primitive', () => {
    for (const cell of cells()) {
      expect(cell.classList.contains('ui-socket')).toBe(true);
      expect(cell.querySelector('.icon-label')?.classList.contains('ui-socket-art')).toBe(true);
      expect(cell.querySelector('.item-count')?.classList.contains('ui-socket-count')).toBe(true);
      expect(cell.querySelector('.keybind')?.classList.contains('ui-socket-key')).toBe(true);
      expect(cell.querySelector('.cd-overlay')?.classList.contains('ui-socket-cd')).toBe(true);
      expect(cell.querySelector('.cdtext')?.classList.contains('ui-socket-cd-text')).toBe(true);
    }
  });

  it('builds four crosses with a shared medal stud at each center', () => {
    const crosses = [...document.querySelectorAll<HTMLElement>('.xhb-diamond')];
    expect(crosses).toHaveLength(4);
    for (const cross of crosses) {
      const stud = cross.querySelector<HTMLElement>(':scope > .xhb-stud');
      expect(stud?.classList.contains('ui-medal')).toBe(true);
      expect(stud?.classList.contains('ui-medal--stud')).toBe(true);
      expect(stud?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps the two halves around the two-pip set rail', () => {
    const root = document.getElementById('cross-hotbar');
    if (!root) throw new Error('cross hotbar root was not built');
    expect([...root.children].map((el) => el.className)).toEqual([
      'xhb-half xhb-half-left',
      'xhb-set-rail',
      'xhb-half xhb-half-right',
      'xhb-hint',
    ]);
    expect(
      [...root.querySelectorAll<HTMLElement>('.xhb-pip')].map((pip) => [
        pip.getAttribute('data-xhb-set'),
        pip.classList.contains('ui-medal'),
        pip.classList.contains('ui-medal--stud'),
      ]),
    ).toEqual([
      ['0', true, true],
      ['1', true, true],
    ]);
  });

  it('composes both trigger tabs from the shared keycap primitive', () => {
    const tabs = [...document.querySelectorAll<HTMLElement>('.xhb-trigger')];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) expect(tab.classList.contains('ui-keycap')).toBe(true);
  });

  it('distinguishes d-pad discs from the four physical face-button colors', () => {
    expect(document.querySelectorAll('.xhb-glyph-dpad')).toHaveLength(8);
    expect(document.querySelectorAll('.xhb-glyph-face')).toHaveLength(8);
    for (const button of ['a', 'b', 'x', 'y']) {
      expect(document.querySelectorAll(`.xhb-glyph-face-${button}`)).toHaveLength(2);
    }
  });
});

describe('arrange mode', () => {
  it('opens the cells to focus and closes them again on the way out', () => {
    const controller = build();
    controller.setEditing(true, null, null);
    expect(document.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(CELL_COUNT);
    expect(cells().every((c) => c.getAttribute('tabindex') === '0')).toBe(true);

    controller.setEditing(false, null, null);
    expect(document.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0);
  });

  it('reports the focused cell by its own index attribute', () => {
    const controller = build();
    controller.setEditing(true, null, null);
    cells()[5].focus();
    expect(controller.focusedCell()).toBe(5);
  });
});

describe('the writers', () => {
  it('writes once and elides a repeat of the same hold', () => {
    const controller = build();
    controller.setHold(hold(true));
    const first = writes;
    expect(first).toBeGreaterThan(0);
    const skipsAfterFirst = skips;

    controller.setHold(hold(true));
    // Every glyph, trigger and hint write is the same value again: a second write
    // cache would show the same zero here, so the establishing write above is what
    // proves the text goes through the facet at all.
    expect(writes).toBe(first);
    expect(skips).toBeGreaterThan(skipsAfterFirst);
  });

  it('routes the arrange hint and the cell focus state through the facet too', () => {
    const controller = build();
    controller.setHold(hold(false));
    const before = writes;
    controller.setEditing(true, 3, null);
    expect(writes).toBeGreaterThan(before);
    const afterEditing = writes;
    controller.setEditing(true, 3, null);
    expect(writes).toBe(afterEditing);
  });
});

describe('the trigger pair', () => {
  it('renders the expanded half from the position template', () => {
    const controller = build();
    controller.setHold(hold(true));
    const right = document.querySelector<HTMLElement>('.xhb-trigger-right');
    expect(right?.textContent).toBe('LT + RT');
  });

  it('builds that pair from the i18n template rather than by concatenation', () => {
    // Player-visible text is never concatenated: the separator belongs to the
    // locale, so a pin on the rendered English alone would pass for a hand-built
    // string.
    const src = readFileSync(
      join(__dirname, '../src/ui/hud/cross_hotbar/cross_hotbar_controller.ts'),
      'utf8',
    );
    expect(src).toContain("t('hudChrome.controller.crossHotbarPosition'");
  });
});

describe('the set rail', () => {
  it('names the set-swap button under the two pips, on the shared keycap', () => {
    const controller = build();
    controller.setHold(hold(false));
    const rail = document.querySelector<HTMLElement>('.xhb-set-rail') as HTMLElement;
    const children = [...rail.children];
    // Two pips first, then the chip: the rail reads "which set" then "how to
    // change it", which is the order the board draws it in.
    expect(children.map((el) => el.className.split(' ')[0])).toEqual([
      'xhb-pip',
      'xhb-pip',
      'xhb-set-swap',
    ]);
    const chip = children[2] as HTMLElement;
    expect(chip.classList.contains('ui-keycap')).toBe(true);
    expect(chip.textContent).toBe('RB');
    expect(chip.style.display).toBe('inline-flex');
  });

  it('stands the chip down when the player has cleared that bind', () => {
    // An empty keycap is a plate around nothing, so the chip goes rather than
    // sitting under the pips saying no button at all.
    const controller = build();
    controller.setHold({ ...hold(false), swap: '' });
    const chip = document.querySelector<HTMLElement>('.xhb-set-swap') as HTMLElement;
    expect(chip.style.display).toBe('none');
    expect(chip.textContent).toBe('');
  });
});

// The bar's look is CSS, so these pin the rules the redesign is FOR alongside the
// shipped states it must not quietly drop. Text pins on the sheet, because jsdom
// resolves neither @layer nor a cascade this deep.
describe('the cross hotbar stylesheet', () => {
  const hudCss = readFileSync(join(__dirname, '../src/styles/hud.css'), 'utf8');
  const section = hudCss.slice(hudCss.indexOf('---------- controller cross hotbar ----------'));

  it('sizes and rounds the cells off the shared socket tokens', () => {
    // The paladin variant (#ui.devotion-live) overrides the cell through --xhb-cell-live.
    expect(section).toMatch(
      /--xhb-cell: var\(\s*--xhb-cell-live,\s*min\(var\(--socket-size\), calc\(\(var\(--action-rail-w\) - 99px\) \/ 12\)\)\s*\);/,
    );
    expect(section).toContain('border-radius: var(--radius-cell);');
    // The art inset follows the cell's own radius rather than a second literal.
    expect(section).toContain('border-radius: calc(var(--radius-cell) - 2px);');
  });

  it('sizes the set-swap chip to the pip rail', () => {
    expect(section).toContain('.xhb-set-swap {\n    min-width: 0;\n    height: 14px;');
  });

  it('rides the armed halo on the decorative-glow scale', () => {
    expect(section).toContain(
      '.xhb-half.xhb-armed::before {\n    opacity: 1;\n    box-shadow: 0 0 calc(24px * var(--fx-shadow, 1))',
    );
  });

  it('still drops the unreachable half in the expanded bank', () => {
    // The pips say WHICH set; this says which half a press can reach, and a bank
    // drawn with both halves reads as an ordinary trigger page.
    expect(section).toContain('.xhb.xhb-expanded .xhb-half:not(.xhb-armed) {\n    display: none;');
  });

  it('keeps the compact preset label standdown as well as the new cell fade', () => {
    expect(section).toContain('body.xhb-compact .xhb-half:not(.xhb-armed) .xhb-trigger {');
    expect(section).toContain(
      'body.xhb-compact .xhb-half:not(.xhb-armed) .xhb-slot {\n    opacity: 0.45;',
    );
  });

  it('colors each face glyph with its own hardware token', () => {
    for (const button of ['a', 'b', 'x', 'y']) {
      expect(section).toContain(
        `.xhb-glyph-face-${button} {\n    color: var(--color-pad-${button});`,
      );
    }
  });

  it('stands the launcher keycaps down while the pad is live', () => {
    // The keycaps come back the moment the player touches the keyboard, so the
    // standdown reads pad-active rather than the mode class.
    expect(section).toContain(
      'body.xhb-mode.pad-active:not(.mobile-touch) #side-buttons .keybind {',
    );
  });

  it('draws the pad focus ring as an outline, never a shadow', () => {
    const rule = section.slice(section.indexOf('.pad-focus {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('outline: 2px solid var(--color-border-focus);');
    expect(body).toContain('outline-offset: 2px;');
    expect(body).not.toContain('box-shadow');
  });
});
