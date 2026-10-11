import { describe, expect, it } from 'vitest';
import { applyTransportSnapshot, clientFerryView } from '../src/net/transport_wire';
import {
  EASTBROOK_NIGHTBLOOM_FERRY,
  TRANSPORT_ROUTES,
  WICKHARBOR_DRAKELANDS_FERRY,
} from '../src/sim/content/transport_ships';
import { ferryViewRouteIndex, transportRouteIndex } from '../src/sim/ferry_view_route';
import { Sim } from '../src/sim/sim';
import { type TransportPose, transportShipPoseAt } from '../src/sim/transport_schedule';
import type { Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// Which route a player's ferry view shows (src/sim/ferry_view_route.ts): the
// route they ride, else the one whose ship or berth is nearest. The offline
// Sim and the online ClientWorld both read it, so the HUD shows the same
// timetable in either host.

const A = EASTBROOK_NIGHTBLOOM_FERRY;
const B = WICKHARBOR_DRAKELANDS_FERRY;

describe('ferryViewRouteIndex', () => {
  it('shows the ridden route wherever the passenger is', () => {
    const eb = A.berths[0];
    expect(ferryViewRouteIndex(100, eb.x, eb.z, 1)).toBe(1);
    expect(ferryViewRouteIndex(100, B.berths[1].x, B.berths[1].z, 0)).toBe(0);
  });

  it('on foot: the route whose berth or ship is nearest', () => {
    for (let r = 0; r < TRANSPORT_ROUTES.length; r++) {
      for (const b of TRANSPORT_ROUTES[r].berths) {
        expect(ferryViewRouteIndex(10, b.landing.x, b.landing.z, -1)).toBe(r);
      }
    }
    // beside route B's ship at sea, far from every berth
    const mid = B.timings.docked + 50;
    const pose: TransportPose = { x: 0, z: 0, rot: 0 };
    transportShipPoseAt(B, mid, pose);
    expect(ferryViewRouteIndex(mid, pose.x + 10, pose.z, -1)).toBe(1);
    // an out-of-range ride index is ignored, never trusted
    expect(ferryViewRouteIndex(10, A.berths[0].x, A.berths[0].z, 7)).toBe(0);
  });

  it('maps route ids to indices', () => {
    expect(transportRouteIndex('eastbrookNightbloom')).toBe(0);
    expect(transportRouteIndex('wickharborDrakelands')).toBe(1);
    expect(transportRouteIndex('nowhere')).toBe(-1);
    expect(transportRouteIndex(undefined)).toBe(-1);
  });
});

describe('both worlds show the same route', () => {
  it('the offline Sim and the online ClientWorld agree, on foot and aboard', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const player = {
      pos: { x: 0, y: 0, z: 0 },
      ferryRiding: false,
      ferryDeck: null,
    } as unknown as Entity;
    const client = { cfg: { seed: WORLD_SEED }, player };
    const spots = TRANSPORT_ROUTES.flatMap((r) => r.berths.map((b) => b.landing));
    for (const clock of [5, 70, 130, 200]) {
      sim.transportClockOffset = clock - sim.time;
      applyTransportSnapshot(client, { t: 'snap', time: clock });
      for (const at of spots) {
        sim.player.pos.x = at.x;
        sim.player.pos.z = at.z;
        player.pos.x = at.x;
        player.pos.z = at.z;
        const offline = sim.ferryView();
        const online = clientFerryView(client);
        expect(online?.routeId).toBe(offline?.routeId);
        expect(online?.phase).toBe(offline?.phase);
        expect(online?.to).toBe(offline?.to);
        expect(online?.passenger).toBe(false);
      }
    }
    // a passenger of route B standing near route A's berth, in both worlds:
    // the Sim reads their ride, the client its deck mirror (the `fry` route)
    sim.player.pos.x = A.berths[0].x;
    sim.player.pos.z = A.berths[0].z;
    sim.player.ferryRide = { route: B.id, from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    player.ferryRiding = true;
    player.ferryDeck = { route: 1, x: 0, y: 3.3, z: 0, f: 0 };
    player.pos.x = A.berths[0].x;
    player.pos.z = A.berths[0].z;
    const offline = sim.ferryView();
    const online = clientFerryView(client);
    expect(offline).toMatchObject({ routeId: B.id, passenger: true });
    expect(online).toMatchObject({ routeId: B.id, passenger: true });
  });
});
