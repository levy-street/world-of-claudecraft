import { expect, it } from 'vitest';
import { applyGliderBoost } from '../src/sim/minigames/glider_boost';
import { createGliderFlightState } from '../src/sim/minigames/glider_flight';
import {
  createGliderActionBarView,
  gliderBoostDescription,
} from '../src/ui/hud/vehicle/glider_action_bar_view';

it('reuses its slots and describes the live flat boost, cap and cooldown', () => {
  const glider = createGliderFlightState(false);
  glider.speed = 10;
  const view = createGliderActionBarView();
  const keyLabel = (slot: number) => String(slot + 1);
  const before = view.tick(glider, keyLabel);
  const slot = before.slots[0];
  expect(slot.usable).toBe(true);
  // Slots 1 and 2 are the held Climb and Dive controls, usable only in flight.
  expect(before.slots.map((s) => s.abilityId)).toEqual([
    'glider_boost',
    'glider_climb',
    'glider_dive',
  ]);
  expect(before.slots.map((s) => s.keybindLabel)).toEqual(['1', '2', '3']);
  expect(before.slots[1].usable).toBe(true);
  expect(before.slots[1].ariaLabel).toBe('Climb');
  expect(before.slots[2].ariaLabel).toBe('Dive');
  expect(applyGliderBoost(glider)).toBe(true);
  expect(glider.speed).toBe(24);
  const after = view.tick(glider, keyLabel);
  expect(after).toBe(before);
  expect(after.slots[0]).toBe(slot);
  glider.phase = 'won';
  expect(view.tick(glider, keyLabel).slots[2].usable).toBe(false);
  glider.phase = 'flying';
  expect(slot.cooldownRemaining).toBe(10);
  expect(slot.usable).toBe(false);
  expect(gliderBoostDescription()).toBe(
    'Increase your flight speed by 14 yd/s, up to 38 yd/s. Available while flying. Recharges in 10 seconds.',
  );
  glider.tick += 200;
  glider.speed = 35;
  applyGliderBoost(glider);
  expect(glider.speed).toBe(38);
});
