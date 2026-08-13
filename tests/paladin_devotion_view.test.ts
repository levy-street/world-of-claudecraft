import { describe, expect, it } from 'vitest';
import { createPaladinDevotionView } from '../src/ui/paladin_devotion_view';
import { assertAllocationStable } from './util/alloc_probe';

describe('paladin Devotion HUD view', () => {
  it('shows generation, readiness, and the five-charge Ascension state', () => {
    const view = createPaladinDevotionView(
      String,
      (value, max, charges, last) => `${value}/${max}:${last ? 'last' : charges}`,
      'Final charge',
    );
    const player = {
      templateId: 'paladin',
      paladinDevotion: {
        value: 7,
        ascensionCharges: 0,
        ascensionRemaining: 0,
        outOfCombatTime: 0,
        decayProgress: 0,
        blockIcdRemaining: 0,
      },
    };

    expect(view.tick(player)).toMatchObject({
      visible: true,
      value: 7,
      fillFrac: 0.35,
      ready: false,
      ascended: false,
      charges: 0,
      lastCharge: false,
      label: '7 / 20',
      ariaValueText: '7/20:0',
      announcement: '',
    });

    player.paladinDevotion.value = 20;
    expect(view.tick(player).ready).toBe(true);

    player.paladinDevotion.value = 4;
    player.paladinDevotion.ascensionCharges = 3;
    player.paladinDevotion.ascensionRemaining = 18;
    expect(view.tick(player)).toMatchObject({
      ready: false,
      ascended: true,
      charges: 3,
      lastCharge: false,
      label: '4 / 20',
      ariaValueText: '4/20:3',
    });

    player.paladinDevotion.ascensionCharges = 1;
    expect(view.tick(player)).toMatchObject({
      lastCharge: true,
      ariaValueText: '4/20:last',
      announcement: 'Final charge',
    });
  });

  it('hides for other classes and reuses its output object', () => {
    const view = createPaladinDevotionView(String, () => '', '');
    const warrior = { templateId: 'warrior', paladinDevotion: undefined };
    expect(view.tick(warrior).visible).toBe(false);
    assertAllocationStable(() => view.tick(warrior));
  });
});
