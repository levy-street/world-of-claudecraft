// The Last Bell harbors (docs/prd/last-bell-harbor.md H1) through the real
// sim: both authored harbors' boardwalks are raised walkable ground on
// multiple seeds, the piers run level over genuinely deep water, the ship
// berths float over deep water, the gangplanks stand on deck where the
// boarding fixtures spawn, the railings really block movement, and falling
// off a pier lands in calm (fatigue-free) water.
import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import {
  GULLHAVEN_HARBOR,
  HARBORS,
  harborDeckAt,
  harborSurfaceHeight,
  MAINLAND_HARBOR,
} from '../src/sim/harbor_layout';
import { Sim } from '../src/sim/sim';
import { groundHeight, inHollowOpenSea, terrainHeight, WATER_LEVEL } from '../src/sim/world';

// The pinned client world seed plus arbitrary others: authored deck heights
// must float above the terrain on ANY seed, not just the shipped world.
const SEEDS = [20061, 4242, 7, 999983];

function makeSim(): Sim {
  return new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Ash', devCommands: true });
}

describe('Last Bell harbors', () => {
  it('ships both harbors', () => {
    expect(HARBORS.map((h) => h.id)).toEqual(['mainland', 'gullhaven']);
    // Pin the anchors so the campaign cannot silently drift. The z values
    // ride the generated mating edge and the x values the measured deck, so
    // they are pinned to the expected world spots within a float hair.
    expect(MAINLAND_HARBOR.gangplank).toEqual({
      x: 230.4,
      z: expect.closeTo(-48.25, 5),
      facing: Math.PI / 2,
    });
    expect(GULLHAVEN_HARBOR.gangplank).toEqual({
      x: 723.5,
      z: expect.closeTo(116.25, 5),
      facing: 0,
    });
    expect(MAINLAND_HARBOR.boarding).toEqual({
      x: expect.closeTo(237.15, 5),
      z: expect.closeTo(-48.25, 5),
    });
    expect(GULLHAVEN_HARBOR.boarding).toEqual({
      x: expect.closeTo(716.35, 5),
      z: expect.closeTo(116.25, 5),
    });
    expect(MAINLAND_HARBOR.deckArrival).toEqual({ x: 240.5, z: expect.closeTo(-50.775, 5) });
    expect(GULLHAVEN_HARBOR.deckArrival).toEqual({ x: 713, z: expect.closeTo(113.725, 5) });
    expect(MAINLAND_HARBOR.arrival).toEqual({ x: 173, z: -42 });
    expect(GULLHAVEN_HARBOR.arrival).toEqual({ x: 782, z: 125 });
  });

  it('keeps every ramp inside the climb gate and flush at both ends', () => {
    for (const harbor of HARBORS) {
      for (const r of harbor.ramps) {
        const alongX = r.dir === 'x+' || r.dir === 'x-';
        const run = (alongX ? r.hw : r.hd) * 2;
        const slope = (r.highY - r.lowY) / run;
        expect(slope, `${harbor.id} ramp at ${r.x},${r.z}`).toBeGreaterThan(0);
        expect(slope, `${harbor.id} ramp at ${r.x},${r.z}`).toBeLessThan(1.2);
        // the high edge meets a walkable surface at exactly its height
        const sign = r.dir === 'x+' || r.dir === 'z+' ? 1 : -1;
        const hx = alongX ? r.x - sign * r.hw : r.x;
        const hz = alongX ? r.z : r.z - sign * r.hd;
        for (const seed of SEEDS) {
          expect(
            groundHeight(hx, hz, seed),
            `${harbor.id} ramp high edge at ${hx},${hz} seed ${seed}`,
          ).toBeGreaterThanOrEqual(r.highY - 0.001);
        }
      }
    }
  });

  it('keeps the boarding bridge LAST in decks (the identity contract)', () => {
    for (const harbor of HARBORS) {
      expect(harbor.decks.at(-1), `${harbor.id} bridge order`).toBe(harbor.bridge);
      expect(
        harbor.bridgeRails.every((rail) => harbor.rails.includes(rail)),
        `${harbor.id} bridge rails registered`,
      ).toBe(true);
    }
  });

  it('lands the seam ramps on walkable shoulders, never open water', () => {
    // The climb between the outer pier and the raised berth head runs over
    // the carved basin; the pier deck continues under the ramp so a
    // sideways step off either shoulder lands on planks, not in the sea.
    for (const harbor of HARBORS) {
      const seamRamp = harbor.ramps.at(-1);
      if (!seamRamp) throw new Error(`${harbor.id} lost its seam ramp`);
      for (const seed of SEEDS) {
        for (let x = seamRamp.x - seamRamp.hw + 0.2; x <= seamRamp.x + seamRamp.hw; x += 0.75) {
          for (const side of [-1, 1]) {
            const z = seamRamp.z + side * (seamRamp.hd + 0.25);
            expect(
              groundHeight(x, z, seed),
              `${harbor.id} seam ramp shoulder at ${x.toFixed(1)},${z.toFixed(1)} seed ${seed}`,
            ).toBeGreaterThan(WATER_LEVEL);
          }
        }
      }
    }
  });

  it('lands every entry ramp within a walkable step of the ground on every seed', () => {
    // The three shore/town entries: just beyond the ramp's low edge, the
    // bare ground must sit within the movement climb gate of the ramp lip
    // (a taller step is the invisible-wall bug this layout replaces).
    const entries: { harbor: (typeof HARBORS)[number]; x: number; z: number; lip: number }[] = [
      { harbor: MAINLAND_HARBOR, x: 172, z: -59.6, lip: 0.2 },
      { harbor: MAINLAND_HARBOR, x: 161.4, z: -48, lip: -0.6 },
      { harbor: GULLHAVEN_HARBOR, x: 788.6, z: 116, lip: 4.4 },
    ];
    for (const e of entries) {
      for (const seed of SEEDS) {
        const ground = groundHeight(e.x, e.z, seed);
        expect(
          Math.abs(ground - e.lip),
          `${e.harbor.id} entry at ${e.x},${e.z} seed ${seed}`,
        ).toBeLessThan(0.5);
      }
    }
  });

  it('walks aboard end to end: shore to ship deck without a blocking step', () => {
    // March the whole mainland approach: grass, south ramp, apron, pier,
    // head, gangplank, ship deck. Adjacent ground samples 0.2 apart must
    // never demand a climb steeper than the movement gate.
    const path: [number, number][] = [];
    for (let t = 0; t <= 1; t += 0.01) path.push([172, -59.5 + t * 11.5]); // grass to apron center
    for (let t = 0; t <= 1; t += 0.003) path.push([172 + t * 67.5, -48]); // apron to ship deck
    for (const seed of SEEDS) {
      let prev: number | null = null;
      for (const [x, z] of path) {
        const g = groundHeight(x, z, seed);
        if (prev !== null) {
          const rise = g - prev;
          expect(rise, `step at ${x.toFixed(1)},${z.toFixed(1)} seed ${seed}`).toBeLessThan(0.35);
        }
        prev = g;
      }
      // and the walk ends on the ship's measured deck height
      expect(groundHeight(239, -48, seed)).toBe(1.034142297254);
    }
  });

  it('keeps every deck walkable: the boardwalk is ground, above the terrain, on multiple seeds', () => {
    for (const harbor of HARBORS) {
      for (const deck of harbor.decks) {
        for (const seed of SEEDS) {
          // sample the footprint interior on a sub-yard grid
          for (let x = deck.x - deck.hw + 0.1; x <= deck.x + deck.hw - 0.1; x += 0.8) {
            for (let z = deck.z - deck.hd + 0.1; z <= deck.z + deck.hd - 0.1; z += 0.8) {
              const g = groundHeight(x, z, seed);
              const label = `${harbor.id} deck y=${deck.y} at ${x.toFixed(1)},${z.toFixed(1)} seed ${seed}`;
              // the deck IS the ground here (or a higher overlapping deck is)
              expect(g, label).toBeGreaterThanOrEqual(deck.y);
              // and it genuinely floats: authored height above the bare terrain
              expect(deck.y, label).toBeGreaterThan(terrainHeight(x, z, seed));
            }
          }
        }
      }
    }
  });

  it('runs the piers level over genuinely deep water', () => {
    // The seaward deck of each harbor: every sampled point has water-covered
    // terrain under it while the walkable height stays the one authored deck
    // height (level, no terrain seating). Points inside a seam overlap with
    // the previous, higher deck are that deck's business, so sample only
    // where the head rules.
    for (const harbor of HARBORS) {
      // The last deck is the boarding bridge by contract; the seaward deck
      // this test wants is the berth head beside it.
      const berthDecks = harbor.decks.filter((deck) => deck !== harbor.bridge);
      const head = berthDecks[berthDecks.length - 1];
      for (const seed of SEEDS) {
        let sampled = 0;
        for (let x = head.x - head.hw + 0.2; x <= head.x + head.hw - 0.2; x += 1.1) {
          for (let z = head.z - head.hd + 0.2; z <= head.z + head.hd - 0.2; z += 1.1) {
            // skip points where a seam ramp or a higher deck overlays the head
            if (harborSurfaceHeight(harbor, x, z) !== head.y) continue;
            sampled++;
            const label = `${harbor.id} head at ${x.toFixed(1)},${z.toFixed(1)} seed ${seed}`;
            expect(terrainHeight(x, z, seed), label).toBeLessThan(WATER_LEVEL);
            expect(groundHeight(x, z, seed), label).toBe(head.y);
          }
        }
        expect(sampled).toBeGreaterThan(10);
      }
    }
  });

  it('berths the ships in genuinely deep water on every seed', () => {
    for (const harbor of HARBORS) {
      const b = harbor.berth;
      const half = b.length / 2;
      // sample along the hull's long axis (rot is the long-axis yaw)
      const ax = Math.cos(b.rot);
      const az = -Math.sin(b.rot);
      for (const seed of SEEDS) {
        for (const t of [-1, -0.5, 0, 0.5, 1]) {
          const x = b.x + ax * half * t;
          const z = b.z + az * half * t;
          // at least a yard of water under the waterline beyond the draft
          expect(
            terrainHeight(x, z, seed),
            `${harbor.id} hull at ${x.toFixed(1)},${z.toFixed(1)} seed ${seed}`,
          ).toBeLessThan(WATER_LEVEL - 1);
        }
      }
      // the berth is beside the gangplank, not across the harbor
      expect(Math.hypot(b.x - harbor.gangplank.x, b.z - harbor.gangplank.z)).toBeLessThan(12);
    }
  });

  it('stands every gangway walk endpoint on a walkable surface', () => {
    for (const harbor of HARBORS) {
      const gp = harbor.gangplank;
      const deck = harborDeckAt(harbor, gp.x, gp.z);
      expect(deck, `${harbor.id} gangplank must be on a deck`).toBeTruthy();
      const deckArrival = harborDeckAt(harbor, harbor.deckArrival.x, harbor.deckArrival.z);
      expect(deckArrival, `${harbor.id} deck arrival must be on the ship`).toBeTruthy();
      expect(
        harbor.shipDecks.some((candidate) => candidate === deckArrival),
        `${harbor.id} deck arrival must use a ship deck`,
      ).toBe(true);
      const arrivalDeck = harborDeckAt(harbor, harbor.arrival.x, harbor.arrival.z);
      expect(arrivalDeck, `${harbor.id} arrival must be on a deck`).toBeTruthy();
      for (const seed of SEEDS) {
        expect(groundHeight(gp.x, gp.z, seed)).toBe(deck?.y);
        expect(groundHeight(harbor.deckArrival.x, harbor.deckArrival.z, seed)).toBe(deckArrival?.y);
        expect(groundHeight(harbor.arrival.x, harbor.arrival.z, seed)).toBe(arrivalDeck?.y);
      }
    }
    // The boarding fixtures spawn ON each ship's deck (walk aboard, then
    // depart): the sim reads the layout's boarding anchors.
    const sim = makeSim();
    const ferries = [...sim.entities.values()].filter((e) => e.templateId === 'lb_ferry');
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining(HARBORS.map((h) => ({ x: h.boarding.x, z: h.boarding.z }))),
    );
    for (const harbor of HARBORS) {
      const onShip = harbor.shipDecks.some(
        (d) =>
          Math.abs(harbor.boarding.x - d.x) <= d.hw && Math.abs(harbor.boarding.z - d.z) <= d.hd,
      );
      expect(onShip, `${harbor.id} boarding must be on the ship deck`).toBe(true);
    }
    // The crossing keepers stand ON DECK at the top of each gangplank,
    // close enough to the boarding point to hand out the crossing quest
    // (acceptQuest requires the giver nearby).
    for (const [templateId, harbor] of [
      ['ferryman_ewald', MAINLAND_HARBOR],
      ['ferryman_ewald_gullhaven', GULLHAVEN_HARBOR],
    ] as const) {
      const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
      expect(npc, templateId).toBeTruthy();
      if (npc) {
        expect(npc.name).toBe('Ferryman Ewald');
        const b = harbor.boarding;
        expect(Math.hypot(npc.pos.x - b.x, npc.pos.z - b.z), templateId).toBeLessThan(6);
        expect(harborDeckAt(harbor, npc.pos.x, npc.pos.z), templateId).toBeTruthy();
      }
    }
  });

  it('blocks movement at the railings but not along the boardwalk', () => {
    const seed = 4242;
    // Mainland pier: walking the pier centerline is free passage.
    const walked = resolveMovement(seed, 181, -48, 194, -48);
    expect(Math.hypot(walked.x - 194, walked.z + 48)).toBeLessThan(0.2);
    // Walking off the pier's south edge stops at the rail (z -51.4).
    const railed = resolveMovement(seed, 188, -50.2, 188, -54);
    expect(railed.z).toBeGreaterThan(-51.4);
    // Gullhaven: the walkway runs west to the berth head. Its west rail
    // blocks away from the gangplank and leaves the authored gap open.
    const openRun = resolveMovement(seed, 756, 116, 745, 116);
    expect(Math.abs(openRun.x - 745)).toBeLessThan(0.2);
    const westRail = resolveMovement(seed, 727, 111, 719, 111);
    expect(westRail.x).toBeGreaterThan(722.5);
    const gullhavenGap = resolveMovement(seed, 727, 116.5, 719, 116.5);
    expect(gullhavenGap.x).toBeLessThan(721);
    // The gangplank gap is genuinely open: stepping off the head's east
    // edge (x 206) onto the gangplank ramp is not blocked by a rail.
    const throughGap = resolveMovement(seed, 205, -48, 207.5, -48);
    expect(throughGap.x).toBeGreaterThan(206.5);
    // Aboard, the deck is open water-side until the far hull rail stops it.
    const hullRail = resolveMovement(seed, 239, -48, 249, -48);
    expect(hullRail.x).toBeGreaterThan(243);
    expect(hullRail.x).toBeLessThan(246.7);
    // The berth-head gap onto the gangplank is open.
    const ontoPlank = resolveMovement(seed, 229.5, -48, 232.5, -48);
    expect(ontoPlank.x).toBeGreaterThan(231.5);
  });

  it('keeps control on the ship deck: walk aboard and back through the motion loop', () => {
    // Regression: rideSteepnessAt used to read the BARE TERRAIN under the
    // deck (the strip-edge dive wall under the mainland berth is steeper
    // than the climb gate), so the steep-ground gate stripped control the
    // moment a player stepped aboard. The footing arm returns the authored
    // surface slope instead; this drives the REAL motion loop both ways.
    const sim = makeSim();
    const tp = (x: number, z: number) => {
      const pos = sim.groundPos(x, z);
      sim.player.pos = { ...pos };
      sim.player.prevPos = { ...pos };
      sim.rebucket(sim.player);
    };
    tp(204.5, -48);
    sim.player.facing = Math.PI / 2;
    sim.moveInput.forward = true;
    for (let i = 0; i < 420; i++) sim.tick();
    // aboard, well past the gangway landing, at the measured deck height
    expect(sim.player.pos.x).toBeGreaterThan(236);
    expect(sim.player.pos.y).toBeCloseTo(1.034142, 3);
    // and back west down the plank to the berth head: control never strips
    sim.player.facing = -Math.PI / 2;
    for (let i = 0; i < 500; i++) sim.tick();
    sim.moveInput.forward = false;
    expect(sim.player.pos.x).toBeLessThan(228);
  });

  it('keeps the water around the piers calm: falling off is no drowning clock', () => {
    // beside the mainland pier head and under the Gullhaven berth
    for (const [x, z] of [
      [199, -54.5],
      [207, -48],
      [186, -52],
      [757, 124],
      [764, 111],
      [755, 122],
    ]) {
      expect(terrainHeight(x, z, 20061), `water at ${x},${z}`).toBeLessThan(WATER_LEVEL);
      expect(inHollowOpenSea(x, z), `calm at ${x},${z}`).toBe(false);
    }
  });

  it('reports every deck edge point as deck (rail anchors read deck height)', () => {
    // The rail segments sit exactly on authored edge lines; float
    // representation of the extents must not drop them off the deck.
    for (const harbor of HARBORS) {
      for (const rail of harbor.rails) {
        expect(
          harborSurfaceHeight(harbor, rail.x, rail.z),
          `${harbor.id} rail at ${rail.x},${rail.z}`,
        ).toBeGreaterThan(-Infinity);
      }
    }
  });
});
