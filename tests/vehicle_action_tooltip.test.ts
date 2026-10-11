import { expect, it } from 'vitest';
import { CANNON_ACTIONS, CANNON_WAVES } from '../src/sim/content/cannon_encounter';
import {
  createCannonEncounter,
  fireCannon,
  tickCannonEncounter,
} from '../src/sim/minigames/cannon_encounter';
import { TICK_RATE } from '../src/sim/types';
import {
  vehicleActionDescription,
  vehicleActionTooltip,
} from '../src/ui/hud/vehicle/vehicle_action_tooltip';

it.each(['cannonball', 'grapeshot', 'incendiary'] as const)(
  'describes %s using the actual impact and periodic damage',
  (action) => {
    const state = createCannonEncounter();
    state.phase = 'wave';
    state.spawnCursor = CANNON_WAVES[0].length;
    state.enemies = [{ id: 999, kind: 'commander', hp: 800, x: 50, z: 50, slowUntilTick: 0 }];
    const field = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
    expect(fireCannon(state, field, action, { x: 50, z: 50 })).toBe(true);
    const def = CANNON_ACTIONS[action];
    for (let tick = 0; tick < def.flightTicks; tick++) tickCannonEncounter(state, field);
    expect(800 - state.enemies[0].hp).toBe(def.damage);
    const text = vehicleActionDescription(action);
    expect(text).toContain(`Deal ${def.damage} damage`);
    expect(text).toContain(`within ${def.radius} yards`);
    expect(text).toContain(`Cooldown: ${def.cooldownTicks / TICK_RATE} sec`);
    expect(text).toContain('Impact after 0.8 sec');
    expect(text).toContain('No mana cost');
    expect(text).toContain('50% less damage');
    expect(text).toContain('100% more fire damage');
    expect(text).toContain('180 damage within 8 yards');
    expect(text).toContain('does not scale with gear or talents');
    if (action === 'grapeshot') {
      expect(text).toContain('50% for 3 sec');
      expect(state.enemies[0].slowUntilTick - state.tick).toBe(3 * TICK_RATE);
    }
    if (action === 'incendiary') {
      expect(text).toContain('fire for 5 sec, dealing 30 damage each second');
      for (let tick = 0; tick < def.burnTicks; tick++) tickCannonEncounter(state, field);
      expect(800 - state.enemies[0].hp).toBe(180);
      expect(state.fires).toEqual([]);
    }
    expect(vehicleActionTooltip(action)).toContain('tt-title');
    expect(vehicleActionTooltip(action)).toContain('<br>');
  },
);
