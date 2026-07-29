// @vitest-environment happy-dom
//
// Behavioral pin for the per-corpse harvest picker painter (the pure row/button
// decisions are unit-tested in corpse_harvest_view via the sim suite). Unlike the
// other batch-5 windows, this is NOT a standalone framed window: the loot window
// controller composes renderCorpseHarvestPicker into its cursor-anchored popup,
// which is neither draggable nor resizable, so it
// stays a picker section rather than adopting the .window-frame chrome. This test
// locks the load-bearing contract the AAA pass must NOT disturb: the checkbox
// selection maps straight through to onHarvest (the tags drive the concentrated
// timed harvest in professions/gathering, so the mapping is the "timing" the brief
// requires stay untouched), the harvest-disabled state, and the empty short-circuit.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type CorpseHarvestViewModel,
  corpseHarvestView,
} from '../src/ui/hud/loot/corpse_harvest_view';
import { renderCorpseHarvestPicker } from '../src/ui/hud/loot/corpse_harvest_window';
import { expectDefined } from './helpers/defined';

function view(overrides: Partial<CorpseHarvestViewModel> = {}): CorpseHarvestViewModel {
  return {
    rows: [
      { tag: 'hide', checked: true, yieldsItem: true },
      { tag: 'fang', checked: false, yieldsItem: true },
    ],
    harvestDisabled: false,
    concentrated: true,
    forfeitsEveryYield: false,
    corpseHarvestable: true,
    ...overrides,
  };
}

describe('renderCorpseHarvestPicker: picker section', () => {
  it('appends one row per tagged component with the checkbox state from the view', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view(), { onHarvest: () => {}, attachTooltip: () => {} });
    expect(container.querySelector('.corpse-harvest')).not.toBeNull();
    const rows = container.querySelectorAll<HTMLElement>('.corpse-harvest-row');
    expect(rows.length).toBe(2);
    const boxes = container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it('renders nothing when the corpse has no harvestable components', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view({ rows: [] }), {
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector('.corpse-harvest')).toBeNull();
  });

  it('disables the harvest button when the view says so', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view({ harvestDisabled: true }), {
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.disabled).toBe(true);
    // The ONE fixture where the two model fields disagree, so it is the only
    // place that can tell which field each write reads. `harvestDisabled` is
    // true here and `forfeitsEveryYield` is false, so the reason line must
    // stay hidden: a painter that keyed the line off `harvestDisabled` would
    // be invisible to every other case, where the two always coincide.
    expect(container.querySelector<HTMLElement>('.corpse-harvest-warning')?.hidden).toBe(true);
  });

  it('exposes what Harvest does via the shared tooltip idiom, distinct from Take Loot', () => {
    const container = document.createElement('div');
    const attachTooltip = vi.fn();
    renderCorpseHarvestPicker(container, view(), { onHarvest: () => {}, attachTooltip });
    const btn = container.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
    // No native title: the shared idiom covers hover, mobile long-press, and
    // keyboard focus, where a bare title attribute is hover-only.
    expect(btn?.title).toBe('');
    const call = attachTooltip.mock.calls.find(([target]) => target === btn);
    expect(call?.[1]()).toBe(
      'Gathers the checked components. Each corpse can be harvested once, first come. Does not take the loot.',
    );
  });

  it('reports exactly the currently-checked tags to onHarvest (the concentration/timing contract)', () => {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(container, view(), { onHarvest, attachTooltip: () => {} });
    // As rendered: only "hide" is checked.
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith(['hide']);
    // Check "fang" too, then harvest again: both tags now flow through.
    const boxes = container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    boxes[1].checked = true;
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith(['hide', 'fang']);
  });

  it('allows an empty selection (spread across all), which the harvest still accepts', () => {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(
      container,
      view({ rows: [{ tag: 'hide', checked: false, yieldsItem: true }], concentrated: false }),
      { onHarvest, attachTooltip: () => {} },
    );
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith([]);
  });
});

// #2509: the picker's mirror of the command-boundary refusal. Checking only
// families with no harvest item behind them (gills, horn) is a command the
// sim refuses pre-claim, so the button goes dead and the section says why IN
// PLACE: a `disabled` button takes no pointer events and leaves the tab order
// (src/ui/focus_manager.ts), so a tooltip on it is unreachable.
describe('renderCorpseHarvestPicker: a selection that forfeits every yield (#2509)', () => {
  // sethrael_palecoil's real tags. Only horn is unmapped (claw is mapped now).
  const PALECOIL = ['hide', 'claw', 'horn'];

  function render(tags: string[], checked: string[] = []) {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    const attachTooltip = vi.fn();
    // The REAL view core for the initial model, not a hand-rolled guess at it.
    // The painter re-derives through corpseHarvestView on every `change` event
    // anyway (corpse_harvest_window.ts), so a second, approximate copy of the
    // rule here only created a first render that could disagree with every
    // render after it: the old inline `checked.every(t => t === 'horn' ...)`
    // answered TRUE for an all-unmapped corpse where the core answers false
    // (nothing is forfeited there; #2513's separate term is what disables it).
    renderCorpseHarvestPicker(container, corpseHarvestView(tags, new Set(checked)), {
      onHarvest,
      attachTooltip,
    });
    const boxes = [...container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
    return {
      container,
      onHarvest,
      attachTooltip,
      boxes,
      btn: expectDefined(container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')),
      warning: expectDefined(container.querySelector<HTMLElement>('.corpse-harvest-warning')),
      // The real user gesture. Setting `.checked` fires no `change`, so a test
      // that mutated the property directly would assert a stale button and
      // pass whatever the handler did.
      toggle(tag: string) {
        const box = expectDefined(boxes.find((b) => b.value === tag));
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }

  it('hides the reason line while the selection can still yield something', () => {
    const t = render(PALECOIL, ['hide']);
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
  });

  it('kills the button and states why when the last mapped box is unchecked', () => {
    const t = render(PALECOIL, ['hide', 'horn']);
    expect(t.btn.disabled).toBe(false);
    t.toggle('hide');
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
    expect(t.warning.textContent).toBe('Nothing you selected can be harvested from this corpse.');
    // The dead button really is dead: a click submits nothing.
    t.btn.click();
    expect(t.onHarvest).not.toHaveBeenCalled();
  });

  it('announces the reason, since the button silently leaves the tab order', () => {
    // A `disabled` button takes no pointer events and is not focusable, so
    // neither the shared tooltip nor an aria-label on it is reachable at the
    // moment the action dies. The live region is what carries the why.
    const t = render(PALECOIL, ['hide']);
    expect(t.warning.getAttribute('role')).toBe('status');
    expect(t.warning.getAttribute('aria-live')).toBe('polite');
    // Said once, not twice: the sentence lives on the line alone, never also
    // on the button, so browse mode does not read it back to back.
    t.toggle('hide');
    t.toggle('horn');
    expect(t.warning.hidden).toBe(false);
    expect(t.btn.getAttribute('aria-label')).toBeNull();
  });

  it('keeps the reason line BELOW the button, so showing it never moves the control', () => {
    // The line appears and disappears on a checkbox toggle. Above the button
    // it would shove Harvest down at the exact moment the player is reaching
    // for it; below, only the popup's bottom edge moves. Pinned because the
    // whole layout-stability argument is invisible to every other assertion.
    const t = render(PALECOIL, ['horn']);
    expect(t.btn.nextElementSibling).toBe(t.warning);
  });

  it('styles the reason line as an error, from the shared token', () => {
    // The class is otherwise pinned only by this file's own querySelector, so
    // renaming it on one side would leave the line rendering as ordinary body
    // text with every test still green.
    const css = readFileSync(
      path.resolve(process.cwd(), 'src/styles/components.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\.corpse-harvest-warning\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.corpse-harvest-warning has no rule in components.css').not.toBeNull();
    expect(rule?.[1]).toContain('var(--color-text-error)');
  });

  it('comes back to life the moment a mapped family is checked again', () => {
    const t = render(PALECOIL, ['horn']);
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
    t.toggle('claw');
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith(['claw', 'horn']);
  });

  it('never disables on the way back to an empty selection, which spreads', () => {
    const t = render(PALECOIL, ['horn']);
    expect(t.btn.disabled).toBe(true);
    t.toggle('horn');
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith([]);
  });

  it('draws NO section at all for an all-unmapped corpse (#2513)', () => {
    // warlock_imp retagged (gills, horn), the shared UNMAPPED fixture used
    // across the sim suites now that claw and tusk are mapped (this branch's
    // own fix retired fen_troll, the old fixture here, since claw and tusk
    // were its tags). The sim refuses the command at its corpse-level gate,
    // so there is nothing for the picker to submit. Drawing the section with
    // a dead button would be a NEW state and a bad one: the reason line
    // reports a FORFEIT, which is a statement about the selection, and nothing
    // is being forfeited here, so it stays hidden and the player would get a
    // disabled control with no explanation and two checkboxes that do nothing.
    // An untagged corpse already shows no section; this matches it.
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(container, corpseHarvestView(['gills', 'horn'], new Set()), {
      onHarvest,
      attachTooltip: () => {},
    });
    expect(container.querySelector('.corpse-harvest')).toBeNull();
    expect(container.querySelector('.corpse-harvest-btn')).toBeNull();
    expect(container.querySelector('.corpse-harvest-check')).toBeNull();
    expect(container.children).toHaveLength(0);
    // The discriminator on the identical call: a MIXED corpse carrying the same
    // unmapped families still draws its section, so this is the predicate and
    // not the painter refusing everything.
    const mixed = document.createElement('div');
    renderCorpseHarvestPicker(mixed, corpseHarvestView(['hide', 'horn', 'meat'], new Set()), {
      onHarvest,
      attachTooltip: () => {},
    });
    expect(mixed.querySelector('.corpse-harvest')).not.toBeNull();
    expect(mixed.querySelectorAll('.corpse-harvest-check')).toHaveLength(3);
  });

  it('refuses the section on the view model FIELD, not on the tag list it came from', () => {
    // The painter reads `corpseHarvestable`, so a caller that hands it a model
    // built some other way still gets the refusal. Rows are non-empty here, so
    // the pre-existing `rows.length === 0` early return cannot be what fires:
    // the two arms are pinned apart.
    const container = document.createElement('div');
    renderCorpseHarvestPicker(
      container,
      view({ rows: [{ tag: 'hide', checked: false, yieldsItem: true }], corpseHarvestable: false }),
      { onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(container.querySelector('.corpse-harvest')).toBeNull();
    // Same rows, field flipped: the section appears. Without this the assertion
    // above would pass against a painter that never drew anything.
    const on = document.createElement('div');
    renderCorpseHarvestPicker(
      on,
      view({ rows: [{ tag: 'hide', checked: false, yieldsItem: true }], corpseHarvestable: true }),
      { onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(on.querySelector('.corpse-harvest')).not.toBeNull();
  });

  it('still submits on a MIXED corpse carrying the same unmapped families', () => {
    // The discriminator for the case above: a template carrying horn beside
    // hide and meat (e.g. the Temple's gills/horn-tagged fixtures use the same
    // shape), so the button lives and the pick goes through.
    const t = render(['hide', 'horn', 'meat'], []);
    expect(t.btn.disabled).toBe(false);
    t.toggle('horn');
    // horn alone forfeits every yield: that is the #2509 arm, with its line.
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
    t.toggle('hide');
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith(['hide', 'horn']);
  });

  it('registers the tooltip exactly once, however many times the selection changes', () => {
    // Hud.attachTooltip binds a fresh listener set per call, so re-attaching
    // per toggle would stack them silently.
    const t = render(PALECOIL, ['hide']);
    t.toggle('hide');
    t.toggle('horn');
    t.toggle('horn');
    expect(t.attachTooltip.mock.calls.filter(([target]) => target === t.btn)).toHaveLength(1);
  });

  // #2514: after the sim stopped charging for an unmapped box, the box became a
  // control with no effect at all. That is better than a tax, but it must not
  // be silent: a checked box that changes nothing reads as a bug. The row is
  // marked instead of hidden or disabled, so the corpse still says what it
  // carries and the #2509 refusal above stays reachable from the shipped
  // picker.
  it('marks the rows with no item behind them, and leaves them checkable', () => {
    const t = render(PALECOIL, []);
    const rows = [...t.container.querySelectorAll<HTMLElement>('.corpse-harvest-row')];
    expect(rows).toHaveLength(3);
    // Only horn is marked, and it is marked in TEXT, not colour alone.
    expect(rows.map((r) => r.classList.contains('corpse-harvest-row-no-yield'))).toEqual([
      false,
      false,
      true,
    ]);
    const notes = [...t.container.querySelectorAll<HTMLElement>('.corpse-harvest-note')];
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe('nothing yet');
    expect(rows[2].contains(notes[0])).toBe(true);
    // Still a live control: the sim ignores it either way, so the picker must
    // not pretend it cannot be pressed, and the pick still goes over the wire
    // verbatim (the sim boundary is what interprets it, never the client).
    const horn = expectDefined(t.boxes.find((b) => b.value === 'horn'));
    expect(horn.disabled).toBe(false);
    t.toggle('hide');
    t.toggle('horn');
    expect(t.btn.disabled).toBe(false);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith(['hide', 'horn']);
    // ...and checking it ALONE is still the #2509 refusal, which is the state a
    // filtered row list would have made unreachable from this picker.
    t.toggle('hide');
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
  });

  it('folds the mark into the checkbox label rather than announcing it twice', () => {
    // A screen reader would otherwise read the component name, then the note,
    // as two separate labelled nodes. The visible note is aria-hidden and the
    // whole sentence lives in the checkbox's own label, which is also why it is
    // a separate key and not the base label with a clause appended.
    const t = render(PALECOIL, []);
    const label = (tag: string) => t.boxes.find((b) => b.value === tag)?.getAttribute('aria-label');
    expect(label('hide')).toBe('Harvest Hide');
    expect(label('horn')).toBe('Harvest Horn: nothing yet');
    const note = expectDefined(t.container.querySelector<HTMLElement>('.corpse-harvest-note'));
    expect(note.getAttribute('aria-hidden')).toBe('true');
    // WCAG 2.2 SC 2.5.3, Label in Name: the accessible name must CONTAIN the
    // text the row presents visually, or a speech-input user reading the row
    // aloud misses. Asserted as containment of the visible node's own text, not
    // as a second literal, so it holds in every locale: the aria key takes the
    // mark as a {note} placeholder rather than restating it, which is what
    // makes that structural instead of a translator convention.
    expect(label('horn')).toContain(note.textContent);
    // ...and the row's visible name is still in there too, so the containment
    // above cannot be satisfied by a label that dropped the component.
    expect(label('horn')).toContain('Horn');
  });

  it('marks nothing on an all-mapped corpse', () => {
    // The negative arm, so the case above is not passing against a painter that
    // marks every row.
    const t = render(['hide', 'fang'], []);
    expect(t.container.querySelectorAll('.corpse-harvest-note')).toHaveLength(0);
    expect(t.container.querySelectorAll('.corpse-harvest-row-no-yield')).toHaveLength(0);
  });

  it('states the tier rule in terms of what a harvest TAKES (#2514)', () => {
    // The retired concentrateHint said "fewer CHOSEN components", which the new
    // rule makes false in both directions on a mixed corpse: checking one more
    // unmapped row lowers nothing and unchecking one raises nothing.
    const t = render(PALECOIL, []);
    expect(t.container.querySelector('.corpse-harvest-hint')?.textContent).toBe(
      'The fewer components a harvest takes, the higher the tier of each.',
    );
  });

  it('emphasizes that hint exactly while the pick concentrates (#2514)', () => {
    // The render sink for the view model's `concentrated`, which the picker
    // computed and no painter read before this. It must follow the SIM's bonus,
    // not a box count: on this corpse the widest pick already carries a bonus,
    // so naming both mapped families is not a concentrate and naming one is.
    const t = render(PALECOIL, []);
    const section = expectDefined(t.container.querySelector<HTMLElement>('.corpse-harvest'));
    expect(section.classList.contains('is-concentrated')).toBe(false);
    t.toggle('hide');
    expect(section.classList.contains('is-concentrated')).toBe(true);
    // Ticking the unmapped box changes nothing, which is the whole ruling seen
    // from the client: the sim scores this pick exactly as it scores ['hide'].
    t.toggle('horn');
    expect(section.classList.contains('is-concentrated')).toBe(true);
    // The discriminating state, and the reason this case exists: naming both
    // MAPPED families is the widest pick this corpse offers, so it is not a
    // concentrate even though only two of the three boxes are checked. The
    // retired box-count definition called exactly this a concentrate, so a
    // painter still keyed off a count reds right here.
    t.toggle('horn');
    t.toggle('claw');
    expect(t.boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(['hide', 'claw']);
    expect(section.classList.contains('is-concentrated')).toBe(false);
    // Checking every box is the same world again, by the same rule.
    t.toggle('horn');
    expect(section.classList.contains('is-concentrated')).toBe(false);
    // ...and a dead pick is never "concentrated", though its raw bonus is the
    // whole tag count.
    t.toggle('hide');
    t.toggle('claw');
    expect(t.btn.disabled).toBe(true);
    expect(section.classList.contains('is-concentrated')).toBe(false);
  });

  it('carries a stylesheet rule for every class the mark relies on', () => {
    // Same argument as the reason-line rule below: these classes are otherwise
    // pinned only by this file's own querySelector, so renaming one side would
    // leave the mark rendering as ordinary body text with every test green.
    // The muted TOKEN is asserted rather than an opacity: a stacked opacity
    // composited the note to 2.97:1 on the parchment preset, and
    // tests/theme.test.ts structurally cannot see a loss that happens in a
    // stylesheet rather than in a token. The token is not a 4.5:1 guarantee
    // either (theme.ts repairs it to the 3:1 tier); what it buys is a floor the
    // composite did not have, and the mark's meaning rides on the note TEXT.
    //
    // Read over the WHOLE styles directory, not one file: every negative below
    // is a statement about the shipped stylesheet, and a rule re-added in
    // hud.css, shell.css or hud.mobile.css would satisfy a single-file scan
    // while re-breaking exactly what these pins protect.
    const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
    const stylesDir = path.resolve(process.cwd(), 'src/styles');
    const allCss = readdirSync(stylesDir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => stripComments(readFileSync(path.join(stylesDir, f), 'utf8')))
      .join('\n');
    expect(allCss.length).toBeGreaterThan(10000);
    const css = stripComments(
      readFileSync(path.resolve(process.cwd(), 'src/styles/components.css'), 'utf8'),
    );
    const noteRule = /\.corpse-harvest-note\s*\{([^}]*)\}/.exec(css);
    expect(noteRule, '.corpse-harvest-note has no rule in components.css').not.toBeNull();
    expect(noteRule?.[1]).toContain('var(--color-text-muted)');
    expect(noteRule?.[1]).not.toContain('opacity');
    const rowRule = /\.corpse-harvest-row-no-yield\s*>\s*span\s*\{([^}]*)\}/.exec(css);
    expect(rowRule, '.corpse-harvest-row-no-yield > span has no rule').not.toBeNull();
    expect(rowRule?.[1]).toContain('var(--color-text-muted)');
    // Scoped to the row's TEXT: dimming the whole label would dim the checkbox,
    // and a greyed checkbox is this HUD's disabled idiom, so a deliberately
    // live control would read as a dead one. Every selector mentioning the
    // class must therefore end in `> span`, anywhere in the styles directory,
    // which also rejects `.corpse-harvest-row-no-yield input` and a
    // `body.mobile-touch` re-dim.
    for (const [, selector] of allCss.matchAll(
      /([^{};]*\.corpse-harvest-row-no-yield[^{};]*)\{/g,
    )) {
      expect(selector.trim(), 'dim must stay scoped to the row text').toMatch(/>\s*span$/);
    }
    const hintRule = /\.corpse-harvest\.is-concentrated\s+\.corpse-harvest-hint\s*\{([^}]*)\}/.exec(
      css,
    );
    expect(hintRule, '.corpse-harvest.is-concentrated has no rule').not.toBeNull();
    // The whole cue is the opacity lift out of the .corpse-harvest-hint default,
    // and it must stay metric-free: this block sits ABOVE the checkboxes and
    // re-renders on every toggle, so a weight, a border or a padding could
    // rewrap a long locale and shove the Harvest button under the player's
    // finger mid-press.
    expect(hintRule?.[1]).toContain('opacity: 1');
    expect(hintRule?.[1]).not.toMatch(/font-weight|font-size|padding|margin|border/);
    // The picker rows are deliberately NOT in the mobile 40px touch-floor list,
    // and that is a decision worth pinning rather than leaving as an absence:
    // raising them pushes the Harvest button below the fold at the in-game
    // landscape metrics, where the popup is already pinned at its 350px cap on
    // a 390px viewport. The reasoning lives beside the rule in hud.mobile.css;
    // this asserts the state it argues for, so re-adding a floor without
    // redoing the layout reds. Any height-shaped property, not just
    // min-height, and across every stylesheet.
    for (const [, selector, body] of allCss.matchAll(
      /([^{};]*\.corpse-harvest-(?:row|check)[^{};]*)\{([^}]*)\}/g,
    )) {
      expect(
        body,
        `no height floor on ${selector.trim()} until the popup layout is redone`,
      ).not.toMatch(/min-height|min-block-size|(^|;)\s*height\s*:|padding-block|padding-top/);
    }
    // ...and the rule the floor DOES cover on this window is still there, so
    // the sweep above is about the rows and not about an empty stylesheet.
    expect(allCss).toContain('body.mobile-touch #loot-window .btn');
  });
});
