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
  document.body.innerHTML = '<div id="cross-hotbar"></div>';
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
