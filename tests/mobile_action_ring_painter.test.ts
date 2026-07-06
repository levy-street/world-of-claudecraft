// Tests for the mobile action ring painter (Phase 1): correct source-slot state
// per page (via the shared action_bar_view core + mobile_action_page_view slot
// math), cooldown/empty rendering parity with the desktop painter (both drive the
// same ActionBarState shape), attack state independent of page, page indicator
// updates, and alloc stability. Mirrors tests/action_bar_painter.test.ts's fake
// DOM + recordingFacet() style; never jsdom.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
import type { ActionBarSlotElements } from '../src/ui/action_bar_painter';
import {
  type ActionBarAbility,
  type ActionBarDeps,
  type ActionBarSlotDescriptor,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/action_bar_view';
import {
  clampMobilePage,
  nextMobilePage,
  sourceSlotForMobileButton,
} from '../src/ui/mobile_action_page_view';
import { MobileActionRingPainter } from '../src/ui/mobile_action_ring_painter';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';
import { assertAllocationStable } from './util/alloc_probe';

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
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
  };
}

// Builds a 6-slot ring descriptor (slot 0 attack, slots 1-5 resolve through
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
    isAttack: true,
    hasAction: () => false,
    ability: () => null,
    item: () => null,
    keybindLabel: () => '',
  });
  for (let i = 0; i < 5; i++) {
    slots.push({
      slotIndex: i + 1,
      isAttack: false,
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

  it('the same button index shows source slot 6 on page 1 (no rebuild, same descriptor)', () => {
    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([
      [1, ability('fireball')],
      [6, ability('frostbolt')],
    ]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    expect(view.tick(idleWorld()).slots[1].abilityId).toBe('fireball');
    pageBox.page = nextMobilePage(pageBox.page);
    expect(view.tick(idleWorld()).slots[1].abilityId).toBe('frostbolt');
  });

  it('an empty source slot renders the empty kind on the ring', () => {
    const pageBox = { page: 0 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    const state = view.tick(idleWorld());
    expect(state.slots[1].kind).toBe('empty');
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
  it('drives the 6 buttons through the same per-slot writer calls as ActionBarPainter', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4, 5].map((i) => slotElements(`ring${i}`));
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
    expect(calls).toContainEqual({ m: 'toggleClass', args: [els[0].btn, 'empty', false] });
  });
});

describe('MobileActionRingPainter: page indicator + toggle aria', () => {
  it('writes the page indicator text and the toggle aria-label on first paint', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4, 5].map((i) => slotElements(`ring${i}`));
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
    const pageBox = { page: 0 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    painter.paint(view.tick(idleWorld()), 0, 2);

    expect(calls).toContainEqual({
      m: 'setText',
      args: [indicator, 'hudChrome.mobile.actionPageIndicator|{"page":1,"count":2}'],
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
    const els = [0, 1, 2, 3, 4, 5].map((i) => slotElements(`ring${i}`));
    const toggle = {
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
    } as unknown as HTMLElement;
    const indicator = {
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
    } as unknown as HTMLElement;
    // Give the bar's own elements a real-ish shape too so ActionBarPainter's
    // writes succeed against the shared facet.
    const realEls = els.map(() => ({
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
    }));
    const bar = els.map((_e, i) => ({
      btn: realEls[i] as unknown as HTMLElement,
      label: realEls[i] as unknown as HTMLElement,
      countEl: realEls[i] as unknown as HTMLElement,
      keybindEl: realEls[i] as unknown as HTMLElement,
      cdOverlay: realEls[i] as unknown as HTMLElement,
      cdText: realEls[i] as unknown as HTMLElement,
    }));
    const painter = new MobileActionRingPainter(
      facet,
      {
        bar: { container: realEls[0] as unknown as HTMLElement, slots: bar },
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
    new URL('../src/ui/mobile_action_ring_painter.ts', import.meta.url),
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
  // Pins the hud.ts call sites that build and wire the mobile action ring, so a
  // refactor cannot silently disconnect the ring from the action-bar build path,
  // the attack/slot/page-toggle click handlers, or the per-frame paint gate.
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('builds the mobile action ring from buildActionBar', () => {
    expect(hud).toContain('this.buildMobileActionRing();');
  });

  it('wires the attack button to castSlot(0)', () => {
    expect(hud).toContain('this.castSlot(0);');
  });

  it('resolves the source slot for a mobile button INSIDE the click handler, not captured at bind time', () => {
    // The slot click handler must call sourceSlotForMobileButton at click time
    // (reading this.mobileActionPage fresh) so a page cycle after bind still
    // routes taps to the correct source slot.
    expect(hud).toContain('this.castSlot(sourceSlotForMobileButton(this.mobileActionPage, i));');
  });

  it('wires the page toggle button to cycleMobileActionPage', () => {
    expect(hud).toContain('this.cycleMobileActionPage();');
  });

  it('gates the per-frame ring paint on isMobileLayout()', () => {
    expect(hud).toContain(
      'if (this.isMobileLayout() && this.mobileActionRingView && this.mobileActionRingPainter) {',
    );
  });

  it('leaves the primary attack slot with no painted background (Phase 5: the crisp data-icon SVG shows through instead)', () => {
    expect(hud).toContain(
      "(iconKey) => (iconKey === ATTACK_ICON_KEY ? '' : this.actionBarIconBg(iconKey)),",
    );
  });
});
