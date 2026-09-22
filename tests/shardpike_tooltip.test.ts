// The Shardpike verbs' hover card (src/ui/hud/shardpike/shardpike_tooltip.ts).
//
// The defect this pins is a whole class, not a typo: the bar's view computed a `tooltipKey`
// and a resolved `tooltipValues` bag per verb from the day it shipped, and the painter
// rendered neither. It set the native `title` to the verb's own NAME instead, so hovering
// "Loomshard Thrust" said "Loomshard Thrust" and the paragraph explaining the only
// level-agnostic damage source in the fight was unreachable. Nothing about that state is
// visible from either side alone: the view's tests all passed, the painter's counts were in
// budget, and a screenshot of the bar looks finished. Only the wiring assertion at the
// bottom can see it, which is why it drives the real painter over a fake document rather
// than trusting that a `tooltipKey` in a struct means a tooltip on screen.
//
// The reason line gets the rest of the file. Two of the three verbs are illegal most of the
// time BY DESIGN, so a player's first read of this row is three dim tiles, and a card that
// explains what a verb does while saying nothing about why it is greyed answers the
// question they did not ask.

import { describe, expect, it } from 'vitest';
import {
  SHARDPIKE_ITEM_ID,
  type ShardpikeBarInput,
  ShardpikeBarPainter,
  type ShardpikeButtonState,
  shardpikeBarState,
  shardpikeTooltipHtml,
  shardpikeTooltipModel,
} from '../src/ui/hud/shardpike';
import { t } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { LanceTrialView } from '../src/world_api/lance_trial';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';

const input = (over: Partial<ShardpikeBarInput> = {}): ShardpikeBarInput => ({
  mainhandItemId: SHARDPIKE_ITEM_ID,
  trial: null,
  restRemaining: 0,
  dead: false,
  ...over,
});
const trial = (over: Partial<LanceTrialView> = {}): LanceTrialView => ({
  phase: 'bracing',
  balance: 0,
  setProgress: 0,
  windowRemaining: 0,
  ...over,
});

/** The card for one verb, built from a real bar state rather than a hand-shaped button. */
const card = (action: ShardpikeButtonState['action'], over: Partial<ShardpikeBarInput> = {}) => {
  const state = shardpikeBarState(input(over));
  const spec = state.buttons.find((b) => b.action === action);
  if (!spec) throw new Error(`no ${action} button`);
  return shardpikeTooltipModel(spec, state.bracing);
};

describe('the card explains the mechanic', () => {
  it('carries the tooltip body the view resolved, not the button name', () => {
    // The whole original defect in one assertion: title and body must be different strings.
    const model = card('thrust');
    expect(model.titleKey).toBe('hudChrome.shardpike.thrustLabel');
    expect(model.bodyKey).toBe('hudChrome.shardpike.thrustTooltip');
    expect(t(model.bodyKey, model.bodyValues)).not.toBe(t(model.titleKey));
  });

  it('resolves every placeholder in every verb, so no card shows raw braces', () => {
    for (const action of ['brace', 'thrust', 'release'] as const) {
      const model = card(action);
      const body = t(model.bodyKey, model.bodyValues);
      expect(body, action).not.toMatch(/[{}]/);
      // A body that fell back to the key itself would also be brace-free, so require prose.
      expect(body.length, action).toBeGreaterThan(40);
    }
  });

  it('states the thrust damage as the number the sim actually deals', async () => {
    // The reason the values bag exists: this damage is FIXED and scales with nothing, so a
    // card that rounded or restated it would be teaching a number the fight does not use.
    const { LANCE_FIXED_DAMAGE } = await import('../src/sim/lance_balance_core');
    expect(t(card('thrust').bodyKey, card('thrust').bodyValues)).toContain(
      String(LANCE_FIXED_DAMAGE),
    );
  });
});

describe('the reason line', () => {
  it('stays absent while the verb is pressable', () => {
    expect(card('brace').reasonKey).toBeNull();
    expect(card('thrust', { trial: trial({ phase: 'steadied' }) }).reasonKey).toBeNull();
    expect(card('release', { trial: trial() }).reasonKey).toBeNull();
  });

  it('tells a thrust with no set pike what is missing', () => {
    expect(card('thrust').reasonKey).toBe('hudChrome.shardpike.whyNotSet');
    expect(card('thrust', { trial: trial() }).reasonKey).toBe('hudChrome.shardpike.whyNotSet');
  });

  it('separates "resting" from "already couched" on the brace', () => {
    expect(card('brace', { restRemaining: 4 }).reasonKey).toBe('hudChrome.shardpike.whyResting');
    expect(card('brace', { trial: trial() }).reasonKey).toBe(
      'hudChrome.shardpike.whyAlreadyCouched',
    );
  });

  it('shows the rest clock first when both are true', () => {
    // Both hold in the instant a fumble ends one attempt: the clock is the one the player
    // has to wait out, so it is the one worth the single line.
    expect(card('brace', { restRemaining: 4, trial: trial() }).reasonKey).toBe(
      'hudChrome.shardpike.whyResting',
    );
  });

  it('explains a release with nothing in hand', () => {
    expect(card('release').reasonKey).toBe('hudChrome.shardpike.whyNothingCouched');
  });

  it('does not invent a reason for a dead player', () => {
    // Death refuses every verb, which the death screen has already made unmissable, and the
    // card must not start claiming a gate that is not the one in force: a corpse holding
    // nothing gets no line at all. Where a real gate DOES also hold it is still stated,
    // because it is still true and it is what will block the next press after the res.
    expect(card('brace', { dead: true }).reasonKey).toBeNull();
    expect(card('brace', { dead: true, trial: trial() }).reasonKey).toBe(
      'hudChrome.shardpike.whyAlreadyCouched',
    );
  });

  it('never carries a clock, because the box is resolved once per hover', () => {
    // attachTooltip caches the tooltip's measured size on the premise that its content
    // cannot change until the next show, so any countdown in here would freeze at the
    // second it was hovered while the digit on the icon kept ticking.
    for (const key of [
      'hudChrome.shardpike.whyResting',
      'hudChrome.shardpike.whyAlreadyCouched',
      'hudChrome.shardpike.whyNotSet',
      'hudChrome.shardpike.whyNothingCouched',
    ] as const) {
      expect(t(key), key).not.toMatch(/\d/);
    }
  });
});

describe('the markup', () => {
  it('uses the shared tooltip vocabulary so it matches every other card', () => {
    const html = shardpikeTooltipHtml(card('thrust'));
    expect(html).toContain('class="tt-title"');
    expect(html).toContain('class="tt-sub"');
    expect(html).toContain('class="tt-red"');
  });

  it('omits the red row entirely rather than emitting an empty one', () => {
    const html = shardpikeTooltipHtml(card('brace'));
    expect(html).not.toContain('tt-red');
  });

  it('escapes the copy it interpolates', () => {
    const html = shardpikeTooltipHtml({
      titleKey: 'hudChrome.shardpike.braceLabel',
      bodyKey: 'hudChrome.shardpike.braceTooltip',
      bodyValues: { set: '<img src=x onerror=alert(1)>' },
      reasonKey: null,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('the painter actually hangs it on the buttons', () => {
  const writers = (): PainterHostWriters => ({
    setText: (element, value) => {
      element.textContent = value;
    },
    setDisplay: (element, value) => {
      element.style.display = value;
    },
    setTransform: () => {},
    setWidth: () => {},
    setStyleProp: (element, property, value) => element.style.setProperty(property, value),
    toggleClass: (element, className, enabled) => element.classList.toggle(className, enabled),
    setAttr: (element, attribute, value) =>
      value === null ? element.removeAttribute(attribute) : element.setAttribute(attribute, value),
  });

  /** Paint the real painter over a fake document and hand back the cards it attached. */
  const run = (over: Partial<ShardpikeBarInput> = {}, peek = () => false) => {
    const doc = new FakeDocument();
    const root = doc.createElement('div');
    const attached: { el: FakeElement; html: () => string }[] = [];
    const fired: string[] = [];
    const painter = new ShardpikeBarPainter(
      writers(),
      root as unknown as HTMLElement,
      (action) => fired.push(action),
      {
        attachTooltip: (el, html) => {
          attached.push({ el: el as unknown as FakeElement, html });
        },
        consumePeek: peek,
      },
    );
    const paint = (i: Partial<ShardpikeBarInput> = over) =>
      painter.paint(shardpikeBarState(input(i)));
    paint();
    const click = (i: number) => attached[i]?.el.dispatchEvent(new Event('click'));
    return { attached, paint, fired, click };
  };

  it('gives every verb a card, not just the one that happens to be live', () => {
    const { attached } = run();
    expect(attached).toHaveLength(3);
    for (const { html } of attached) expect(html()).toContain('tt-title');
  });

  it('renders the body prose the old title attribute threw away', () => {
    const { attached } = run();
    const thrust = attached[1];
    if (!thrust) throw new Error('no thrust card');
    expect(thrust.html()).toContain('tt-sub');
    // The one word that only ever appears in the body, never in a label.
    expect(thrust.html()).toContain('Barrowhide');
  });

  it('sets no native title, which would race the real card on hover', () => {
    // Both would fire; the native one arrives late and lands on top.
    const { attached } = run();
    for (const { el } of attached) {
      expect(el.title).toBe('');
      expect(el.getAttribute('title')).toBeNull();
      // ...but the accessible name is still there. Dropping the card is a downgrade for a
      // sighted player; dropping this is a screen reader hearing "button".
      expect(el.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('swallows the click that ends a touch long-press instead of firing the verb', () => {
    // On touch there is no hover, so reading the card MEANS holding the button, and the
    // release still delivers a click. Inspecting the thrust would otherwise spend the very
    // window the card is describing.
    const r = run({}, () => true);
    r.click(0);
    expect(r.fired).toEqual([]);
  });

  it('consumes the peek even on a greyed button, so it cannot leak to another control', () => {
    // The guard is shared HUD state. A peek this bar leaves armed is still armed when the
    // finger lands on an action-bar slot, and that slot then swallows a real ability cast.
    let armed = true;
    const r = run({}, () => {
      const was = armed;
      armed = false;
      return was;
    });
    r.click(1); // the thrust, disabled with nothing couched
    expect(r.fired).toEqual([]);
    expect(armed, 'the peek was left armed for the next control to eat').toBe(false);
  });

  it('still fires a real tap', () => {
    const r = run();
    r.click(0);
    expect(r.fired).toEqual(['brace']);
  });

  it('re-reads the fight when the pointer arrives, not when the button was built', () => {
    // The buttons are built ONCE and only re-stated, so a card closed over its build-time
    // spec would explain a state minutes stale: this is the assertion that the thunk is lazy.
    const { attached, paint } = run();
    const thrust = attached[1];
    if (!thrust) throw new Error('no thrust card');
    expect(thrust.html()).toContain(t('hudChrome.shardpike.whyNotSet'));
    paint({ trial: trial({ phase: 'steadied', setProgress: 1, windowRemaining: 5 }) });
    expect(thrust.html()).not.toContain(t('hudChrome.shardpike.whyNotSet'));
  });
});
