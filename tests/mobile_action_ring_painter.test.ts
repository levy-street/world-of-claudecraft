// Tests for the mobile action ring painter: correct source-slot state per page
// (via the shared action_bar_view core + mobile_action_page_view slot math),
// cooldown/empty rendering parity with the desktop painter (both drive the same
// ActionBarState shape), attack state independent of page, page indicator
// updates, the radial petal layer the ring painter owns, and alloc stability. Mirrors tests/action_bar_painter.test.ts's fake
// DOM + recordingFacet() style; never jsdom.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
import { ACTION_BAR_ABILITY_SLOTS } from '../src/ui/hud/action_bar/action_bar_layout_core';
import type { ActionBarSlotElements } from '../src/ui/hud/action_bar/action_bar_painter';
import {
  type ActionBarAbility,
  type ActionBarDeps,
  type ActionBarSlotDescriptor,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import {
  clampMobilePage,
  MOBILE_ACTION_BUTTONS,
  mobileActionSourceSlotCount,
  mobileButtonHasSourceSlot,
  mobilePageCount,
  nextMobilePage,
  sourceSlotForMobileButton,
} from '../src/ui/hud/action_bar/mobile_action_page_view';
import { MobileActionRingPainter } from '../src/ui/hud/action_bar/mobile_action_ring_painter';
import {
  RADIAL_DIRECTIONS,
  type RadialPlacement,
} from '../src/ui/hud/action_bar/radial_action_core';
import { radialCancelIsLive } from '../src/ui/hud/action_bar/radial_gesture_core';
import {
  RADIAL_PETAL_DIRECTIONS,
  RadialPetalPainter,
} from '../src/ui/hud/action_bar/radial_petal_painter';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import { assertAllocationStable } from './util/alloc_probe';

const HUD_CSS = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
const MOBILE_HUD_CSS = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
);

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingFacet() {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => {
      calls.push({ m: 'setText', args: [el, text] });
    },
    setDisplay: (el, display) => {
      calls.push({ m: 'setDisplay', args: [el, display] });
    },
    setTransform: (el, transform) => {
      calls.push({ m: 'setTransform', args: [el, transform] });
    },
    setWidth: (el, width) => {
      calls.push({ m: 'setWidth', args: [el, width] });
    },
    setStyleProp: (el, prop, value) => {
      calls.push({ m: 'setStyleProp', args: [el, prop, value] });
    },
    toggleClass: (el, cls, on) => {
      calls.push({ m: 'toggleClass', args: [el, cls, on] });
    },
    setAttr: (el, name, value) => {
      calls.push({ m: 'setAttr', args: [el, name, value] });
    },
  };
  return { calls, writers };
}

function slotElements(tag: string): ActionBarSlotElements {
  return {
    btn: { tag: `${tag}-btn` } as unknown as HTMLElement,
    label: { tag: `${tag}-label` } as unknown as HTMLElement,
    countEl: { tag: `${tag}-count` } as unknown as HTMLElement,
    keybindEl: { tag: `${tag}-kb` } as unknown as HTMLElement,
    cdOverlay: { tag: `${tag}-cd` } as unknown as HTMLElement,
    cdText: { tag: `${tag}-cdtext` } as unknown as HTMLElement,
    rechargeOverlay: { tag: `${tag}-recharge` } as unknown as HTMLElement,
  };
}

function ability(id: string, over: Partial<AbilityDef> = {}): ActionBarAbility {
  return {
    def: {
      id,
      offGcd: false,
      cooldown: 6,
      requiresTarget: false,
      range: 0,
      ...over,
    } as unknown as AbilityDef,
    cost: 0,
  };
}

function fakeDeps(): ActionBarDeps {
  return {
    t: (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    abilityName: (def) => def.id,
    itemName: (i) => i.id,
    slotLabel: (slotIndex) => `${slotIndex + 1}`,
    formatCount: (n) => String(n),
  };
}

function idleWorld(): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      resourceType: 'mana' as const,
      savedMana: 0,
      queuedOnSwing: null,
      auras: [],
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
    stealthed: false,
    entities: [],
    activeAimSlot: null,
  };
}

// Builds a 5-slot ring descriptor (slot 0 attack, slots 1-4 resolve through
// sourceSlotForMobileButton(page, i-1)) over a fake per-source-slot ability map,
// mirroring the shape Hud.buildActionBar() wires. `page` is a mutable box so a
// test can flip it and observe the SAME descriptor (matching hud.ts: page flip
// mutates a field, the descriptor's closures re-resolve, no rebuild).
function ringDescriptor(
  pageBox: { page: number },
  abilitiesBySourceSlot: Map<number, ActionBarAbility>,
): ActionBarSlotDescriptor[] {
  const slots: ActionBarSlotDescriptor[] = [];
  slots.push({
    slotIndex: 0,
    isAttack: () => true,
    hasAction: () => false,
    ability: () => null,
    item: () => null,
    keybindLabel: () => '',
  });
  for (let i = 0; i < MOBILE_ACTION_BUTTONS; i++) {
    slots.push({
      slotIndex: i + 1,
      isAttack: () => false,
      hasAction: () => abilitiesBySourceSlot.has(sourceSlotForMobileButton(pageBox.page, i)),
      ability: () => abilitiesBySourceSlot.get(sourceSlotForMobileButton(pageBox.page, i)) ?? null,
      item: () => null,
      keybindLabel: () => '',
    });
  }
  return slots;
}

describe('mobile action ring: source-slot state per page', () => {
  it('slot 1 (button index 0) shows the ability bound to source slot 1 on page 0', () => {
    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([[1, ability('fireball')]]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    const state = view.tick(idleWorld());
    expect(state.slots[1].abilityId).toBe('fireball');
  });

  it('the same button index follows its centre source slot across BOTH pages', () => {
    // Radial paging: one page covers 4 buttons x 5 directions = 20 slots, so
    // button 0's centre is slot 1 on page 0 and slot 21 on page 1.
    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([
      [1, ability('fireball')],
      [21, ability('execute')],
    ]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    for (const expected of ['fireball', 'execute']) {
      expect(view.tick(idleWorld()).slots[1].abilityId).toBe(expected);
      pageBox.page = nextMobilePage(pageBox.page);
    }
    expect(pageBox.page, 'two pages cover the whole 33-slot span').toBe(0);
  });

  it('the last button centre on page 1 shows the action bound to source slot 24', () => {
    const pageBox = { page: 1 };
    const bySlot = new Map<number, ActionBarAbility>([[24, ability('execute')]]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());

    expect(view.tick(idleWorld()).slots[MOBILE_ACTION_BUTTONS].abilityId).toBe('execute');
  });

  it('the direction-major order gives every button its own 4 flick slots', () => {
    // Centre takes 1-4 (the desktop 1-4 keys), then up 5-8, right 9-12, down
    // 13-16, left 17-20; page 1 repeats the pattern from 21.
    expect(RADIAL_PETAL_DIRECTIONS.map((d) => sourceSlotForMobileButton(0, 0, d))).toEqual([
      5, 9, 13, 17,
    ]);
    expect(RADIAL_PETAL_DIRECTIONS.map((d) => sourceSlotForMobileButton(0, 3, d))).toEqual([
      8, 12, 16, 20,
    ]);
    expect(RADIAL_PETAL_DIRECTIONS.map((d) => sourceSlotForMobileButton(1, 0, d))).toEqual([
      25, 29, 33, 37,
    ]);
  });

  it('an empty source slot renders the empty kind on the ring', () => {
    const pageBox = { page: 0 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    const state = view.tick(idleWorld());
    expect(state.slots[1].kind).toBe('empty');
  });
});

describe('mobile action ring: proc state remains perceptible', () => {
  function ruleBody(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    expect(close, selector).toBeGreaterThan(open);
    return css.slice(open + 1, close);
  }

  it('renders the shared proc class on touch as well as desktop', () => {
    expect(HUD_CSS).toMatch(/\.action-btn\.proc\s*\{[^}]*abtn-proc-pulse/s);
    expect(MOBILE_HUD_CSS).toMatch(
      /body\.mobile-touch #mobile-action-ring button\.proc\s*\{[^}]*abtn-proc-pulse/s,
    );
  });

  it('uses a double system-color border as the forced-colors shape cue', () => {
    expect(HUD_CSS).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.action-btn\.proc\s*\{[^}]*border:\s*3px double Highlight/,
    );
    expect(MOBILE_HUD_CSS).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?button\.proc\s*\{[^}]*border:\s*3px double Highlight/,
    );
  });

  it('stops the touch proc pulse under reduced motion', () => {
    const steadyRule = ruleBody(
      MOBILE_HUD_CSS,
      'body.mobile-touch #mobile-action-ring button.proc',
    );
    expect(steadyRule).toContain('border-color: #ffd97a;');
    expect(steadyRule).toMatch(/box-shadow:\s*[\s\S]*#ffcf40e6/);
    // The override may share its block with other selectors (button.empowered
    // groups with it upstream): [^{]* spans the rest of the selector list, so
    // this still proves button.proc itself receives animation: none.
    expect(MOBILE_HUD_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?body\.mobile-touch #mobile-action-ring button\.proc[^{]*\{[^}]*animation:\s*none/,
    );
  });
});

describe('mobile action ring: attack state independent of page', () => {
  it('slot 0 stays the attack kind regardless of the page', () => {
    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([[1, ability('fireball')]]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    expect(view.tick(idleWorld()).slots[0].kind).toBe('attack');
    pageBox.page = clampMobilePage(nextMobilePage(pageBox.page));
    expect(view.tick(idleWorld()).slots[0].kind).toBe('attack');
  });
});

describe('MobileActionRingPainter: cooldown/empty rendering parity with the desktop painter', () => {
  it('drives the 5 buttons through the same per-slot writer calls as ActionBarPainter', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const toggle = { tag: 'toggle' } as unknown as HTMLElement;
    const indicator = { tag: 'indicator' } as unknown as HTMLElement;
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'ring-container' } as unknown as HTMLElement, slots: els },
        pageToggle: toggle,
        pageIndicator: indicator,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );

    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([[1, ability('fireball', { cooldown: 6 })]]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    painter.paint(view.tick(idleWorld()), pageBox.page, 2);

    // Same call shapes as the desktop ActionBarPainter (icon write, count, cd
    // overlay, cd text, class toggles, aria, keybind) for the bound slot 1.
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [els[1].label, 'background-image', 'URL(ability:fireball)'],
    });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[1].btn, 'empty', false] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[1].btn, 'ability', true] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[0].btn, 'empty', false] });
  });
});

describe('MobileActionRingPainter: page indicator + toggle aria', () => {
  it('writes the page indicator text and the toggle aria-label on first paint', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const toggle = { tag: 'toggle' } as unknown as HTMLElement;
    const indicator = { tag: 'indicator' } as unknown as HTMLElement;
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'c' } as unknown as HTMLElement, slots: els },
        pageToggle: toggle,
        pageIndicator: indicator,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );
    const pageBox = { page: 1 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    painter.paint(view.tick(idleWorld()), pageBox.page, mobilePageCount());

    expect(mobilePageCount(), 'the radial ring spans 33 slots in TWO pages').toBe(2);
    expect(calls).toContainEqual({
      m: 'setText',
      args: [indicator, 'hudChrome.mobile.actionPageIndicator|{"page":2,"count":2}'],
    });
    expect(calls).toContainEqual({
      m: 'setAttr',
      args: [toggle, 'aria-label', 'hudChrome.mobile.actionPageToggle'],
    });
  });

  it('elides the indicator/toggle write when the page/count are unchanged', () => {
    const counts = { writes: 0, skips: 0 };
    const facet = makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => counts.writes++,
      () => counts.skips++,
    );
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const toggle = {
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
      removeAttribute(): void {},
    } as unknown as HTMLElement;
    const indicator = {
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
      removeAttribute(): void {},
    } as unknown as HTMLElement;
    // Give the bar's own elements a real-ish shape too so ActionBarPainter's
    // writes succeed against the shared facet.
    const realNode = () => ({
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
      removeAttribute(): void {},
    });
    const bar = els.map(() => ({
      btn: realNode() as unknown as HTMLElement,
      label: realNode() as unknown as HTMLElement,
      countEl: realNode() as unknown as HTMLElement,
      keybindEl: realNode() as unknown as HTMLElement,
      cdOverlay: realNode() as unknown as HTMLElement,
      cdText: realNode() as unknown as HTMLElement,
      rechargeOverlay: realNode() as unknown as HTMLElement,
    }));
    const painter = new MobileActionRingPainter(
      facet,
      {
        bar: { container: realNode() as unknown as HTMLElement, slots: bar },
        pageToggle: toggle,
        pageIndicator: indicator,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );
    const pageBox = { page: 0 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());

    painter.paint(view.tick(idleWorld()), 0, 2);
    const writesAfterFirst = counts.writes;
    painter.paint(view.tick(idleWorld()), 0, 2);
    // No NEW indicator/toggle writes on the second, unchanged-page paint (the
    // per-slot bar writes may also elide since state is unchanged too, so total
    // writes should not grow at all).
    expect(counts.writes).toBe(writesAfterFirst);

    painter.paint(view.tick(idleWorld()), 1, 2);
    expect(counts.writes).toBeGreaterThan(writesAfterFirst);
  });

  it('paints the last page with third-row centres 21 to 24, every button live', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const indicator = { tag: 'indicator' } as unknown as HTMLElement;
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'c' } as unknown as HTMLElement, slots: els },
        pageToggle: { tag: 'toggle' } as unknown as HTMLElement,
        pageIndicator: indicator,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );
    const pageBox = { page: 1 };
    const view = createActionBarView(
      {
        slots: ringDescriptor(
          pageBox,
          new Map([
            [21, ability('slot21')],
            [22, ability('slot22')],
            [23, ability('slot23')],
            [24, ability('slot24')],
          ]),
        ),
      },
      fakeDeps(),
    );
    const state = view.tick(idleWorld());

    expect(state.slots.slice(1).map((slot) => slot.abilityId)).toEqual([
      'slot21',
      'slot22',
      'slot23',
      'slot24',
    ]);
    painter.paint(state, 1, mobilePageCount());
    expect(calls).toContainEqual({
      m: 'setText',
      args: [indicator, 'hudChrome.mobile.actionPageIndicator|{"page":2,"count":2}'],
    });
    // Every centre on the last page maps to a real slot at the full 33-slot
    // span, which is the capacity win: nothing is stranded behind an empty seat.
    for (let i = 1; i <= MOBILE_ACTION_BUTTONS; i++) {
      expect(calls).toContainEqual({ m: 'setDisplay', args: [els[i].btn, ''] });
    }
  });

  it('hides the ring buttons whose centre falls past the enabled span', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'c' } as unknown as HTMLElement, slots: els },
        pageToggle: { tag: 'toggle' } as unknown as HTMLElement,
        pageIndicator: { tag: 'indicator' } as unknown as HTMLElement,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );
    // A 22-slot span (the painter honours whatever span it is handed), so page
    // 1's centres are 21, 22 (real) and 23, 24 (past the span, hidden).
    const visibleSlots = 22;
    const pageBox = { page: 1 };
    const view = createActionBarView(
      {
        slots: ringDescriptor(
          pageBox,
          new Map([
            [21, ability('slot21')],
            [22, ability('slot22')],
          ]),
        ),
      },
      fakeDeps(),
    );
    const state = view.tick(idleWorld());

    painter.paint(state, 1, mobilePageCount(visibleSlots), visibleSlots);

    expect(calls).toContainEqual({ m: 'setDisplay', args: [els[1].btn, ''] });
    expect(calls).toContainEqual({ m: 'setDisplay', args: [els[2].btn, ''] });
    expect(calls).toContainEqual({ m: 'setDisplay', args: [els[3].btn, 'none'] });
    expect(calls).toContainEqual({ m: 'setDisplay', args: [els[4].btn, 'none'] });
  });

  it('spans slots 1 to 33 across both pages at the DEFAULT desktop row visibility', () => {
    // The reported bug: the touch span followed the optional DESKTOP rows, so a
    // default character's ring had ONE page and every down or left flick
    // addressed a slot that could not be filled.
    const span = mobileActionSourceSlotCount({ secondary: false, third: false });
    const reachable: number[] = [];
    for (let page = 0; page < mobilePageCount(span); page++) {
      for (let button = 0; button < MOBILE_ACTION_BUTTONS; button++) {
        for (const direction of RADIAL_DIRECTIONS) {
          if (mobileButtonHasSourceSlot(page, button, span, direction)) {
            reachable.push(sourceSlotForMobileButton(page, button, direction));
          }
        }
      }
    }
    expect(reachable.sort((a, b) => a - b)).toEqual(
      Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, (_, index) => index + 1),
    );

    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const indicator = { tag: 'indicator' } as unknown as HTMLElement;
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'c' } as unknown as HTMLElement, slots: els },
        pageToggle: { tag: 'toggle' } as unknown as HTMLElement,
        pageIndicator: indicator,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );
    const pageBox = { page: 0 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    painter.paint(view.tick(idleWorld()), pageBox.page, mobilePageCount(span), span);

    expect(calls).toContainEqual({
      m: 'setText',
      args: [indicator, 'hudChrome.mobile.actionPageIndicator|{"page":1,"count":2}'],
    });
    for (let i = 1; i <= MOBILE_ACTION_BUTTONS; i++) {
      expect(calls).toContainEqual({ m: 'setDisplay', args: [els[i].btn, ''] });
    }
  });
});

describe('MobileActionRingPainter: removable attack control', () => {
  it('hides and restores the fixed attack button from the Interface setting', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: {
          container: { tag: 'ring-container' } as unknown as HTMLElement,
          slots: els,
        },
        pageToggle: { tag: 'toggle' } as unknown as HTMLElement,
        pageIndicator: { tag: 'indicator' } as unknown as HTMLElement,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    );
    const view = createActionBarView({ slots: ringDescriptor({ page: 0 }, new Map()) }, fakeDeps());

    painter.paint(view.tick(idleWorld()), 0, 2, false);
    expect(calls).toContainEqual({ m: 'setDisplay', args: [els[0].btn, 'none'] });

    calls.length = 0;
    painter.paint(view.tick(idleWorld()), 0, 2, true);
    expect(calls).toContainEqual({ m: 'setDisplay', args: [els[0].btn, ''] });
  });
});

function petalPlacement(originX: number, originY: number, r: number): RadialPlacement {
  return {
    originX,
    originY,
    petals: [
      { direction: 'center', dx: 0, dy: 0 },
      { direction: 'up', dx: 0, dy: -r },
      { direction: 'right', dx: r, dy: 0 },
      { direction: 'down', dx: 0, dy: r },
      { direction: 'left', dx: -r, dy: 0 },
    ],
  };
}

describe('RadialPetalPainter: measured seating + live highlight', () => {
  function petalRig() {
    const { calls, writers } = recordingFacet();
    const els = RADIAL_PETAL_DIRECTIONS.map((d) => slotElements(`petal-${d}`));
    const overlay = { tag: 'overlay' } as unknown as HTMLElement;
    const cancel = { tag: 'cancel' } as unknown as HTMLElement;
    const painter = new RadialPetalPainter(
      writers,
      { overlay, cancel, bar: { container: overlay, slots: els } },
      (key) => `URL(${key})`,
    );
    return { calls, els, overlay, cancel, painter };
  }

  function petalState() {
    const pageBox = { page: 0 };
    const view = createActionBarView(
      {
        slots: RADIAL_PETAL_DIRECTIONS.map((direction, i) => ({
          slotIndex: i,
          isAttack: () => false,
          hasAction: () => true,
          ability: () => ability(`petal-${direction}-p${pageBox.page}`),
          item: () => null,
          keybindLabel: () => '',
        })),
      },
      fakeDeps(),
    );
    return view.tick(idleWorld());
  }

  it('seats each petal at its placement offset from the radial origin', () => {
    const { calls, els, overlay, painter } = petalRig();
    painter.paint(petalState(), petalPlacement(300, 200, 60), 'center', true);

    expect(calls).toContainEqual({ m: 'toggleClass', args: [overlay, 'open', true] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [overlay, '--radial-x', '300px'] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [overlay, '--radial-y', '200px'] });
    // up, right, down, left in RADIAL_PETAL_DIRECTIONS order.
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [els[0].btn, 'top', '140px'] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [els[0].btn, 'left', '300px'] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [els[1].btn, 'left', '360px'] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [els[2].btn, 'top', '260px'] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [els[3].btn, 'left', '240px'] });
  });

  it('marks exactly the live direction, and the cancel target at the centre', () => {
    const { calls, els, cancel, painter } = petalRig();
    painter.paint(
      petalState(),
      petalPlacement(300, 200, 60),
      'right',
      radialCancelIsLive('right', true),
    );

    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[1].btn, 'live', true] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[0].btn, 'live', false] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [cancel, 'live', false] });

    calls.length = 0;
    painter.paint(
      petalState(),
      petalPlacement(300, 200, 60),
      'center',
      radialCancelIsLive('center', true),
    );
    expect(calls).toContainEqual({ m: 'toggleClass', args: [cancel, 'live', true] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[1].btn, 'live', false] });
  });

  it('takes the cancel highlight from the caller, never from the direction alone', () => {
    // The rule lives in radialCancelIsLive: the centre is only a WAY OUT once the
    // petals are up, so a centred drag that has not revealed must not light the X.
    const { calls, cancel, painter } = petalRig();
    painter.paint(
      petalState(),
      petalPlacement(300, 200, 60),
      'center',
      radialCancelIsLive('center', false),
    );
    expect(calls).toContainEqual({ m: 'toggleClass', args: [cancel, 'live', false] });
  });

  it('paints each petal through the shared ActionBarPainter icon path', () => {
    const { calls, els, painter } = petalRig();
    painter.paint(petalState(), petalPlacement(300, 200, 60), 'center', true);
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [els[0].label, 'background-image', 'URL(ability:petal-up-p0)'],
    });
  });

  it('closes with a single elided class toggle and no seating rewrite', () => {
    const { calls, overlay, painter } = petalRig();
    painter.paint(petalState(), petalPlacement(300, 200, 60), 'center', true);
    calls.length = 0;
    painter.hide();
    expect(calls).toEqual([{ m: 'toggleClass', args: [overlay, 'open', false] }]);
  });
});

describe('MobileActionRingPainter: the petal layer rides the ring paint', () => {
  function ringWithPetals(open: boolean) {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const petalEls = RADIAL_PETAL_DIRECTIONS.map((d) => slotElements(`petal-${d}`));
    const overlay = { tag: 'overlay' } as unknown as HTMLElement;
    const cancel = { tag: 'cancel' } as unknown as HTMLElement;
    const petalPainter = new RadialPetalPainter(
      writers,
      { overlay, cancel, bar: { container: overlay, slots: petalEls } },
      (key) => `URL(${key})`,
    );
    const petalView = createActionBarView(
      {
        slots: RADIAL_PETAL_DIRECTIONS.map((direction, i) => ({
          slotIndex: i,
          isAttack: () => false,
          hasAction: () => true,
          ability: () => ability(`petal-${direction}`),
          item: () => null,
          keybindLabel: () => '',
        })),
      },
      fakeDeps(),
    );
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'c' } as unknown as HTMLElement, slots: els },
        pageToggle: { tag: 'toggle' } as unknown as HTMLElement,
        pageIndicator: { tag: 'indicator' } as unknown as HTMLElement,
      },
      (key) => `URL(${key})`,
      (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
      {
        painter: petalPainter,
        source: {
          isOpen: () => open,
          placement: () => (open ? petalPlacement(300, 200, 60) : null),
          liveDirection: () => 'up' as const,
          cancelIsLive: () => false,
          tick: () => petalView.tick(idleWorld()),
        },
      },
    );
    const ringView = createActionBarView(
      { slots: ringDescriptor({ page: 0 }, new Map()) },
      fakeDeps(),
    );
    painter.paint(ringView.tick(idleWorld()), 0, mobilePageCount());
    return { calls, overlay };
  }

  it('opens and seats the petals from the ring paint when a button is held', () => {
    const { calls, overlay } = ringWithPetals(true);
    expect(calls).toContainEqual({ m: 'toggleClass', args: [overlay, 'open', true] });
    expect(calls).toContainEqual({ m: 'setStyleProp', args: [overlay, '--radial-x', '300px'] });
  });

  it('closes the petals on an idle frame, writing nothing else for them', () => {
    const { calls, overlay } = ringWithPetals(false);
    expect(calls).toContainEqual({ m: 'toggleClass', args: [overlay, 'open', false] });
    expect(calls.filter((c) => c.args[0] === overlay)).toHaveLength(1);
  });
});

describe('mobile action ring: alloc stability', () => {
  it('the ring view stays allocation-stable across page flips (fixed descriptor + mutable closure)', () => {
    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([
      [1, ability('fireball')],
      [6, ability('frostbolt')],
    ]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    let call = 0;
    assertAllocationStable(
      () => {
        pageBox.page = call % 2;
        call++;
        return view.tick(idleWorld());
      },
      64,
      'mobile action ring view',
    );
  });
});

describe('MobileActionRingPainter: no raw DOM writes', () => {
  const src = readFileSync(
    new URL('../src/ui/hud/action_bar/mobile_action_ring_painter.ts', import.meta.url),
    'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / classList / className / setAttribute / setProperty write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
  });

  it('carries no literal hex / rgb color or px length', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    const px = code.match(/\b\d+px\b/g) ?? [];
    expect(hex, `hex: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb: ${rgb.join(', ')}`).toEqual([]);
    expect(px, `px: ${px.join(', ')}`).toEqual([]);
  });
});

describe('Hud.buildMobileActionRing wiring (source scan)', () => {
  // Pins the call sites that build and wire the mobile action ring, so a
  // refactor cannot silently disconnect the ring from the action-bar build path,
  // the attack/slot/page-toggle handlers, or the per-frame paint gate. The
  // construction itself now lives behind the action_bar seam
  // (mobile_action_ring_controller.ts); Hud keeps the page state, the cast path
  // and the paint call, so the pins below read whichever file owns each half.
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const ring = readFileSync(
    new URL('../src/ui/hud/action_bar/mobile_action_ring_controller.ts', import.meta.url),
    'utf8',
  );
  const gesture = readFileSync(
    new URL('../src/ui/hud/action_bar/radial_gesture_controller.ts', import.meta.url),
    'utf8',
  );

  it('builds the mobile action ring from buildActionBar', () => {
    expect(hud).toContain('this.buildMobileActionRing();');
    expect(hud).toContain(
      "import { buildMobileActionRing } from './hud/action_bar/mobile_action_ring_controller';",
    );
  });

  it('keeps the mobile attack button independent from the assignable desktop slot 0', () => {
    expect(ring).toContain('handleMobileAttackTap(');
    expect(ring).not.toMatch(/bindTouchTap\(attackBtn,[\s\S]*?castSlot\(0\);/);
  });

  it('resolves the source slot for a mobile button INSIDE the cast handler, not captured at bind time', () => {
    // The gesture's cast callback must resolve the slot at RELEASE time (which
    // reads this.mobileActionPage fresh) so a page cycle after bind still routes
    // the gesture to the correct source slot, and the direction the drag
    // resolved to picks the slot within that button.
    expect(ring).toContain('deps.castSlot(deps.sourceSlot(buttonIndex, direction));');
    expect(hud).toContain(
      'sourceSlot: (i, direction) => this.mobileSourceSlotForButton(i, direction),',
    );
    expect(hud).toContain(
      'return sourceSlotForMobileButton(this.currentMobileActionPage(), buttonIndex, direction);',
    );
  });

  it('resolves every action-view getter from the current mobile page at tick time', () => {
    expect(ring).toContain("deps.actionForSlot(deps.sourceSlot(i, 'center')) !== null");
    expect(ring).toContain("deps.abilityForSlot(deps.sourceSlot(i, 'center'))");
    expect(ring).toContain("deps.itemForSlot(deps.sourceSlot(i, 'center'))");
  });

  it('maps active aim ownership across every direction on a physical ring button', () => {
    expect(ring).toContain('aimOwnsButton: (buttonIndex) => deps.aimOwnsButton(buttonIndex),');
    expect(hud).toContain('mobileButtonOwnsSourceSlot(');
    expect(ring).toContain('cancelAim: () => deps.cancelAim(),');
    expect(ring).toContain('ownsAimSlot: () => deps.aimOwnsButton(i),');
  });

  it('binds the empowered hold BEFORE the radial gesture', () => {
    // Order decides who wins a release: the hold arms the shared suppress flag
    // from its own pointerup and the radial reads it. Attached first, the radial
    // would cast on top of an empowered hold.
    const hold = ring.indexOf('deps.bindEmpoweredHold(btn');
    const attach = ring.indexOf('gesture.attach();');
    expect(hold).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(hold);
    expect(ring).toContain('takeSuppressedPress: () => deps.takeSuppressedClick(),');
    expect(ring).toContain("deps.aimOwnsButton(i) ? -1 : deps.sourceSlot(i, 'center')");
    expect(hud).toContain('takeSuppressedClick: () => {');
  });

  it('hands the gesture a petal repaint, so a sticky open paints before it focuses', () => {
    // The petals are display:none until the overlay is painted open, and the
    // sticky path moves focus onto the first one in the same call, so the paint
    // has to be reachable from the gesture rather than only from Hud's frame.
    expect(ring).toContain('repaint: () => ringPainter?.paintPetals(),');
    expect(gesture).toContain('this.deps.repaint?.();');
  });

  it('arms NO rearrange gesture on the live ring', () => {
    // The long-press rearrange this replaces opened under the radial: a hold
    // long enough to reveal the petals could also pick the slot up and swap it
    // on release. Binding on touch is the bar editor overlay now, so neither the
    // ring nor the gesture layer carries a drag seam at all.
    //
    // The retired names are the REAL ones (verified against
    // 65b91fa19:src/ui/hud.ts, where all four existed): bindMobileRingDrag,
    // bindMobileActionDrag, mobileHotbarDrag, mobile-hotbar-dragging. A prior
    // shape of this guard scanned for names that never existed in any version
    // of the tree (bindRingDrag, dragActive, hotbarDragActive) and passed
    // vacuously. radial_gesture_controller.ts legitimately uses drag
    // vocabulary for the radial itself ('drags', 'DragState'), which is
    // exactly why the tokens below are the retired construct's own literal
    // names rather than a generic "drag" substring: a reintroduced rearrange
    // would not need to touch any of those legitimate names at all.
    const retiredTokens = [
      'bindMobileRingDrag',
      'bindMobileActionDrag',
      'mobileHotbarDrag',
      'mobile-hotbar-dragging',
    ];
    const scannedFiles: Array<{ name: string; code: string; positiveControl: string }> = [
      { name: 'hud.ts', code: hud, positiveControl: 'buildMobileActionRing' },
      {
        name: 'mobile_action_ring_controller.ts',
        code: ring,
        positiveControl: 'MobileActionRingDeps',
      },
      { name: 'radial_gesture_controller.ts', code: gesture, positiveControl: 'RadialGesture' },
    ];
    for (const file of scannedFiles) {
      // Positive control: prove the scan is reading real content, not an
      // empty file or a stale path that would make every negative below
      // vacuous.
      expect(file.code, `${file.name} scan read no real content`).toContain(file.positiveControl);
      for (const token of retiredTokens) {
        expect(file.code, `${token} must not survive the removal (${file.name})`).not.toContain(
          token,
        );
      }
    }
  });

  it('wires the page toggle button to cycleMobileActionPage', () => {
    expect(ring).toContain('deps.cyclePage();');
    expect(hud).toContain('cyclePage: () => this.cycleMobileActionPage(),');
  });

  it('gates the per-frame ring paint on isMobileLayout()', () => {
    expect(hud).toContain(
      'if (this.isMobileLayout() && this.mobileActionRingView && this.mobileActionRingPainter) {',
    );
  });

  it('passes the live Show Attack Button setting into the mobile ring painter', () => {
    expect(hud).toMatch(
      /this\.mobileActionRingPainter\.paint\([\s\S]*?this\.attackSlotIsAttack\(\),[\s\S]*?\);/,
    );
  });

  it('passes the shared mobile page count into the mobile ring painter', () => {
    expect(hud).toMatch(
      /this\.mobileActionRingPainter\.paint\([\s\S]*?mobilePageCount\(mobileActionSourceSlotCount\),[\s\S]*?\);/,
    );
  });

  it('passes the live mobile-visible source-slot count into the mobile ring painter', () => {
    expect(hud).toContain('const mobileActionSourceSlotCount = MOBILE_ACTION_SOURCE_SLOT_COUNT;');
  });

  it('leaves the primary attack slot with no painted background (the crisp data-icon SVG shows through instead)', () => {
    expect(ring).toContain(
      "(iconKey) => (iconKey === ATTACK_ICON_KEY ? '' : deps.iconBackground(iconKey)),",
    );
  });

  // #2529: the page/count latch is two integers, so a language switch alone
  // cannot move it and the elision above would hold the previous locale's
  // "Page X of Y" and toggle name for as long as the player stayed on the page.
  it('re-issues the elided indicator writes in the new locale after relocalize()', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4].map((i) => slotElements(`ring${i}`));
    const indicator = { tag: 'indicator' } as unknown as HTMLElement;
    const toggle = { tag: 'toggle' } as unknown as HTMLElement;
    let locale = 'en';
    const painter = new MobileActionRingPainter(
      writers,
      {
        bar: { container: { tag: 'c' } as unknown as HTMLElement, slots: els },
        pageToggle: toggle,
        pageIndicator: indicator,
      },
      (key) => `URL(${key})`,
      (key, values) => `${locale}:${key}${values ? `|${JSON.stringify(values)}` : ''}`,
    );
    const pageBox = { page: 0 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    const indicatorWrites = (): unknown[] =>
      calls.filter((c) => c.m === 'setText' && c.args[0] === indicator).map((c) => c.args[1]);
    const toggleWrites = (): unknown[] =>
      calls.filter((c) => c.m === 'setAttr' && c.args[0] === toggle).map((c) => c.args[2]);

    painter.paint(view.tick(idleWorld()), 0, 2);
    expect(indicatorWrites()).toEqual([
      'en:hudChrome.mobile.actionPageIndicator|{"page":1,"count":2}',
    ]);
    expect(toggleWrites()).toEqual(['en:hudChrome.mobile.actionPageToggle']);

    // The switch itself moves nothing the latch can see: this paint must elide.
    locale = 'es';
    painter.paint(view.tick(idleWorld()), 0, 2);
    expect(indicatorWrites(), 'the unchanged-page paint stopped eliding').toHaveLength(1);

    painter.relocalize();
    painter.paint(view.tick(idleWorld()), 0, 2);
    expect(indicatorWrites()).toEqual([
      'en:hudChrome.mobile.actionPageIndicator|{"page":1,"count":2}',
      'es:hudChrome.mobile.actionPageIndicator|{"page":1,"count":2}',
    ]);
    expect(toggleWrites()).toEqual([
      'en:hudChrome.mobile.actionPageToggle',
      'es:hudChrome.mobile.actionPageToggle',
    ]);

    // The latch is retaken by that paint, so the ring goes straight back to
    // eliding rather than rewriting both nodes on every subsequent frame.
    painter.paint(view.tick(idleWorld()), 0, 2);
    expect(indicatorWrites(), 'relocalize() left the page latch cleared').toHaveLength(2);
  });
});
