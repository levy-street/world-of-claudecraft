// Pure tests for the TOUCH stance control's render model
// (src/ui/hud/stance/stance_radial_core.ts): which stance the anchor wears, which
// direction each remaining stance is reached on, and the four-direction capacity
// guard. Node-only, no DOM (UI_PURE_CORES). The shared model it consumes is
// pinned in tests/stance_bar_view.test.ts; the desktop row is unchanged.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WARRIOR_STANCE_IDS } from '../src/sim/combat/warrior_stances';
import {
  STANCE_PETAL_DIRECTIONS,
  STANCE_RADIAL_CAPACITY,
  stancePetalIndex,
  stanceRadialView,
} from '../src/ui/hud/stance/stance_radial_core';
import type { StanceBarModel } from '../src/ui/stance_bar_view';
import { stanceBarView } from '../src/ui/stance_bar_view';

function model(ids: string[], active: string | null): StanceBarModel {
  return stanceBarView('warrior', ids, active);
}

/** A model with more alternatives than the radial has directions. No shipped
 *  class reaches this; the guard exists so one that ever did fails loudly here
 *  instead of losing a stance silently on a phone. */
function overCapacity(): StanceBarModel {
  const ids = ['s0', 's1', 's2', 's3', 's4', 's5'];
  return stanceBarView('warrior', ids, 's0');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stanceRadialView (touch render model)', () => {
  it('hides whenever the shared row model hides', () => {
    expect(stanceRadialView(model([], null)).visible).toBe(false);
    expect(stanceRadialView(stanceBarView('mage', ['battle_stance'], null)).visible).toBe(false);
  });

  it('wears the worn stance and puts every OTHER known stance on a direction', () => {
    const radial = stanceRadialView(model([...WARRIOR_STANCE_IDS], WARRIOR_STANCE_IDS[0]));
    expect(radial.visible).toBe(true);
    expect(radial.activeId).toBe(WARRIOR_STANCE_IDS[0]);
    expect(radial.anchorIconKey).toBe(WARRIOR_STANCE_IDS[0]);
    expect(radial.anchorActive).toBe(true);
    // The choice set is the ROW's minus the worn one: nothing the desktop bar
    // can reach may be unreachable here.
    expect(radial.petals.map((p) => p.id)).toEqual([...WARRIOR_STANCE_IDS].slice(1));
    expect(radial.petals.map((p) => p.direction)).toEqual(
      STANCE_PETAL_DIRECTIONS.slice(0, WARRIOR_STANCE_IDS.length - 1),
    );
    expect(radial.overflow).toEqual([]);
  });

  it('with nothing worn every known stance stays reachable and the anchor is not active', () => {
    // A paladin whose single devotion aura is down: if the worn stance were the
    // only thing the anchor could hold, the one stance it knows would have no
    // petal and the control would be a dead circle.
    const radial = stanceRadialView(stanceBarView('paladin', ['devotion_aura'], null));
    expect(radial.activeId).toBeNull();
    expect(radial.anchorActive).toBe(false);
    expect(radial.anchorIconKey).toBe('devotion_aura');
    expect(radial.petals.map((p) => p.id)).toEqual(['devotion_aura']);
  });

  it('the sig moves with the worn stance and with the choice set', () => {
    const a = stanceRadialView(model([...WARRIOR_STANCE_IDS], WARRIOR_STANCE_IDS[0]));
    const same = stanceRadialView(model([...WARRIOR_STANCE_IDS], WARRIOR_STANCE_IDS[0]));
    const worn = stanceRadialView(model([...WARRIOR_STANCE_IDS], WARRIOR_STANCE_IDS[1]));
    const fewer = stanceRadialView(
      model([...WARRIOR_STANCE_IDS].slice(0, 2), WARRIOR_STANCE_IDS[0]),
    );
    expect(a.sig).toBe(same.sig);
    expect(a.sig).not.toBe(worn.sig);
    expect(a.sig).not.toBe(fewer.sig);
  });

  it('resolves a direction back to its petal, and reports -1 for an empty one', () => {
    const radial = stanceRadialView(model([...WARRIOR_STANCE_IDS], WARRIOR_STANCE_IDS[0]));
    expect(stancePetalIndex(radial, STANCE_PETAL_DIRECTIONS[0])).toBe(0);
    expect(stancePetalIndex(radial, STANCE_PETAL_DIRECTIONS[1])).toBe(1);
    // Warriors know three stances, so the last two directions hold nothing and
    // must not resolve to a cast.
    expect(stancePetalIndex(radial, STANCE_PETAL_DIRECTIONS[2])).toBe(-1);
    expect(stancePetalIndex(radial, 'center')).toBe(-1);
  });
});

describe('stanceRadialView capacity guard', () => {
  it('seats exactly the four directions and reports the rest as overflow', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const radial = stanceRadialView(overCapacity());
    expect(STANCE_RADIAL_CAPACITY).toBe(4);
    expect(radial.petals).toHaveLength(STANCE_RADIAL_CAPACITY);
    expect(radial.petals.map((p) => p.direction)).toEqual([...STANCE_PETAL_DIRECTIONS]);
    // The stances past the capacity are REPORTED, never quietly dropped.
    expect(radial.overflow).toEqual(['s5']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('s5');
    expect(warn.mock.calls[0][0]).toContain('stance radial');
    // The overflow is part of the rebuild key, so a change in WHICH stance is
    // lost still repaints rather than being masked by an unchanged petal list.
    expect(radial.sig).toContain('s5');
  });

  it('stays silent at exactly the capacity', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const radial = stanceRadialView(stanceBarView('warrior', ['a', 'b', 'c', 'd', 'e'], 'a'));
    expect(radial.petals).toHaveLength(STANCE_RADIAL_CAPACITY);
    expect(radial.overflow).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
