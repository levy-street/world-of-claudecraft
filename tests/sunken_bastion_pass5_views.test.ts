// The Sunken Bastion fifth pass's presentation cores: the Iron Cage escape
// prompt's view (src/ui/hud/dungeon/cage_escape_view.ts) and the gaol and
// reaper visual plan (src/render/sunken_bastion/bastion_gaol_reaper_core.ts).
// Both read the sim's own constants, so what a player sees is what the sim
// resolves.

import { describe, expect, it } from 'vitest';
import {
  type NearbyInteractionHud,
  type NearbyInteractionWorld,
  tryNearbyInteraction,
} from '../src/game/nearby_interaction';
import {
  anchorHeat,
  CAGE_MARK_RADIUS,
  GRAVE_SHADOW_RADIUS,
  PIT_RIM_RADIUS,
  REAPER_SWEEP_ARC_DEG,
  REAPER_SWEEP_RANGE,
  REAPER_WARNING_SECONDS,
  reaperWarningFill,
  shackleLook,
  shackleRingRadius,
} from '../src/render/sunken_bastion/bastion_gaol_reaper_core';
import {
  OSSICK_TUNING,
  PIT_RIM,
  TURNKEY_CAGED,
  VAEL_TUNING,
} from '../src/sim/encounters/sunken_bastion/ids';
import { buildCageEscapeView } from '../src/ui/hud/dungeon/cage_escape_view';
import { t } from '../src/ui/i18n';

describe('the Iron Cage escape prompt view', () => {
  const cage =
    (hp: number, maxHp = 16) =>
    () => ({ hp, maxHp });

  it('hides while the player is not caged', () => {
    const v = buildCageEscapeView({
      auras: [{ id: 'bastion_anchored', sourceId: 5 }],
      cage: cage(16),
      interactKey: 'F',
      touch: false,
    });
    expect(v.visible).toBe(false);
  });

  it('reads the escape progress off the cage the Caged aura names', () => {
    const seen: number[] = [];
    const v = buildCageEscapeView({
      auras: [{ id: TURNKEY_CAGED, sourceId: 42 }],
      cage: (id) => {
        seen.push(id);
        return { hp: 4, maxHp: 16 };
      },
      interactKey: 'F',
      touch: false,
    });
    expect(seen).toEqual([42]);
    if (!v.visible) throw new Error('hidden');
    expect(v.progress).toBeCloseTo(0.75, 6);
  });

  it('names the interact key on a keyboard, a tap on touch, and neither when unbound', () => {
    const keyed = buildCageEscapeView({
      auras: [{ id: TURNKEY_CAGED, sourceId: 1 }],
      cage: cage(16),
      interactKey: 'F',
      touch: false,
    });
    const tapped = buildCageEscapeView({
      auras: [{ id: TURNKEY_CAGED, sourceId: 1 }],
      cage: cage(16),
      interactKey: 'F',
      touch: true,
    });
    const unbound = buildCageEscapeView({
      auras: [{ id: TURNKEY_CAGED, sourceId: 1 }],
      cage: cage(16),
      interactKey: '',
      touch: false,
    });
    if (!keyed.visible || !tapped.visible || !unbound.visible) throw new Error('hidden');
    expect(keyed.key).toBe('F');
    expect(keyed.prompt).toContain('F');
    expect(tapped.key).toBe('');
    expect(tapped.prompt).not.toBe(keyed.prompt);
    expect(unbound.key).toBe('');
    expect(unbound.prompt).not.toBe(keyed.prompt);
    expect(unbound.prompt).not.toBe(tapped.prompt);
  });

  it('tells each player the one control they actually have', () => {
    const view = (interactKey: string, touch: boolean) => {
      const v = buildCageEscapeView({
        auras: [{ id: TURNKEY_CAGED, sourceId: 1 }],
        cage: cage(16),
        interactKey,
        touch,
      });
      if (!v.visible) throw new Error('hidden');
      return v;
    };
    // A bound key on desktop: press that key.
    const keyed = view('E', false);
    expect(keyed.prompt).toBe(t('hudChrome.bastionCage.promptKey', { key: 'E' }));
    expect(keyed.prompt).toBe('Press E again and again to break free');
    // No interact key on desktop: there is nothing to press, so click the panel.
    const unbound = view('', false);
    expect(unbound.prompt).toBe(t('hudChrome.bastionCage.promptClick'));
    expect(unbound.prompt).toBe('Click here again and again to break free');
    expect(unbound.prompt).not.toContain('interact key');
    // Touch: tap the panel, whatever key a keyboard would have named.
    const tapped = view('E', true);
    expect(tapped.prompt).toBe(t('hudChrome.bastionCage.promptTap'));
    expect(tapped.prompt).toBe('Tap here again and again to break free');
    expect(view('', true).prompt).toBe(tapped.prompt);
  });

  it('a cage already gone reads as locked, never as free', () => {
    const v = buildCageEscapeView({
      auras: [{ id: TURNKEY_CAGED, sourceId: 9 }],
      cage: () => undefined,
      interactKey: 'F',
      touch: false,
    });
    if (!v.visible) throw new Error('hidden');
    expect(v.progress).toBe(0);
  });
});

describe('the gaol and reaper visual plan', () => {
  it('rings exactly the reaches the sim resolves', () => {
    expect(PIT_RIM_RADIUS).toBe(PIT_RIM);
    expect(REAPER_SWEEP_RANGE).toBe(VAEL_TUNING.sweepRange);
    expect(REAPER_SWEEP_ARC_DEG).toBe(VAEL_TUNING.sweepArcDeg);
    expect(GRAVE_SHADOW_RADIUS).toBe(VAEL_TUNING.graveRadius);
    expect(REAPER_WARNING_SECONDS).toBeCloseTo(
      VAEL_TUNING.poolSeconds + VAEL_TUNING.riseSeconds,
      6,
    );
    expect(shackleRingRadius(OSSICK_TUNING.shackleRange)).toBe(OSSICK_TUNING.shackleRange / 2);
    expect(shackleRingRadius(0)).toBe(OSSICK_TUNING.shackleRange / 2);
    expect(CAGE_MARK_RADIUS).toBeGreaterThan(1.5);
  });

  it('heats the anchor chain from cold at the bite to white hot at the rim', () => {
    expect(anchorHeat(20, 20)).toBe(0);
    expect(anchorHeat(PIT_RIM, 20)).toBe(1);
    expect(anchorHeat((20 + PIT_RIM) / 2, 20)).toBeCloseTo(0.5, 6);
    expect(anchorHeat(3, 3)).toBe(1);
  });

  it('hangs a slack shackle chain and bites only past its reach', () => {
    const slack = shackleLook(3, 8);
    const taut = shackleLook(9, 8);
    expect(slack.strained).toBe(false);
    expect(taut.strained).toBe(true);
    expect(slack.sag).toBeGreaterThan(taut.sag);
    expect(shackleLook(8, 8).strained).toBe(false);
  });

  it('fills the sweep across the whole warning, clamped', () => {
    expect(reaperWarningFill(0)).toBe(0);
    expect(reaperWarningFill(REAPER_WARNING_SECONDS / 2)).toBeCloseTo(0.5, 6);
    expect(reaperWarningFill(99)).toBe(1);
    expect(reaperWarningFill(-1)).toBe(0);
  });
});

describe('the interact key while caged', () => {
  it('sends the escape press straight to the world, never a scan of the room', () => {
    let presses = 0;
    let scanned = false;
    const world = {
      player: { auras: [{ id: TURNKEY_CAGED, sourceId: 7 }] },
      interact: () => {
        presses++;
      },
      get entities() {
        scanned = true;
        return new Map();
      },
    } as unknown as NearbyInteractionWorld;
    const hud = { showError: () => {} } as unknown as NearbyInteractionHud;
    expect(tryNearbyInteraction(world, hud, 'away', 'nothing')).toBe(true);
    expect(tryNearbyInteraction(world, hud, 'away', 'nothing')).toBe(true);
    expect(presses).toBe(2);
    expect(scanned).toBe(false);
  });
});
