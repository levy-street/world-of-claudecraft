// Routing + elision + no-magic-values guard for the action-bar painter (Top risks
// 1 + 4). A recording facet proves the painter drives
// only the elided writers (no raw DOM). A REAL facet over recording elements proves
// the aria-label DOM write is elided when unchanged while the core still calls t()
// every tick, and that the (expensive) icon resolve only fires on a slot rebind.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
import {
  type ActionBarPaintDescriptor,
  ActionBarPainter,
  type ActionBarSlotElements,
} from '../src/ui/action_bar_painter';
import {
  type ActionBarAbility,
  type ActionBarDeps,
  type ActionBarSlotState,
  type ActionBarState,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/action_bar_view';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';

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

const CONTAINER = { tag: 'container' } as unknown as HTMLElement;

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

function slotState(over: Partial<ActionBarSlotState> = {}): ActionBarSlotState {
  return {
    kind: 'ability',
    abilityId: 'x',
    itemId: null,
    iconKey: 'ability:x',
    cooldownRemaining: 0,
    cooldownTotal: 0,
    cooldownPercent: 0,
    cdText: '',
    count: '',
    usable: true,
    outOfRange: false,
    queued: false,
    ariaLabel: 'A',
    keybindLabel: 'K',
    ...over,
  };
}

describe('ActionBarPainter: routes every write through the elided writers', () => {
  it('drives the container many-spells toggle and the per-slot writers in order', () => {
    const { calls, writers } = recordingFacet();
    const el = slotElements('s0');
    const descriptor: ActionBarPaintDescriptor = { container: CONTAINER, slots: [el] };
    const painter = new ActionBarPainter(writers, descriptor, (key) => `URL(${key})`);

    const state: ActionBarState = {
      manySpells: true,
      slots: [
        slotState({
          kind: 'ability',
          iconKey: 'ability:fireball',
          cooldownPercent: 50,
          cdText: '3',
          count: '',
          usable: false,
          outOfRange: true,
          queued: true,
          ariaLabel: 'aria1',
          keybindLabel: '1',
        }),
      ],
    };
    painter.paint(state);

    expect(calls).toEqual([
      { m: 'toggleClass', args: [CONTAINER, 'many-spells', true] },
      { m: 'setStyleProp', args: [el.label, 'background-image', 'URL(ability:fireball)'] },
      { m: 'setText', args: [el.countEl, ''] },
      { m: 'setStyleProp', args: [el.cdOverlay, 'height', '50%'] },
      { m: 'setText', args: [el.cdText, '3'] },
      { m: 'toggleClass', args: [el.btn, 'empty', false] },
      { m: 'toggleClass', args: [el.btn, 'unusable', true] },
      { m: 'toggleClass', args: [el.btn, 'oor', true] },
      { m: 'toggleClass', args: [el.btn, 'queued', true] },
      { m: 'setAttr', args: [el.btn, 'aria-label', 'aria1'] },
      { m: 'setText', args: [el.keybindEl, '1'] },
    ]);
  });

  it('an empty slot toggles the empty class on and writes the cleared icon', () => {
    const { calls, writers } = recordingFacet();
    const el = slotElements('s0');
    const painter = new ActionBarPainter(
      writers,
      { container: CONTAINER, slots: [el] },
      (key) => `URL(${key})`,
    );
    painter.paint({ manySpells: false, slots: [slotState({ kind: 'empty', iconKey: '' })] });

    expect(calls).toContainEqual({ m: 'toggleClass', args: [el.btn, 'empty', true] });
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [el.label, 'background-image', 'URL()'],
    });
  });
});

// --- Elision against a REAL facet over recording elements ----------------------

function recordingEl() {
  const setAttrCalls: Array<[string, string]> = [];
  const node = {
    textContent: '',
    style: {
      setProperty(_prop: string, _value: string): void {},
    },
    classList: {
      toggle(_cls: string, _on: boolean): void {},
    },
    setAttribute(name: string, value: string): void {
      setAttrCalls.push([name, value]);
    },
  };
  return { setAttrCalls, el: node as unknown as HTMLElement };
}

function ability(id: string): ActionBarAbility {
  return {
    def: {
      id,
      offGcd: false,
      cooldown: 6,
      requiresTarget: false,
      range: 0,
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
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
  };
}

describe('ActionBarPainter: aria-label + icon elision (Top risks 1 + 4)', () => {
  it('writes the aria DOM attribute only on change while t() fires every tick', () => {
    const counts = { writes: 0, skips: 0 };
    const facet = makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => counts.writes++,
      () => counts.skips++,
    );
    const btn = recordingEl();
    const label = recordingEl();
    const el: ActionBarSlotElements = {
      btn: btn.el,
      label: label.el,
      countEl: recordingEl().el,
      keybindEl: recordingEl().el,
      cdOverlay: recordingEl().el,
      cdText: recordingEl().el,
    };

    const deps = fakeDeps();
    const tSpy = vi.fn(deps.t);
    const view = createActionBarView(
      {
        slots: [
          {
            slotIndex: 0,
            isAttack: false,
            hasAction: () => true,
            ability: () => ability('fireball'),
            item: () => null,
            keybindLabel: () => '1',
          },
        ],
      },
      { ...deps, t: tSpy },
    );
    const resolveBg = vi.fn((key: string) => `URL(${key})`);
    const painter = new ActionBarPainter(
      facet,
      { container: recordingEl().el, slots: [el] },
      resolveBg,
    );

    painter.paint(view.tick(idleWorld()));
    const tCallsAfterFirst = tSpy.mock.calls.length;
    painter.paint(view.tick(idleWorld()));

    // t() fired again on the second tick (the i18n key keeps firing every frame).
    expect(tSpy.mock.calls.length).toBe(tCallsAfterFirst * 2);
    // The aria DOM write happened exactly once (the second, unchanged paint elided).
    const ariaWrites = btn.setAttrCalls.filter(([name]) => name === 'aria-label');
    expect(ariaWrites).toHaveLength(1);
    // The expensive icon resolve also ran only once (the icon key did not change).
    expect(resolveBg).toHaveBeenCalledTimes(1);
  });
});

describe('ActionBarPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/action_bar_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / classList / className / setAttribute / setProperty write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
  });

  it('carries no literal hex / rgb color or px length (percent VALUE strings excepted)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    const px = code.match(/\b\d+px\b/g) ?? [];
    expect(hex, `hex: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb: ${rgb.join(', ')}`).toEqual([]);
    expect(px, `px: ${px.join(', ')}`).toEqual([]);
  });
});
