import { describe, expect, it } from 'vitest';
import { advanceDeckFrame, deckFrameFor } from '../src/render/deck_frame';
import { SHIP_SHADOW_REACH, shipShadowHold } from '../src/render/ship_shadow_hold';
import { EASTBROOK_NIGHTBLOOM_FERRY } from '../src/sim/content/transport_ships';
import { emptyTransportFerryView, transportFerryViewAt } from '../src/sim/transport_schedule';
import { WATER_LEVEL } from '../src/sim/world';

// The sun's shadow map keeps full rate while a ship under way is close by
// (src/render/ship_shadow_hold.ts, fed to shadow_cadence_core.ts as its hold).
// Under the half-rate shed the map is redrawn every other frame, so a moving
// ship's own shadows (rigging and masts across the sails and deck) sat a frame
// behind the hull on alternate frames and snapped back on the next: the
// flicker at sea. The hold is narrow on purpose: a bystander far off keeps the
// shed the governor chose.

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const DOCKED = ROUTE.timings.docked / 2;
const SAILING = ROUTE.timings.docked + 40;

function world(clock: number) {
  const view = emptyTransportFerryView(ROUTE);
  return {
    clock,
    ferryView: () => transportFerryViewAt(ROUTE, clock, WATER_LEVEL, true, view),
  };
}

/** A key light aimed at (x, z): the player it follows. */
function light(x: number, z: number) {
  return { target: { position: { x, z } } };
}

function drawnShip(clock: number) {
  const w = world(clock);
  const df = deckFrameFor(w);
  advanceDeckFrame(df, w, 1 / 60);
  return { w, df, ship: df.ships[0].drawn };
}

describe('the shadow map holds full rate around a ship under way', () => {
  it('holds while a sailing ship is close to the player', () => {
    const { w, ship } = drawnShip(SAILING);
    expect(shipShadowHold(w, light(ship.x, ship.z))).toBe(true);
    expect(shipShadowHold(w, light(ship.x + SHIP_SHADOW_REACH - 1, ship.z))).toBe(true);
  });

  it('lets the shed run for a bystander well away from it', () => {
    const { w, ship } = drawnShip(SAILING);
    const far = SHIP_SHADOW_REACH + 1;
    expect(shipShadowHold(w, light(ship.x + far, ship.z))).toBe(false);
    expect(shipShadowHold(w, light(ship.x, ship.z - far))).toBe(false);
  });

  it('always holds for the local passenger of a ship under way', () => {
    const { w, df, ship } = drawnShip(SAILING);
    df.selfRoute = 0;
    // the light's target is wherever: the passenger rides this very ship
    expect(shipShadowHold(w, light(ship.x + 500, ship.z))).toBe(true);
  });

  it('never holds for a moored ship: nothing moves, so nothing flickers', () => {
    const { w, df, ship } = drawnShip(DOCKED);
    expect(shipShadowHold(w, light(ship.x, ship.z))).toBe(false);
    df.selfRoute = 0;
    expect(shipShadowHold(w, light(ship.x, ship.z))).toBe(false);
  });

  it('never holds in a world with no ferry timetable, nor builds a frame to ask', () => {
    const w = { ferryView: () => null };
    advanceDeckFrame(deckFrameFor(w), w, 1 / 60);
    expect(shipShadowHold(w, light(0, 0))).toBe(false);
    expect(shipShadowHold({}, light(0, 0))).toBe(false);
  });
});
