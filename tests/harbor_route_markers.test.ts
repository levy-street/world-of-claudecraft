import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { harborDestinationLabel } from '../src/render/entity_labels';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { HARBOR_ROUTE_MARKERS } from '../src/sim/content/harbor_route_markers';
import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from '../src/sim/content/transport_ships';
import { PROPS, ZONES } from '../src/sim/data';
import { EASTBROOK_HARBOR_DECKS } from '../src/sim/eastbrook_harbor';
import { FERRY_PIER_DECKS } from '../src/sim/ferry_piers';
import { GALE_HARBOR_DECKS, type GaleDeckDef } from '../src/sim/gale_harbor';
import {
  HARBOR_ROUTE_MARKER_POST_RADIUS,
  HARBOR_ROUTE_MARKER_POST_TOP,
  harborRouteMarkerArrow,
  harborRouteMarkerBoardingPoint,
  harborRouteMarkerColliders,
  harborRouteMarkerYaw,
} from '../src/sim/harbor_route_markers';
import { transportBerthColliders } from '../src/sim/transport_gates';
import { shipHullColliders } from '../src/sim/transport_ship';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The harbor route markers (content/harbor_route_markers.ts): one signpost at
// every ferry berth, naming the route's other end, its arrow turned toward
// the boarding point, standing on its pier's planks clear of the walkway, the
// gangplank and the ship, with one narrow collider around the post.

const DECKS: readonly GaleDeckDef[] = [
  ...EASTBROOK_HARBOR_DECKS,
  ...GALE_HARBOR_DECKS,
  ...FERRY_PIER_DECKS,
];

/** A point in a deck's frame: along its heading and across it. */
function deckLocal(deck: GaleDeckDef, x: number, z: number): { along: number; across: number } {
  const dx = x - deck.x;
  const dz = z - deck.z;
  const dirx = Math.sin(deck.rot);
  const dirz = Math.cos(deck.rot);
  return { along: dx * dirx + dz * dirz, across: dx * dirz - dz * dirx };
}

function inDeck(deck: GaleDeckDef, x: number, z: number, grow = 0): boolean {
  const l = deckLocal(deck, x, z);
  return Math.abs(l.along) <= deck.hl + grow && Math.abs(l.across) <= deck.hw + grow;
}

/** The deck the post stands on: the one holding the post's whole footprint. */
function pierUnder(x: number, z: number): GaleDeckDef {
  const r = HARBOR_ROUTE_MARKER_POST_RADIUS;
  const found = DECKS.filter((d) => {
    const l = deckLocal(d, x, z);
    return Math.abs(l.along) + r <= d.hl && Math.abs(l.across) + r <= d.hw;
  });
  if (found.length !== 1) throw new Error(`post at (${x}, ${z}) stands on ${found.length} decks`);
  return found[0];
}

/** Clearance between the post's circle and a collider (negative = overlap). */
function clearance(x: number, z: number, r: number, c: Collider): number {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r - r;
  const cos = Math.cos(-c.rot);
  const sin = Math.sin(-c.rot);
  const lx = (x - c.x) * cos + (z - c.z) * sin;
  const lz = -(x - c.x) * sin + (z - c.z) * cos;
  const dx = Math.max(0, Math.abs(lx) - c.hw);
  const dz = Math.max(0, Math.abs(lz) - c.hd);
  return Math.hypot(dx, dz) - r;
}

function berthOf(route: string, berth: string) {
  const r = TRANSPORT_ROUTES.find((t) => t.id === route);
  const i = r?.berths.findIndex((b) => b.id === berth) ?? -1;
  if (!r || i < 0) throw new Error(`no berth ${route}/${berth}`);
  return { route: r, index: i, berth: r.berths[i], other: r.berths[1 - i] };
}

describe('harbor route markers: one per berth, naming the far end', () => {
  it('stands exactly one marker at each of the four ferry berths', () => {
    const berths = TRANSPORT_ROUTES.flatMap((r) => r.berths.map((b) => `${r.id}/${b.id}`)).sort();
    expect(berths).toHaveLength(4);
    expect(HARBOR_ROUTE_MARKERS.map((m) => `${m.route}/${m.berth}`).sort()).toEqual(berths);
  });

  it('reads the other berth of its route, by a label the game already localizes', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const { other } = berthOf(m.route, m.berth);
      const [, zone, poi] = other.poi.split(':');
      if (m.destination.kind === 'zone') {
        expect(m.destination.zone, m.berth).toBe(zone);
        expect(ZONES.some((z) => z.id === zone)).toBe(true);
      } else {
        expect(m.destination.mark, m.berth).toBe(other.poi);
        expect(ZONES.find((z) => z.id === zone)?.pois.some((p) => p.id === poi)).toBe(true);
      }
    }
  });

  it('names the destinations the owner asked for (English source)', () => {
    const read = Object.fromEntries(
      HARBOR_ROUTE_MARKERS.map((m) => [m.berth, harborDestinationLabel(m.destination)]),
    );
    expect(read).toEqual({
      eastbrook: 'The Nightbloom',
      nightbloom: 'Eastbrook',
      wickharbor: 'The Drakelands',
      drakelands: 'Wickharbor',
    });
  });
});

describe('harbor route markers: the arrow points at the boarding point', () => {
  it('turns local +x (the arrow of the model) onto the way to the landing', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const yaw = harborRouteMarkerYaw(m);
      const land = harborRouteMarkerBoardingPoint(m);
      const { berth } = berthOf(m.route, m.berth);
      expect(land).toEqual({ x: berth.landing.x, z: berth.landing.z });
      const to = new THREE.Vector2(land.x - m.x, land.z - m.z).normalize();
      // the pure arrow and a real three.js rotation.y agree, and both point there
      const arrow = harborRouteMarkerArrow(yaw);
      const turned = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      expect(turned.x).toBeCloseTo(arrow.x, 9);
      expect(turned.z).toBeCloseTo(arrow.z, 9);
      expect(arrow.x * to.x + arrow.z * to.y, m.berth).toBeGreaterThan(
        Math.cos((0.5 * Math.PI) / 180),
      );
    }
  });

  it('reaches out along its pier toward the ship, never back to shore', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const pier = pierUnder(m.x, m.z);
      const { berth } = berthOf(m.route, m.berth);
      // the pier's heading, signed so it runs toward the berth
      let hx = Math.sin(pier.rot);
      let hz = Math.cos(pier.rot);
      if ((berth.x - pier.x) * hx + (berth.z - pier.z) * hz < 0) {
        hx = -hx;
        hz = -hz;
      }
      const arrow = harborRouteMarkerArrow(harborRouteMarkerYaw(m));
      // within 12 degrees of the pier's own line: the board runs along the edge
      expect(arrow.x * hx + arrow.z * hz, m.berth).toBeGreaterThan(Math.cos((12 * Math.PI) / 180));
    }
  });
});

describe('harbor route markers: placement clear of the boarding path', () => {
  const r = HARBOR_ROUTE_MARKER_POST_RADIUS;

  it('stands its whole post on the planks of its pier, above the water', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const pier = pierUnder(m.x, m.z);
      expect(pier.hw, m.berth).toBeGreaterThanOrEqual(2);
      expect(groundHeight(m.x, m.z, WORLD_SEED), m.berth).toBeGreaterThan(WATER_LEVEL + 0.5);
    }
  });

  it('stays out of the walkway: off the centre line, three yards clear beside it, no junction', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const pier = pierUnder(m.x, m.z);
      const { across } = deckLocal(pier, m.x, m.z);
      // walking straight down the middle never brushes the post
      expect(Math.abs(across) - r, m.berth).toBeGreaterThan(1.2);
      // and the planks beside it leave a wide lane (a body is a yard across)
      expect(pier.hw + Math.abs(across) - r, m.berth).toBeGreaterThan(3);
      // no other walkway (a shore boardwalk, a bluff stair) joins where it stands
      for (const other of DECKS) {
        if (other === pier) continue;
        expect(inDeck(other, m.x, m.z, r + 0.5), `${m.berth} junction`).toBe(false);
      }
    }
  });

  it('keeps well away from the landing, the gangplank and the moored ship', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const { route, berth } = berthOf(m.route, m.berth);
      expect(Math.hypot(berth.landing.x - m.x, berth.landing.z - m.z), m.berth).toBeGreaterThan(8);
      const hull = TRANSPORT_SHIP_HULLS[route.ship];
      const docked = shipHullColliders(hull, {
        x: berth.x,
        z: berth.z,
        rot: berth.rot,
        baseY: WATER_LEVEL,
      });
      expect(docked.length).toBe(hull.volumes.length);
      for (let i = 0; i < docked.length; i++) {
        const v = hull.volumes[i];
        // the gangplank and the gangway keep a wide berth; the hull itself too
        const margin = v.kind === 'gangplank' || v.kind === 'gangway' ? 5 : 2;
        expect(clearance(m.x, m.z, r, docked[i]), `${m.berth} ${v.id}`).toBeGreaterThan(margin);
      }
    }
  });

  it('crowds no existing obstacle: nothing on land was moved to make room', () => {
    for (const m of HARBOR_ROUTE_MARKERS) {
      const near: Collider[] = [];
      queryOpenWorldColliders(WORLD_SEED, m.x - 6, m.z - 6, m.x + 6, m.z + 6, near);
      for (const c of near) {
        if (c.gate !== undefined) continue;
        if (c.type === 'circle' && c.x === m.x && c.z === m.z) continue; // itself
        expect(clearance(m.x, m.z, r, c), `${m.berth} vs (${c.x}, ${c.z})`).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('harbor route markers: nothing moored in front of them', () => {
  it('keeps every moored ship well away from each marker (Wickharbor pair moved to the Beacon dock)', () => {
    const ships = (PROPS.decorProps ?? []).filter(
      (d) => d.key === 'hexShipBlue' && d.float !== undefined,
    );
    // the two hulls that lay off the deepwater pier's south side, hiding the sign
    for (const [x, z] of [
      [456.6, 382.8],
      [468.1, 386],
    ]) {
      expect(
        ships.some((d) => d.x === x && d.z === z),
        `${x}, ${z}`,
      ).toBe(false);
    }
    for (const [x, z] of [
      [507, 339],
      [530, 338],
    ]) {
      expect(
        ships.filter((d) => d.x === x && d.z === z),
        `${x}, ${z}`,
      ).toHaveLength(1);
    }
    for (const m of HARBOR_ROUTE_MARKERS) {
      for (const d of ships) {
        const gap = Math.hypot(d.x - m.x, d.z - m.z) - (d.r ?? 4);
        expect(gap, `${m.berth} vs ship at (${d.x}, ${d.z})`).toBeGreaterThan(12);
      }
    }
  });

  it('moors the moved hulls in water, off the Beacon dock, clear of every deck and each other', () => {
    const ships = (PROPS.decorProps ?? []).filter(
      (d) => d.key === 'hexShipBlue' && d.float !== undefined,
    );
    for (const [x, z] of [
      [507, 339],
      [530, 338],
    ]) {
      for (const [ox, oz] of [
        [0, 0],
        [4, 0],
        [-4, 0],
        [0, 4],
        [0, -4],
      ]) {
        expect(groundHeight(x + ox, z + oz, WORLD_SEED), `${x}, ${z}`).toBeLessThan(
          WATER_LEVEL - 1.2,
        );
      }
      for (const deck of DECKS) {
        const l = deckLocal(deck, x, z);
        const gap = Math.hypot(
          Math.max(0, Math.abs(l.along) - deck.hl),
          Math.max(0, Math.abs(l.across) - deck.hw),
        );
        expect(gap, `${x}, ${z}`).toBeGreaterThan(4.5);
      }
      for (const other of ships) {
        if (other.x === x && other.z === z) continue;
        expect(Math.hypot(other.x - x, other.z - z), `${x}, ${z}`).toBeGreaterThan(10);
      }
    }
  });
});

describe('harbor route markers: one narrow post collider', () => {
  it('builds one small ungated circle per marker, as tall as the post', () => {
    const colliders = harborRouteMarkerColliders(WORLD_SEED);
    expect(colliders).toHaveLength(HARBOR_ROUTE_MARKERS.length);
    expect(HARBOR_ROUTE_MARKER_POST_RADIUS).toBeLessThanOrEqual(0.4);
    colliders.forEach((c, i) => {
      const m = HARBOR_ROUTE_MARKERS[i];
      expect(c.type).toBe('circle');
      if (c.type !== 'circle') return;
      expect(c).toMatchObject({ x: m.x, z: m.z, r: HARBOR_ROUTE_MARKER_POST_RADIUS });
      expect(c.gate).toBeUndefined();
      expect(c.moveTopY).toBeUndefined(); // full height: nobody hops a signpost
      expect(c.cameraTopY).toBeCloseTo(
        groundHeight(m.x, m.z, WORLD_SEED) + HARBOR_ROUTE_MARKER_POST_TOP,
        6,
      );
    });
  });

  it('joins the berth colliders and the live static grid, standing whatever the timetable', () => {
    const berth = transportBerthColliders(WORLD_SEED).filter((c) => c.gate === undefined);
    expect(berth).toEqual(harborRouteMarkerColliders(WORLD_SEED));
    for (const m of HARBOR_ROUTE_MARKERS) {
      const near: Collider[] = [];
      queryOpenWorldColliders(WORLD_SEED, m.x - 1, m.z - 1, m.x + 1, m.z + 1, near);
      const post = near.filter(
        (c) =>
          c.type === 'circle' &&
          c.x === m.x &&
          c.z === m.z &&
          c.r === HARBOR_ROUTE_MARKER_POST_RADIUS,
      );
      expect(post, m.berth).toHaveLength(1);
      expect(post[0].gate).toBeUndefined();
    }
  });
});
