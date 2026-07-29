import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { SimEvent } from '../src/sim/types';
import {
  healLandingFloatTextKey,
  healLandingLogKey,
  shouldFloatHealLanding,
  shouldShowHealLanding,
} from '../src/ui/heal_landing_feedback_core';

type Heal2Event = Extract<SimEvent, { type: 'heal2' }>;

function heal2(overrides: Partial<Heal2Event>): Heal2Event {
  return {
    type: 'heal2',
    sourceId: 1,
    targetId: 2,
    amount: 25,
    crit: false,
    ability: 'Lesser Heal',
    ...overrides,
  };
}

function onlineDrain(events: SimEvent[]): SimEvent[] {
  const client = Object.create(ClientWorld.prototype) as {
    eventQueue: SimEvent[];
    drainEvents(): SimEvent[];
  };
  client.eventQueue = [...events];
  return client.drainEvents();
}

describe('heal landing feedback', () => {
  it('shows ordinary positive healing exactly as before', () => {
    expect(shouldShowHealLanding(heal2({ amount: 25 }))).toBe(true);
    expect(shouldFloatHealLanding(heal2({ amount: 25 }))).toBe(true);
    expect(healLandingLogKey(heal2({ amount: 25, crit: false }), true)).toBe('hud.combat.healSelf');
  });

  it('floats direct zero-effective healing as a non-numeric full-health cue', () => {
    const ev = heal2({ sourceId: 1, targetId: 1, amount: 0 });

    expect(shouldShowHealLanding(ev)).toBe(true);
    expect(shouldFloatHealLanding(ev)).toBe(true);
    expect(healLandingFloatTextKey(ev)).toBe('hud.combat.floatingHealFull');
    expect(healLandingLogKey(ev, true)).toBe('hud.combat.healSelfFull');
  });

  it('keeps cue-only HoT application events hidden from FCT and the combat log', () => {
    const ev = heal2({ amount: 0, cueOnly: true });

    expect(shouldShowHealLanding(ev)).toBe(false);
    expect(shouldFloatHealLanding(ev)).toBe(false);
    expect(healLandingFloatTextKey(ev)).toBe(null);
    expect(healLandingLogKey(ev, true)).toBe(null);
  });

  it('does not create zero-float spam for HoT ticks', () => {
    const ev = heal2({ amount: 0, hot: true });

    expect(shouldShowHealLanding(ev)).toBe(false);
    expect(shouldFloatHealLanding(ev)).toBe(false);
    expect(healLandingFloatTextKey(ev)).toBe(null);
    expect(healLandingLogKey(ev, true)).toBe(null);
  });

  it('reads a fully absorbed heal as absorbed, never as "already at full health"', () => {
    // The two ways amount reaches 0 need OPPOSITE messages. consumeHealAbsorb
    // (src/sim/combat/heal.ts) can zero a heal on a target nowhere near full: a
    // mob with a healAbsorb template brands the victim with a necrotic blight, so
    // a priest healing a blighted ally at 30 percent HP gets amount 0 back. Telling
    // that healer they are "already at full health" is exactly backwards.
    const absorbed = heal2({ amount: 0, absorbed: 240 });

    expect(shouldShowHealLanding(absorbed)).toBe(true);
    expect(shouldFloatHealLanding(absorbed)).toBe(true);
    expect(healLandingFloatTextKey(absorbed)).toBe('hud.combat.floatingHealAbsorbed');
    expect(healLandingLogKey(absorbed, true)).toBe('hud.combat.healSelfAbsorbed');
    expect(healLandingLogKey(absorbed, false)).toBe('hud.combat.healOtherAbsorbed');

    // The genuine full-health case is untouched: no absorb on the event.
    const full = heal2({ amount: 0 });
    expect(healLandingFloatTextKey(full)).toBe('hud.combat.floatingHealFull');
    expect(healLandingLogKey(full, true)).toBe('hud.combat.healSelfFull');
    expect(healLandingLogKey(full, false)).toBe('hud.combat.healOtherFull');
  });

  it('a PARTIALLY absorbed heal still reads as a normal heal, not an absorb', () => {
    // absorbed > 0 alone must not hijack the message: the shield ate some but the
    // target still gained HP, which is an ordinary heal from the healer's side.
    const partial = heal2({ amount: 130, absorbed: 70 });

    expect(healLandingFloatTextKey(partial)).toBe(null);
    expect(healLandingLogKey(partial, true)).toBe('hud.combat.healSelf');
    expect(healLandingLogKey(partial, false)).toBe('hud.combat.healOther');
  });

  it('keeps online-delivered zero-effective direct heals visible to the HUD feedback path', () => {
    const [ev] = onlineDrain([heal2({ sourceId: 7, targetId: 7, amount: 0 })]) as Heal2Event[];

    expect(ev).toMatchObject({ type: 'heal2', sourceId: 7, targetId: 7, amount: 0 });
    expect(shouldShowHealLanding(ev)).toBe(true);
    expect(shouldFloatHealLanding(ev)).toBe(true);
    expect(healLandingFloatTextKey(ev)).toBe('hud.combat.floatingHealFull');
    expect(healLandingLogKey(ev, true)).toBe('hud.combat.healSelfFull');
  });
});
