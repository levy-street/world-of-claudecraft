// The Moonwing Tidewheel HUD view (src/ui/hud/druid/tide_orbs_view.ts): the
// pure state the orbs painter and the screen-edge glow read. Pinned here
// because the gem and the glow paint in the color of the spell the open window
// FAVORS (the other school), which is easy to flip by accident: Sunrise favors
// Skyfall (moon), Moonrise favors Wildbolt (sun). Each bank holds 5 points and
// reads ready (peek, ready glow) from 3, the payoffs' threshold.
import { describe, expect, it } from 'vitest';
import {
  MOONRISE_ID,
  SUNRISE_ID,
  SUNTIDE_STAGES,
  TIDE_PAYOFF_MIN_STACKS,
  TIDEWHEEL_WINDOW_SECONDS,
} from '../src/sim/combat/druid_tidewheel';
import type { Aura } from '../src/sim/types';
import {
  createTideOrbsView,
  TIDE_BANK_MAX,
  TIDE_EDGE_FADE_SECONDS,
  type TideOrbsPlayer,
  tidePlace,
  tideTopBank,
} from '../src/ui/hud/druid/tide_orbs_view';

const PLAYER_ID = 7;

function aura(id: string, kind: Aura['kind'], extra: Partial<Aura> = {}): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: PLAYER_ID,
    school: 'nature',
    ...extra,
  };
}

function windowAura(id: typeof SUNRISE_ID | typeof MOONRISE_ID, remaining: number): Aura {
  return aura(id, 'internal_cd', { remaining, duration: TIDEWHEEL_WINDOW_SECONDS });
}

function druid(...auras: Aura[]): TideOrbsPlayer {
  return { id: PLAYER_ID, templateId: 'druid', auras };
}

function view() {
  return createTideOrbsView({
    sunStatus: (value, max) => `${value}/${max} sun`,
    moonStatus: (value, max) => `${value}/${max} moon`,
    windowStatus: (window) => `window ${window}`,
  });
}

const FORM = aura('form_moonkin', 'form_moonkin');

describe('tide orbs view: the favored spell and the edge glow', () => {
  it('points next at the OTHER school: Sunrise favors Skyfall (moon), Moonrise Wildbolt (sun)', () => {
    const v = view();
    const sunrise = v.tick(druid(FORM, windowAura(SUNRISE_ID, 6)), 'balance');
    expect(sunrise.window).toBe('sun');
    expect(sunrise.next).toBe('moon');
    const moonrise = v.tick(druid(FORM, windowAura(MOONRISE_ID, 6)), 'balance');
    expect(moonrise.window).toBe('moon');
    expect(moonrise.next).toBe('sun');
    const closed = v.tick(druid(FORM), 'balance');
    expect(closed.window).toBe('none');
    expect(closed.next).toBe('none');
  });

  it('holds the edge at full strength, then fades it over the last 2 sec', () => {
    expect(TIDE_EDGE_FADE_SECONDS).toBe(2);
    const v = view();
    const strength = (remaining: number) =>
      v.tick(druid(FORM, windowAura(SUNRISE_ID, remaining)), 'balance').edgeStrength;
    expect(strength(TIDEWHEEL_WINDOW_SECONDS)).toBe(1);
    expect(strength(TIDE_EDGE_FADE_SECONDS)).toBe(1);
    // min(1, remaining / 2): halfway through the fade, and gone at the close.
    expect(strength(1)).toBeCloseTo(0.5, 10);
    expect(strength(0.5)).toBeCloseTo(0.25, 10);
    expect(strength(0)).toBe(0);
    // No window, no glow.
    expect(v.tick(druid(FORM), 'balance').edgeStrength).toBe(0);
  });

  it('shows nothing outside Moonwing Form or off Moongrove, window or not', () => {
    const v = view();
    const unformed = v.tick(druid(windowAura(MOONRISE_ID, 6)), 'balance');
    expect(unformed.visible).toBe(false);
    expect(unformed.next).toBe('none');
    expect(unformed.edgeStrength).toBe(0);
    const feral = v.tick(druid(FORM, windowAura(MOONRISE_ID, 6)), 'feral');
    expect(feral.visible).toBe(false);
    expect(feral.next).toBe('none');
    expect(feral.edgeStrength).toBe(0);
  });

  it("ignores another druid's window marker", () => {
    const v = view();
    const foreign = { ...windowAura(SUNRISE_ID, 6), sourceId: PLAYER_ID + 1 };
    const state = v.tick(druid(FORM, foreign), 'balance');
    expect(state.visible).toBe(true);
    expect(state.next).toBe('none');
    expect(state.edgeStrength).toBe(0);
  });
});

describe('tide orbs view: Eclipse placement (always horizontal)', () => {
  const bank = (kind: 'suntide' | 'moontide', stacks: number) => aura(kind, kind, { stacks });

  it('Sunrise charges the Moon: Moon full size on top, Sun small below', () => {
    const state = view().tick(
      druid(FORM, windowAura(SUNRISE_ID, 6), bank('suntide', 4), bank('moontide', 1)),
      'balance',
    );
    expect(state.top).toBe('moon');
    expect(state.moonPlace).toBe('top');
    expect(state.sunPlace).toBe('below');
  });

  it('Moonrise charges the Sun: Sun full size on top, Moon small below', () => {
    const state = view().tick(
      druid(FORM, windowAura(MOONRISE_ID, 6), bank('suntide', 1), bank('moontide', 4)),
      'balance',
    );
    expect(state.top).toBe('sun');
    expect(state.sunPlace).toBe('top');
    expect(state.moonPlace).toBe('below');
  });

  it('before any window, puts the fuller bank on top (Sun on a tie)', () => {
    const fuller = (sun: number, moon: number) =>
      view().tick(druid(FORM, bank('suntide', sun), bank('moontide', moon)), 'balance').top;
    expect(fuller(0, 0)).toBe('sun');
    expect(fuller(2, 2)).toBe('sun');
    expect(fuller(3, 1)).toBe('sun');
    expect(fuller(1, 2)).toBe('moon');
  });

  it('keeps the last charged bank on top after its window ends', () => {
    const v = view();
    // Sunrise charges the Moon; then the window runs out while the Sun bank
    // is fuller: the Moon stays on top instead of jumping.
    expect(v.tick(druid(FORM, windowAura(SUNRISE_ID, 6), bank('moontide', 2)), 'balance').top).toBe(
      'moon',
    );
    const after = v.tick(druid(FORM, bank('suntide', 4), bank('moontide', 2)), 'balance');
    expect(after.top).toBe('moon');
    expect(after.sunPlace).toBe('below');
    // Leaving the form forgets it: back to the fuller-bank rule.
    v.tick(druid(bank('suntide', 4), bank('moontide', 2)), 'balance');
    expect(v.tick(druid(FORM, bank('suntide', 4), bank('moontide', 2)), 'balance').top).toBe('sun');
  });

  it('places by the top bank alone, whatever the counts', () => {
    expect(tidePlace('moon', 'moon')).toBe('top');
    expect(tidePlace('sun', 'moon')).toBe('below');
    expect(tidePlace('sun', 'sun')).toBe('top');
    expect(tideTopBank('moon', 'sun', 5, 0)).toBe('moon');
    expect(tideTopBank('none', 'moon', 5, 0)).toBe('moon');
    expect(tideTopBank('none', null, 0, TIDE_BANK_MAX)).toBe('moon');
  });

  it('flags a capped bank for the strong edge flash, per bank', () => {
    const state = view().tick(
      druid(FORM, bank('suntide', TIDE_BANK_MAX), bank('moontide', TIDE_BANK_MAX - 1)),
      'balance',
    );
    expect(state.sunMax).toBe(true);
    expect(state.moonMax).toBe(false);
    expect(state.moonReady).toBe(true);
  });
});

describe('tide orbs view: 5-point banks, ready from 3', () => {
  const bank = (kind: 'suntide' | 'moontide', stacks: number) => aura(kind, kind, { stacks });

  it('sizes both banks at 5 and reports that max in the status lines', () => {
    expect(TIDE_BANK_MAX).toBe(SUNTIDE_STAGES);
    expect(TIDE_BANK_MAX).toBe(5);
    const state = view().tick(druid(FORM, bank('suntide', 4), bank('moontide', 2)), 'balance');
    expect(state.suntide).toBe(4);
    expect(state.moontide).toBe(2);
    expect(state.sunStatus).toBe('4/5 sun');
    expect(state.moonStatus).toBe('2/5 moon');
  });

  it('flags a bank ready from 3 points, per bank', () => {
    const v = view();
    for (const [sun, moon] of [
      [0, 0],
      [2, 3],
      [3, 2],
      [4, 5],
      [5, 4],
    ] as const) {
      const state = v.tick(druid(FORM, bank('suntide', sun), bank('moontide', moon)), 'balance');
      expect(state.sunReady, `sun ${sun}`).toBe(sun >= TIDE_PAYOFF_MIN_STACKS);
      expect(state.moonReady, `moon ${moon}`).toBe(moon >= TIDE_PAYOFF_MIN_STACKS);
    }
  });

  it('is never ready outside Moonwing Form, even with banked points', () => {
    const state = view().tick(druid(bank('suntide', 5), bank('moontide', 5)), 'balance');
    expect(state.sunReady).toBe(false);
    expect(state.moonReady).toBe(false);
  });
});
