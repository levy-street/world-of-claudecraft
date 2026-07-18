// Tests for the mobile action ring painter (Phase 1): correct source-slot state
// per page (via the shared action_bar_view core + mobile_action_page_view slot
// math), cooldown/empty rendering parity with the desktop painter (both drive the
// same ActionBarState shape), attack state independent of page, page indicator
// updates, and alloc stability. Mirrors tests/action_bar_painter.test.ts's fake
// DOM + recordingFacet() style; never jsdom.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
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
  mobilePageCount,
  nextMobilePage,
  sourceSlotForMobileButton,
} from '../src/ui/hud/action_bar/mobile_action_page_view';
import { MobileActionRingPainter } from '../src/ui/hud/action_bar/mobile_action_ring_painter';
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
      stealthed: false,
      auras: [],
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
    isAttack: () => true,
    hasAction: () => false,
    ability: () => null,
    item: () => null,
    keybindLabel: () => '',
  });
  for (let i = 0; i < 5; i++) {
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

  it('the same button index follows source slots 1, 6, 11, and 16 across all four pages', () => {
    const pageBox = { page: 0 };
    const bySlot = new Map<number, ActionBarAbility>([
      [1, ability('fireball')],
      [6, ability('frostbolt')],
      [11, ability('arcane_blast')],
      [16, ability('shadow_bolt')],
    ]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());
    for (const expected of ['fireball', 'frostbolt', 'arcane_blast', 'shadow_bolt']) {
      expect(view.tick(idleWorld()).slots[1].abilityId).toBe(expected);
      pageBox.page = nextMobilePage(pageBox.page);
    }
    expect(pageBox.page).toBe(0);
  });

  it('the last button on page 3 shows the action bound to source slot 20', () => {
    const pageBox = { page: 3 };
    const bySlot = new Map<number, ActionBarAbility>([[20, ability('execute')]]);
    const view = createActionBarView({ slots: ringDescriptor(pageBox, bySlot) }, fakeDeps());

    expect(view.tick(idleWorld()).slots[5].abilityId).toBe('execute');
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
    const pageBox = { page: 3 };
    const view = createActionBarView({ slots: ringDescriptor(pageBox, new Map()) }, fakeDeps());
    painter.paint(view.tick(idleWorld()), pageBox.page, mobilePageCount());

    expect(calls).toContainEqual({
      m: 'setText',
      args: [indicator, 'hudChrome.mobile.actionPageIndicator|{"page":4,"count":4}'],
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
    const realNode = () => ({
      textContent: '',
      style: { setProperty(): void {} },
      classList: { toggle(): void {} },
      setAttribute(): void {},
    });
    const bar = els.map(() => ({
      btn: realNode() as unknown as HTMLElement,
      label: realNode() as unknown as HTMLElement,
      countEl: realNode() as unknown as HTMLElement,
      keybindEl: realNode() as unknown as HTMLElement,
      cdOverlay: realNode() as unknown as HTMLElement,
      cdText: realNode() as unknown as HTMLElement,
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
});

describe('MobileActionRingPainter: removable attack control', () => {
  it('hides and restores the fixed attack button from the Interface setting', () => {
    const { calls, writers } = recordingFacet();
    const els = [0, 1, 2, 3, 4, 5].map((i) => slotElements(`ring${i}`));
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
  // Pins the hud.ts call sites that build and wire the mobile action ring, so a
  // refactor cannot silently disconnect the ring from the action-bar build path,
  // the attack/slot/page-toggle click handlers, or the per-frame paint gate.
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('builds the mobile action ring from buildActionBar', () => {
    expect(hud).toContain('this.buildMobileActionRing();');
  });

  it('keeps the mobile attack button independent from the assignable desktop slot 0', () => {
    expect(hud).toContain('handleMobileAttackTap(');
    expect(hud).not.toMatch(/bindTouchTap\(attackBtn,[\s\S]*?this\.castSlot\(0\);/);
  });

  it('resolves the source slot for a mobile button INSIDE the click handler, not captured at bind time', () => {
    // The slot click handler must call sourceSlotForMobileButton at click time
    // (reading this.mobileActionPage fresh) so a page cycle after bind still
    // routes taps to the correct source slot.
    expect(hud).toContain('this.castSlot(sourceSlotForMobileButton(this.mobileActionPage, i));');
  });

  it('resolves every action-view getter from the current mobile page at tick time', () => {
    expect(hud).toContain(
      'this.actionForSlot(sourceSlotForMobileButton(this.mobileActionPage, i)) !== null',
    );
    expect(hud).toContain(
      'this.abilityForSlot(sourceSlotForMobileButton(this.mobileActionPage, i))',
    );
    expect(hud).toContain('this.itemForSlot(sourceSlotForMobileButton(this.mobileActionPage, i))');
  });

  it('wires the page toggle button to cycleMobileActionPage', () => {
    expect(hud).toContain('this.cycleMobileActionPage();');
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
      /this\.mobileActionRingPainter\.paint\([\s\S]*?mobilePageCount\(\),[\s\S]*?\);/,
    );
  });

  it('leaves the primary attack slot with no painted background (Phase 5: the crisp data-icon SVG shows through instead)', () => {
    expect(hud).toContain(
      "(iconKey) => (iconKey === ATTACK_ICON_KEY ? '' : this.actionBarIconBg(iconKey)),",
    );
  });
});
