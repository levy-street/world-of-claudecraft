// Hester's toys on the client: the render plan (src/render/seasonal_toys_fx_core.ts), the
// prank's head on the pumpkin-head path (seasonal_head_core.ts), and the player-facing
// words (the tooltip lines and the log lines, src/ui/seasonal_item_tooltip.ts and
// seasonal_event_view.ts) stated from the live toy table.
import { describe, expect, it } from 'vitest';
import { drawsSeasonalHead, wearsSeasonalHead } from '../src/render/characters/seasonal_head_core';
import {
  BAT_COUNT,
  BREW_FIZZ_SEC,
  batFlight,
  brewGlow,
  CANDLE_SHADOW_FIGURES,
  CAULDRON_BUBBLES,
  candleGlowColumn,
  candleLightPool,
  candleMist,
  candleShadows,
  cauldronBubble,
  ghostOrbit,
  HALO_PRANK_RESERVE,
  haloSlotFree,
  lookFade,
  PRANK_AURA_ID,
  PRANK_CAP,
  PRANK_FLIGHT_SEC,
  prankArc,
  toyEffectOf,
  toyLooksOf,
  wearsPrankHead,
} from '../src/render/seasonal_toys_fx_core';
import { GOURDLIGHT_TOYS } from '../src/sim/content/gourdlight_eve';
import { toyAura } from '../src/sim/seasonal';
import { seasonalEventPresentation } from '../src/ui/seasonal_event_view';
import { seasonalItemTooltipText } from '../src/ui/seasonal_item_tooltip';

const prank = GOURDLIGHT_TOYS.find((t) => t.effect === 'prank')!;
const lantern = GOURDLIGHT_TOYS.find((t) => t.effect === 'lantern')!;

describe('the toys render plan', () => {
  it('reads each toy look off its aura, the lantern with its spot', () => {
    for (const toy of GOURDLIGHT_TOYS) expect(toyEffectOf(toy.auraId)).toBe(toy.effect);
    expect(toyEffectOf('gourdlight_pumpkin_head')).toBeNull();
    const aura = { ...toyAura(lantern, 7, { x: 3, z: -4 }), remaining: 50 };
    const [look] = toyLooksOf([aura, { id: 'x', kind: 'buff_str' }]);
    expect(look).toMatchObject({
      effect: 'lantern',
      elapsed: 10,
      remaining: 50,
      spotX: 3,
      spotZ: -4,
    });
  });

  it('the pranked head appears only once the thrown pumpkin has landed', () => {
    const head = (elapsed: number) => [
      { id: PRANK_AURA_ID, kind: 'seasonal_cosmetic', duration: 30, remaining: 30 - elapsed },
    ];
    expect(wearsPrankHead(head(0))).toBe(false);
    expect(wearsPrankHead(head(PRANK_FLIGHT_SEC - 0.01))).toBe(false);
    expect(wearsPrankHead(head(PRANK_FLIGHT_SEC))).toBe(true);
    expect(wearsSeasonalHead(head(1))).toBe(true);
    // the same fairness rule as the worn head: never on a stealthed body
    expect(drawsSeasonalHead({ kind: 'player', stealthed: true, auras: head(1) })).toBe(false);
    expect(drawsSeasonalHead({ kind: 'player', stealthed: false, auras: head(1) })).toBe(true);
    expect(PRANK_AURA_ID).toBe(prank.auraId);
  });

  it('lobs the pumpkin from the hand to the head over an arc', () => {
    const from = { x: 0, y: 1.5, z: 0 };
    const to = { x: 10, y: 1.8, z: 0 };
    expect(prankArc(from, to, 0)).toMatchObject({ x: 0, y: 1.5 });
    expect(prankArc(from, to, 1)).toMatchObject({ x: 10, y: 1.8 });
    expect(prankArc(from, to, 0.5).y).toBeGreaterThan(1.65 + 2);
  });

  it('circles the ghost at shoulder height, close to its keeper', () => {
    for (let t = 0; t < 60; t += 0.7) {
      const o = ghostOrbit(t);
      const r = Math.hypot(o.x, o.z);
      expect(r).toBeGreaterThan(1.1);
      expect(r).toBeLessThan(1.6);
      expect(o.y).toBeGreaterThan(1.2);
      expect(o.y).toBeLessThan(1.9);
    }
  });

  it('bursts the bats up out of the sack and scatters every one away by the end', () => {
    const life = 6;
    let near = 0;
    for (let i = 0; i < BAT_COUNT; i++) {
      const early = batFlight(i, 0.5, life);
      if (early && Math.hypot(early.x, early.z) < 2) near++;
      const late = batFlight(i, life - 0.05, life);
      if (late) {
        expect(Math.hypot(late.x, late.z)).toBeGreaterThan(5);
        expect(late.alpha).toBeLessThan(0.2);
      }
      expect(batFlight(i, life + 0.1, life)).toBeNull();
    }
    expect(near).toBeGreaterThan(BAT_COUNT / 2);
  });

  it('spreads the candle mist out and thins it away, and fades every look in and out', () => {
    expect(candleMist(0, 30).strength).toBe(0);
    expect(candleMist(2, 28).strength).toBe(1);
    expect(candleMist(29, 1).strength).toBeLessThan(0.5);
    expect(candleMist(10, 20).radius).toBeGreaterThan(candleMist(0.5, 29.5).radius);
    expect(lookFade(0, 10)).toBe(0);
    expect(lookFade(5, 5)).toBe(1);
    expect(lookFade(5, 0)).toBe(0);
  });

  it('throws a cat, a bat and a witch out from the candle, dancing with its flicker', () => {
    expect(CANDLE_SHADOW_FIGURES).toEqual(['cat', 'bat', 'witch']);
    // nothing at the strike: the shadows stand up as the flames catch
    for (const f of candleShadows(0, 0, 1, 1)) expect(f.alpha).toBe(0);
    const lit = candleShadows(5, 0.4, 0.92, 1);
    expect(lit.map((f) => f.figure)).toEqual(['cat', 'bat', 'witch']);
    for (const f of lit) {
      // dark enough to read on sunlit grass, cast AWAY from the flame (the foot nearest it)
      expect(f.alpha, f.figure).toBeGreaterThan(0.6);
      expect(f.foot, f.figure).toBeGreaterThan(0.3);
      expect(f.length, f.figure).toBeGreaterThan(1.2);
    }
    // spread round the dish, never piled on one side
    const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(gap(lit[0].bearing, lit[1].bearing)).toBeGreaterThan(1);
    expect(gap(lit[1].bearing, lit[2].bearing)).toBeGreaterThan(1);
    // a jumping flame throws longer shadows than a guttering one
    const tall = candleShadows(5, 0.4, 1.15, 1);
    const low = candleShadows(5, 0.4, 0.7, 1);
    for (let i = 0; i < 3; i++) expect(tall[i].length).toBeGreaterThan(low[i].length);
    // and they move: a second later every shadow has turned round the dish
    const later = candleShadows(6, 0.4, 0.92, 1);
    for (let i = 0; i < 3; i++) expect(later[i].bearing).not.toBeCloseTo(lit[i].bearing, 2);
    // the look's fade takes them with it
    for (const f of candleShadows(5, 0.4, 0.92, 0)) expect(f.alpha).toBe(0);
    // they dance in a pool of candlelight that follows the mist's grow and fade
    expect(candleLightPool(0, 30, 1).strength).toBe(0);
    expect(candleLightPool(5, 25, 0.92).strength).toBeGreaterThan(0.9);
    expect(candleLightPool(5, 25, 0.92).radius).toBeGreaterThan(3);
    expect(candleLightPool(30, 0, 1).strength).toBe(0);
  });

  it('bubbles the cauldron and pulses a drinker green', () => {
    expect(CAULDRON_BUBBLES).toBeGreaterThanOrEqual(5);
    let popped = 0;
    for (let i = 0; i < CAULDRON_BUBBLES; i++) {
      for (let t = 0; t < 4; t += 0.05) {
        const b = cauldronBubble(i, t);
        // always on the brew's surface, inside the rim
        expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(0.8);
        expect(b.size).toBeGreaterThanOrEqual(0);
        expect(b.size).toBeLessThanOrEqual(1);
        if (b.pop > 0) popped++;
      }
    }
    expect(popped).toBeGreaterThan(0);
    // pure: the same bubble at the same time is the same on every client
    expect(cauldronBubble(3, 1.7)).toEqual(cauldronBubble(3, 1.7));
    // the drink's fizz floods in at the gulp, holds while the body changes, and is gone by
    // BREW_FIZZ_SEC: the goblin keeps its own colours for the rest of the look (round 11)
    expect(brewGlow(0, 0)).toBe(0);
    expect(brewGlow(0.5, 1)).toBeGreaterThan(0.1);
    expect(brewGlow(BREW_FIZZ_SEC - 0.6, 1)).toBeLessThan(brewGlow(0.5, 1));
    // never a full flood: the drinker stays readable under the green
    for (let t = 0; t < 3; t += 0.01) expect(brewGlow(0.6, t)).toBeLessThan(0.3);
    expect(brewGlow(BREW_FIZZ_SEC, 1)).toBe(0);
    expect(brewGlow(30, 1)).toBe(0);
    expect(BREW_FIZZ_SEC).toBeLessThan(5);
  });
});

describe('the toys in words', () => {
  it('every toy has its own tooltip line, stated from the live numbers', () => {
    for (const toy of GOURDLIGHT_TOYS) {
      const text = seasonalItemTooltipText({ id: toy.itemId }) ?? '';
      expect(text.startsWith('Use:'), toy.itemId).toBe(true);
      expect(text, toy.itemId).toContain(`${toy.cooldown} seconds`);
      if (toy.effect !== 'bats') expect(text, toy.itemId).toContain(`${toy.duration} seconds`);
      expect(text, toy.itemId).toContain('Cosmetic.');
      expect(text, toy.itemId).toContain('combat');
    }
    expect(seasonalItemTooltipText({ id: prank.itemId })).toContain(`${prank.range} yards`);
  });

  it('every toy, the prank landing and the refusals have a log line', () => {
    for (const toy of GOURDLIGHT_TOYS) {
      const p = seasonalEventPresentation({
        type: 'seasonal',
        what: 'toy',
        trick: toy.itemId,
        who: 'Pip',
      });
      expect(p?.logText, toy.itemId).toBeTruthy();
    }
    expect(
      seasonalEventPresentation({ type: 'seasonal', what: 'toy', trick: prank.itemId, who: 'Pip' })
        ?.logText,
    ).toContain('Pip');
    const hit = seasonalEventPresentation({ type: 'seasonal', what: 'pranked', who: 'Ada' });
    expect(hit?.logText).toContain('Ada');
    expect(hit?.flashText).toContain('Ada');
    for (const what of ['prankNeedsPlayer', 'toyHidden'] as const)
      expect(seasonalEventPresentation({ type: 'seasonal', what })?.logText, what).toBeTruthy();
  });

  it('keeps the candle readable over tall grass and in daylight', () => {
    // the candle's column follows the mist: dark at the strike, full when spread, gone out
    expect(candleGlowColumn(0, 30).opacity).toBe(0);
    expect(candleGlowColumn(0, 30).wispRate).toBe(0);
    const lit = candleGlowColumn(5, 25);
    expect(lit.opacity).toBeCloseTo(0.16);
    expect(lit.wispRate).toBe(6);
    expect(lit.height).toBeCloseTo(0.8);
    expect(candleGlowColumn(30, 0).opacity).toBe(0);
  });

  it('never lets an accent glow take the halo slots the pumpkin pranks ask for last', () => {
    const size = 24;
    expect(HALO_PRANK_RESERVE).toBe(PRANK_CAP * 2);
    // a full town square of candles and cauldrons: accents stop at the reserve...
    expect(haloSlotFree(size - HALO_PRANK_RESERVE - 1, size, true)).toBe(true);
    expect(haloSlotFree(size - HALO_PRANK_RESERVE, size, true)).toBe(false);
    // ...while every prank flight and splat still finds a slot behind them
    expect(haloSlotFree(size - HALO_PRANK_RESERVE, size, false)).toBe(true);
    expect(haloSlotFree(size - 1, size, false)).toBe(true);
    expect(haloSlotFree(size, size, false)).toBe(false);
  });
});
