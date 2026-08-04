// Reading Warden Hale's memorial: the anchor entity spawns on the monument,
// the interaction is range-gated by the def, and it emits the memorial event
// carrying only the def id (the roll of honour is content on both hosts, so it
// never crosses the wire).
import { describe, expect, it } from 'vitest';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { MEMORIALS, memorialRailProps } from '../src/sim/content/memorials';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const GULLHAVEN = 'gullhaven_warden_memorial';

function makeSim(): Sim {
  return new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true });
}

function memorialEntity(sim: Sim) {
  const found = [...sim.memorialEntityIds.entries()].find(([, id]) => id === GULLHAVEN);
  if (!found) throw new Error('memorial anchor entity did not spawn');
  return found[0];
}

function stand(sim: Sim, x: number, z: number): void {
  sim.player.pos.x = x;
  sim.player.pos.z = z;
  sim.player.pos.y = sim.groundPos(x, z).y;
  sim.player.prevPos = { ...sim.player.pos };
}

describe("reading Warden Hale's memorial", () => {
  const def = MEMORIALS.find((m) => m.id === GULLHAVEN);
  if (!def) throw new Error('Gullhaven memorial is not registered');

  it('spawns one readable anchor on the monument', () => {
    const sim = makeSim();
    const id = memorialEntity(sim);
    const e = sim.entities.get(id);
    expect(e?.kind).toBe('object');
    // decor prop, not a pickup: interactable with no item payload
    expect(e?.lootable).toBe(true);
    expect(e?.objectItemId).toBeNull();
    expect(Math.hypot((e?.pos.x ?? 0) - def.x, (e?.pos.z ?? 0) - def.z)).toBeLessThan(0.01);
  });

  it('emits the memorial event, carrying the id and no names, when read in range', () => {
    const sim = makeSim();
    const id = memorialEntity(sim);
    stand(sim, def.frontStandingPoint.x, def.frontStandingPoint.z);
    expect(sim.pickUpObject(id)).toBe(true);

    const events = sim.tick();
    const read = events.find((e: SimEvent) => e.type === 'memorial');
    expect(read).toBeDefined();
    if (read?.type !== 'memorial') throw new Error('expected a memorial event');
    expect(read.memorialId).toBe(GULLHAVEN);
    // the wire carries the id only; the names stay content-side
    expect(JSON.stringify(read)).not.toContain('Hale');
  });

  it('refuses to read from outside the def radius', () => {
    const sim = makeSim();
    const id = memorialEntity(sim);
    stand(sim, def.x, def.z + def.interactionRadius + 4);
    expect(sim.pickUpObject(id)).toBe(false);
    expect(sim.tick().some((e: SimEvent) => e.type === 'memorial')).toBe(false);
  });

  it('runs oldest first and ends on the newest name, with nothing after it', () => {
    // The Q0 line is canon: "The newest name on the plinth is a century old:
    // WARDEN HALE. There is room below it for more." Hale must stay last.
    const last = def.roll[def.roll.length - 1];
    expect(last).toEqual({ initials: 'J T', surname: 'Hale' });
    expect(def.roll.filter((r) => r.surname === 'Hale')).toHaveLength(1);
  });

  it('never lists a living warden or a piece of warden-issue gear', () => {
    const forbidden = new Set([
      'Coalfast',
      'Fenwick',
      'Kaldra',
      'Pell',
      'Cudgel',
      'Cuirass',
      'Dirk',
      'Grips',
      'Jerkin',
      'Leggings',
      'Sabatons',
      'Treads',
    ]);
    for (const entry of def.roll) expect(forbidden.has(entry.surname)).toBe(false);
  });
});

// The rail's props and its colliders are derived from one record
// (GULLHAVEN_MEMORIAL.rail). This is the pin that keeps them from drifting:
// a decorProp can only carry a CIRCLE, and a 4.0 long fence panel has no
// honest circle, which is why the rail was walk-through until it moved to
// oriented boxes emitted from the same numbers the renderer places from.
describe("the memorial rail's collision maps its geometry exactly", () => {
  const def = MEMORIALS.find((m) => m.id === GULLHAVEN);
  if (!def) throw new Error('Gullhaven memorial is not registered');

  it('gives every rail prop an oriented box at the same spot and angle', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(4242);
    const props = memorialRailProps(def);
    expect(props).toHaveLength(def.rail.posts.length + def.rail.panels.length);

    for (const prop of props) {
      const box = colliders.find(
        (c) => c.type === 'obb' && Math.abs(c.x - prop.x) < 1e-9 && Math.abs(c.z - prop.z) < 1e-9,
      );
      expect(box, `no collider for ${prop.key} at ${prop.x},${prop.z}`).toBeDefined();
      if (box?.type !== 'obb') throw new Error('expected an obb');
      expect(box.rot).toBeCloseTo(prop.rot ?? 0, 9);
      const isPost = prop.key === 'gardenIronPillar';
      expect(box.hw).toBeCloseTo(isPost ? def.rail.postHalf : def.rail.panelHalfLength, 9);
      expect(box.hd).toBeCloseTo(isPost ? def.rail.postHalf : def.rail.panelHalfDepth, 9);
    }
  });

  it('stands every rail member on the level pad, so no post is perched', () => {
    for (const member of [...def.rail.posts, ...def.rail.panels]) {
      expect(terrainHeight(member.x, member.z, 4242)).toBeCloseTo(10.4, 2);
    }
  });

  it('leaves no climb-blocking wall anywhere on the mound', () => {
    // PLAYER_MAX_CLIMB_SLOPE is 1.5: a 1yd step above it is an invisible wall.
    // Flattening the crown too far out built one (3.9yd, then 4.6yd) before the
    // pad was sized to the rail and nothing wider.
    let worst = 0;
    for (let a = 0; a < 360; a += 5) {
      for (let r = 1; r <= 18; r += 0.5) {
        const rad = (a * Math.PI) / 180;
        const inner = terrainHeight(805 + Math.cos(rad) * r, 139.6 + Math.sin(rad) * r, 4242);
        const outer = terrainHeight(
          805 + Math.cos(rad) * (r + 1),
          139.6 + Math.sin(rad) * (r + 1),
          4242,
        );
        worst = Math.max(worst, Math.abs(outer - inner));
      }
    }
    expect(worst).toBeLessThan(1.5);
  });
});
