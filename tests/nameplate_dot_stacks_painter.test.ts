// @vitest-environment happy-dom

// The painter half of the nameplate stack badge: NameplatePainter.resolveDots
// formats each slot's stack count once, re-formats it only when the count
// moves, blanks it when the aura stops stacking, and re-formats both cached
// numbers on a language switch (a steady count would otherwise keep the old
// locale's digits, unlike the countdown, which moves every second).

import { describe, expect, it } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import { createNameplateCanvasState } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { Entity } from '../src/sim/types';

interface DotResolver {
  nameplateDotScale: () => number;
  dotsOwnerId: number;
  resolveDots(
    state: NameplateCanvasState,
    entity: Entity,
    player: Entity,
    languageChanged: boolean,
  ): void;
}

const ME = 1;

function harness() {
  const painter = Object.create(NameplatePainter.prototype) as DotResolver;
  painter.nameplateDotScale = () => 1;
  painter.dotsOwnerId = -1;
  const state = createNameplateCanvasState();
  const player = { id: ME } as Entity;
  const mob = {
    id: 2,
    kind: 'mob',
    dead: false,
    auras: [] as unknown[],
  } as unknown as Entity;
  const setStacks = (stacks: number | undefined) => {
    mob.auras = [
      {
        id: 'sunder_armor',
        name: 'Armor Shear',
        kind: 'sunder',
        remaining: 25,
        duration: 30,
        value: 40,
        school: 'physical',
        sourceId: ME,
        ...(stacks === undefined ? {} : { stacks }),
      },
    ] as Entity['auras'];
  };
  const resolve = (languageChanged = false) => {
    // Pre-seed the artwork so the test never mints a procedural icon: the slot
    // keeps it because the aura id never changes.
    const slot = state.dots.slots[0];
    if (slot) slot.iconUrl = 'data:sunder';
    painter.resolveDots(state, mob, player, languageChanged);
    if (state.dots.slots[0]?.iconUrl === '') state.dots.slots[0].iconUrl = 'data:sunder';
    return state.dots.slots[0];
  };
  return { setStacks, resolve, state };
}

describe('NameplatePainter stack badge cache', () => {
  it('formats the count once and re-formats only when it moves', () => {
    const h = harness();
    h.setStacks(5);
    expect(h.resolve().stacksText).toBe('5');
    // A stale text survives a steady count: proof the cache is read, not rebuilt.
    h.state.dots.slots[0].stacksText = 'stale';
    expect(h.resolve().stacksText).toBe('stale');
    h.setStacks(4);
    expect(h.resolve().stacksText).toBe('4');
  });

  it('blanks the badge when the aura drops to one application or stops stacking', () => {
    const h = harness();
    h.setStacks(3);
    expect(h.resolve().stacksText).toBe('3');
    h.setStacks(1);
    expect(h.resolve().stacksText).toBe('');
    h.setStacks(2);
    expect(h.resolve().stacksText).toBe('2');
    h.setStacks(undefined);
    expect(h.resolve().stacksText).toBe('');
  });

  it('re-formats a steady count and countdown on a language switch', () => {
    const h = harness();
    h.setStacks(5);
    h.resolve();
    h.state.dots.slots[0].stacksText = 'stale';
    h.state.dots.slots[0].timeText = 'stale';
    const slot = h.resolve(true);
    expect(slot.stacksText).toBe('5');
    expect(slot.timeText).not.toBe('stale');
  });
});
