// The Wyrmgate Waystone (src/sim/content/drakelands.ts DRAKELANDS_PORTALS):
// a tolled walk-in portal between the Highwatch green (Thornpeak Heights) and
// the Last Keep's bailey (the Drakelands). src/sim/portals.ts runs the
// trigger; src/sim/portal_toll.ts settles the coin: a traveler with the toll
// is charged and moved, one without is refused ONCE per approach (the
// Entity.portalHoldId latch) and never moved. Both sides stand in open ground,
// so colliders.ts adds no cave flanks; two same-seed worlds stay identical.

import { describe, expect, it } from 'vitest';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { DRAKELANDS_PORTALS, WYRMGATE_WAYSTONE_TOLL_COPPER } from '../src/sim/content/drakelands';
import { REALM_PORTALS } from '../src/sim/content/realm';
import { PORTALS, ZONES, zoneAt } from '../src/sim/data';
import { POI_VISIT_RADIUS } from '../src/sim/deeds';
import { PORTAL_TOLL_COMBAT_REFUSAL, settlePortalToll } from '../src/sim/portal_toll';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight, waterLevel } from '../src/sim/world';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const PORTAL = DRAKELANDS_PORTALS[0];

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function place(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function logTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
    .map((e) => e.text);
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('the Wyrmgate Waystone record', () => {
  it('is registered in the merged portal table with a fifty-silver toll', () => {
    expect(PORTALS.some((p) => p.id === 'wyrmgate_waystone')).toBe(true);
    expect(PORTAL.tollCopper).toBe(WYRMGATE_WAYSTONE_TOLL_COPPER);
    expect(WYRMGATE_WAYSTONE_TOLL_COPPER).toBe(5_000);
    expect(PORTAL.gate).toBe('waystone');
    expect(PORTAL.tollText).toBeTruthy();
  });

  it('stands on dry ground in the two zones it joins, with each landing out of its own trigger', () => {
    expect(zoneAt(PORTAL.a.x, PORTAL.a.z).id).toBe('thornpeak_heights');
    expect(zoneAt(PORTAL.b.x, PORTAL.b.z).id).toBe('drakelands');
    for (const side of [PORTAL.a, PORTAL.b]) {
      expect(groundHeight(side.x, side.z, 42)).toBeGreaterThan(waterLevel());
      expect(groundHeight(side.landing.x, side.landing.z, 42)).toBeGreaterThan(waterLevel());
      const d = Math.hypot(side.landing.x - side.x, side.landing.z - side.z);
      expect(d).toBeGreaterThan(PORTAL.radius + 1);
    }
  });

  it('the Highwatch side is a named place; the keep side is found by the Last Keep mark', () => {
    const poiOf = (zoneId: string, id: string) =>
      ZONES.find((z) => z.id === zoneId)!.pois.find((p) => p.id === id);
    expect(poiOf('thornpeak_heights', 'wyrmgate_waystone')).toMatchObject({
      x: PORTAL.a.x,
      z: PORTAL.a.z,
    });
    expect(poiOf('drakelands', 'wyrmgate_waystone')).toBeUndefined();
    const keep = poiOf('drakelands', 'the_last_keep')!;
    expect(Math.hypot(PORTAL.b.x - keep.x, PORTAL.b.z - keep.z)).toBeLessThan(30);
  });

  it('the keep side stands inside the curtain walls, on the gatehouse road axis', () => {
    // Bailey inner faces (src/sim/castle_layout.ts CASTLE walls): x 361.5..435.3,
    // z 1989.5..2070.3; the main gate opening spans z 2028.2..2031.6.
    for (const pt of [PORTAL.b, PORTAL.b.landing]) {
      expect(pt.x).toBeGreaterThan(361.5 + 4);
      expect(pt.x).toBeLessThan(435.3 - 4);
      expect(pt.z).toBeGreaterThan(1989.5 + 4);
      expect(pt.z).toBeLessThan(2070.3 - 4);
    }
    expect(PORTAL.b.z).toBeGreaterThan(2028.2);
    expect(PORTAL.b.z).toBeLessThan(2031.6);
  });

  it('every line the record emits resolves in the sim message matcher', async () => {
    await ensureLocaleLoaded('es_ES');
    setLanguage('es_ES');
    try {
      for (const portal of PORTALS) {
        for (const text of [portal.enterText, portal.leaveText, portal.tollText]) {
          if (text === undefined) continue;
          const localized = localizeSimText(text);
          expect(localized, `${portal.id}: ${text}`).not.toBeNull();
          expect(localized, `${portal.id}: ${text}`).not.toBe(text);
        }
      }
    } finally {
      setLanguage('en');
    }
  });

  it('adds no cave-mouth flank colliders (the arch stands in the open)', () => {
    const shapes = colliderInternalsForTest.staticWorldColliders(42);
    const near = (side: { x: number; z: number }) =>
      shapes.filter((s) => s.type === 'circle' && Math.hypot(s.x - side.x, s.z - side.z) < 5);
    for (const side of [PORTAL.a, PORTAL.b]) expect(near(side)).toEqual([]);
    // The skip is keyed on the gate kind: the Duskfall cave keeps its flanks.
    const cave = REALM_PORTALS[0];
    expect(cave.gate).toBeUndefined();
    expect(near(cave.a).length).toBeGreaterThan(0);
    expect(near(cave.b).length).toBeGreaterThan(0);
  });

  it('stands the marked Highwatch side at least two visit radii from its hub (the wayfarer deed sweep)', () => {
    const hub = ZONES.find((z) => z.id === 'thornpeak_heights')!.hub;
    expect(Math.hypot(PORTAL.a.x - hub.x, PORTAL.a.z - hub.z)).toBeGreaterThan(
      2 * POI_VISIT_RADIUS,
    );
  });
});

describe('crossing the Wyrmgate Waystone', () => {
  it('charges the toll and carries a paying traveler from Highwatch to Wyrmwatch', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = WYRMGATE_WAYSTONE_TOLL_COPPER + 250;
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    const events = sim.tick();
    const p = sim.entities.get(a)!;
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('drakelands');
    expect(p.pos.x).toBeCloseTo(PORTAL.b.landing.x, 5);
    expect(p.pos.z).toBeCloseTo(PORTAL.b.landing.z, 5);
    expect(p.facing).toBe(PORTAL.b.landing.facing);
    expect(meta.copper).toBe(250);
    expect(logTexts(events)).toContain(PORTAL.enterText);
    expect(errorTexts(events)).toEqual([]);
    // The text-free booking marker the server turns into a 'travel' copper flow.
    expect(events).toContainEqual({
      type: 'portalToll',
      pid: a,
      copper: WYRMGATE_WAYSTONE_TOLL_COPPER,
    });
  });

  it('refuses a traveler in combat, once, and never takes their coin', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = WYRMGATE_WAYSTONE_TOLL_COPPER * 2;
    const p = sim.entities.get(a)!;
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    p.inCombat = true;
    p.combatTimer = 99;
    const first = sim.tick();
    expect(errorTexts(first)).toEqual([PORTAL_TOLL_COMBAT_REFUSAL]);
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('thornpeak_heights');
    expect(meta.copper).toBe(WYRMGATE_WAYSTONE_TOLL_COPPER * 2);
    let later: SimEvent[] = [];
    for (let i = 0; i < 20; i++) {
      p.inCombat = true;
      p.combatTimer = 99;
      later = later.concat(sim.tick());
    }
    expect(errorTexts(later)).toEqual([]);
    // Combat ends while standing in the arch: the crossing takes hold (the
    // latch only silences repeat refusals; it never blocks a payable crossing).
    p.inCombat = false;
    p.combatTimer = 0;
    expect(logTexts(sim.tick())).toContain(PORTAL.enterText);
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('drakelands');
    expect(meta.copper).toBe(WYRMGATE_WAYSTONE_TOLL_COPPER);
  });

  it('charges again on the way back to Highwatch', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = WYRMGATE_WAYSTONE_TOLL_COPPER;
    place(sim, a, PORTAL.b.x, PORTAL.b.z);
    const events = sim.tick();
    const p = sim.entities.get(a)!;
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('thornpeak_heights');
    expect(p.pos.x).toBeCloseTo(PORTAL.a.landing.x, 5);
    expect(meta.copper).toBe(0);
    expect(logTexts(events)).toContain(PORTAL.leaveText);
  });

  it('refuses a traveler one copper short, once, and moves nobody', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = WYRMGATE_WAYSTONE_TOLL_COPPER - 1;
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    const first = sim.tick();
    const p = sim.entities.get(a)!;
    expect(errorTexts(first)).toEqual([PORTAL.tollText]);
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('thornpeak_heights');
    expect(Math.hypot(p.pos.x - PORTAL.a.x, p.pos.z - PORTAL.a.z)).toBeLessThan(PORTAL.radius);
    expect(meta.copper).toBe(WYRMGATE_WAYSTONE_TOLL_COPPER - 1);
    expect(p.portalHoldId).toBe(PORTAL.id);
    // Standing in the dark waystone: silence, not a toast every tick.
    let later: SimEvent[] = [];
    for (let i = 0; i < 40; i++) later = later.concat(sim.tick());
    expect(errorTexts(later)).toEqual([]);
    expect(logTexts(later)).not.toContain(PORTAL.enterText);
  });

  it('re-arms the refusal once the traveler steps out, and lets them through once paid', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = 0;
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    expect(errorTexts(sim.tick())).toEqual([PORTAL.tollText]);
    const p = sim.entities.get(a)!;
    // Step out (well past the trigger), the latch clears.
    place(sim, a, PORTAL.a.x + 6, PORTAL.a.z);
    sim.tick();
    expect(p.portalHoldId).toBeUndefined();
    // Back in, still broke: the toast fires again, once.
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    expect(errorTexts(sim.tick())).toEqual([PORTAL.tollText]);
    expect(errorTexts(sim.tick())).toEqual([]);
    // Coin arrives while standing in the arch: the crossing takes hold.
    meta.copper = WYRMGATE_WAYSTONE_TOLL_COPPER;
    const events = sim.tick();
    expect(logTexts(events)).toContain(PORTAL.enterText);
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('drakelands');
    expect(meta.copper).toBe(0);
  });

  it('never ping-pongs: a paid arrival standing still stays put and pays once', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = WYRMGATE_WAYSTONE_TOLL_COPPER * 3;
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    sim.tick();
    const p = sim.entities.get(a)!;
    const landed = { x: p.pos.x, z: p.pos.z };
    for (let i = 0; i < 100; i++) sim.tick();
    expect(p.pos.x).toBeCloseTo(landed.x, 5);
    expect(p.pos.z).toBeCloseTo(landed.z, 5);
    expect(meta.copper).toBe(WYRMGATE_WAYSTONE_TOLL_COPPER * 2);
  });

  it('addresses the flavor line and the refusal to the traveler only', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Beth');
    sim.tick();
    sim.players.get(a)!.copper = WYRMGATE_WAYSTONE_TOLL_COPPER;
    sim.players.get(b)!.copper = 0;
    place(sim, a, PORTAL.a.x, PORTAL.a.z);
    place(sim, b, PORTAL.b.x, PORTAL.b.z);
    const events = sim.tick();
    const line = events.find(
      (e): e is Extract<SimEvent, { type: 'log' }> =>
        e.type === 'log' && e.text === PORTAL.enterText,
    );
    expect(line?.pid).toBe(a);
    const refusal = events.find(
      (e): e is Extract<SimEvent, { type: 'error' }> =>
        e.type === 'error' && e.text === PORTAL.tollText,
    );
    expect(refusal?.pid).toBe(b);
    expect(zoneAt(sim.entities.get(b)!.pos.x, sim.entities.get(b)!.pos.z).id).toBe('drakelands');
  });

  it('keeps two same-seed worlds identical through a tolled crossing', () => {
    const run = () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      sim.tick();
      sim.players.get(a)!.copper = WYRMGATE_WAYSTONE_TOLL_COPPER;
      place(sim, a, PORTAL.a.x, PORTAL.a.z);
      for (let i = 0; i < 50; i++) sim.tick();
      const p = sim.entities.get(a)!;
      return [p.pos.x, p.pos.y, p.pos.z, sim.players.get(a)!.copper, sim.rng.next()];
    };
    expect(run()).toEqual(run());
  });
});

describe('settlePortalToll', () => {
  it('waves a free portal through without touching the purse', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const meta = sim.players.get(a)!;
    meta.copper = 7;
    const free = { ...PORTAL, tollCopper: undefined };
    expect(settlePortalToll((sim as any).ctx, sim.entities.get(a)!, free)).toBe(true);
    expect(meta.copper).toBe(7);
  });

  it('refuses an entity with no purse silently (nobody to toast, nothing to charge)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const p = sim.entities.get(a)!;
    const orphan = { ...p, id: 424242 };
    const before = sim.events.length;
    expect(settlePortalToll((sim as any).ctx, orphan as typeof p, PORTAL)).toBe(false);
    expect(orphan.portalHoldId).toBeUndefined();
    expect(sim.events.length).toBe(before);
  });
});
