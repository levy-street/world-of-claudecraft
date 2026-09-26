// The scheduled ferry's ship on screen: one transport ship view per route
// (render/transport_ship.ts, the Phase 1 model and its idle clip), posed every
// frame from the world's timetable view (IWorld.ferryView): docked at a berth,
// or under way along its sea lane the whole voyage long. The pose comes from
// the same pure schedule the sim runs (sim/transport_schedule.ts) at a drawn
// clock smoothed between world ticks, held by the world's deck frame
// (deck_frame.ts), which also places every passenger on the same drawn deck,
// so hull and passengers never disagree. Under way the gangplank is stowed and
// the wake and bow splash run (ship_wake.ts).
//
// GPU work: the views and their wakes are built into the props root at world
// build (the props material prewarm already stages the ship's programs,
// transportShipPrewarmParts, and the wake's, shipWakePrewarmParts), and moving
// or hiding one changes no program: this module never creates a material, a
// light or a geometry after build.

import { TRANSPORT_ROUTES } from '../sim/content/transport_ships';
import { WATER_LEVEL } from '../sim/world';
import { deckFrameFor, deckFrameForShips, type FerryViewSource } from './deck_frame';
import { buildShipWake, type ShipWake } from './ship_wake';
import { buildTransportShipView, type TransportShipView } from './transport_ship';

export type { FerryViewSource } from './deck_frame';

export interface ScheduledShips {
  /** Pose every scheduled ship for this frame (before the ships' own update). */
  sync(dt: number): void;
}

/**
 * Build the scheduled ships (built-in world only: the routes are authored for
 * it) and hand each view (and its wake) to `adopt`, which parents them and
 * ticks the view like any moored ship. They start at their first berth, the
 * clock-0 schedule.
 */
// Every route's ship is posed from the one transport clock (deck_frame.ts);
// only the HUD's timetable readout (IWorld.ferryView) is first-route today.
export function buildScheduledShips(
  source: FerryViewSource,
  adopt: (view: TransportShipView, wake: ShipWake | null) => void,
): ScheduledShips {
  const ships: { route: number; view: TransportShipView; wake: ShipWake | null }[] = [];
  TRANSPORT_ROUTES.forEach((route, i) => {
    const b = route.berths[0];
    const view = buildTransportShipView({
      key: route.ship,
      x: b.x,
      z: b.z,
      rot: b.rot,
      baseY: WATER_LEVEL,
    });
    if (!view) return;
    const wake = buildShipWake(view);
    adopt(view, wake);
    ships.push({ route: i, view, wake });
  });
  const df = deckFrameFor(source);
  return {
    sync(dt) {
      if (ships.length === 0) return;
      deckFrameForShips(df, source, dt);
      if (!df.active) {
        // no timetable to follow: leave the ships be, and let no wake hang
        for (let i = 0; i < ships.length; i++) {
          const wake = ships[i].wake;
          if (wake) wake.points.visible = false;
        }
        return;
      }
      for (let i = 0; i < ships.length; i++) {
        const ship = ships[i];
        const drawn = df.ships[ship.route];
        ship.view.setPose(drawn.drawn.x, drawn.drawn.z, drawn.drawn.rot, drawn.sailing);
        // a ship past the fog (hidden by its own update last frame) leaves
        // its wake undrawn and un-uploaded; it picks up again in sight
        if (!ship.wake) continue;
        if (ship.view.group.visible) {
          ship.wake.update(drawn.drawn, drawn.sailing ? drawn.speed : 0, dt);
        } else ship.wake.points.visible = false;
      }
    },
  };
}
