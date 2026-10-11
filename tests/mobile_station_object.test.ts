// The placed mobile station's WORLD OBJECT (src/sim/professions/
// mobile_station_object.ts): the Last Keep report was "you can brew at it
// but it is not visible", because a placed station lived only in the
// transient PlayerMeta slot. These pins cover the entity's existence and
// shape on both placement paths, the one-slot replace, the expiry reclaim
// riding updateFarming's 1 Hz guard, the room-teardown inverse cleanup, the
// leave path, and the templateId resolvers the client title and render plan
// derive from.
import { describe, expect, it } from 'vitest';
import { MOBILE_CRAFTING_STATION_DURATION_TICKS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { updateFarming } from '../src/sim/professions/farming';
import { placeMobileStationFromItem } from '../src/sim/professions/mobile_station';
import {
  isMobileStationTemplateId,
  mobileStationCraftOf,
  mobileStationItemOf,
  mobileStationTemplateId,
  updateMobileStationObjects,
} from '../src/sim/professions/mobile_station_object';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function makeSim(): Sim {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  return sim;
}

function metaOf(sim: Sim): PlayerMeta {
  return sim.players.get(sim.playerId) as PlayerMeta;
}

function placedObject(sim: Sim): Entity {
  const station = metaOf(sim).mobileStation;
  if (!station || station.entityId === undefined) throw new Error('no placed station object');
  const e = sim.entities.get(station.entityId);
  if (!e) throw new Error('station object entity missing');
  return e;
}

describe('a placed mobile station stands in the world as an object entity', () => {
  it('useItem on the Grand Cauldron spawns a non-lootable object at the placer named for it', () => {
    const sim = makeSim();
    sim.addItem('grand_cauldron', 1);
    sim.useItem('grand_cauldron');
    const e = placedObject(sim);
    expect(e.kind).toBe('object');
    expect(e.templateId).toBe(mobileStationTemplateId('grand_cauldron'));
    expect(e.name).toBe(metaOf(sim).name);
    expect(e.objectItemId).toBeNull();
    expect(e.lootable).toBe(false);
    expect(e.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    expect({ x: e.pos.x, z: e.pos.z }).toEqual({ x: sim.player.pos.x, z: sim.player.pos.z });
    // The permanent tool is never consumed by placing it.
    expect(sim.countItem('grand_cauldron')).toBe(1);
  });

  it('a specialization placement carries the craft as its suffix', () => {
    const sim = makeSim();
    placeMobileStationFromItem(sim.ctx, 'cooking', ITEMS.laden_hearth.name);
    expect(placedObject(sim).templateId).toBe(mobileStationTemplateId('cooking'));
  });

  it('replacing the station drops the previous object (one slot per player)', () => {
    const sim = makeSim();
    sim.addItem('grand_cauldron', 1);
    sim.addItem('laden_hearth', 1);
    sim.useItem('grand_cauldron');
    const first = placedObject(sim).id;
    sim.useItem('laden_hearth');
    const second = placedObject(sim);
    expect(second.id).not.toBe(first);
    expect(sim.entities.has(first)).toBe(false);
    expect(second.templateId).toBe(mobileStationTemplateId('laden_hearth'));
  });

  it('the 1 Hz farming sweep reclaims the object and the slot at expiry, not before', () => {
    const sim = makeSim();
    sim.addItem('laden_hearth', 1);
    sim.useItem('laden_hearth');
    const id = placedObject(sim).id;
    sim.tickCount = MOBILE_CRAFTING_STATION_DURATION_TICKS - 20;
    updateFarming(sim.ctx);
    expect(sim.entities.has(id)).toBe(true);
    expect(metaOf(sim).mobileStation).not.toBeNull();
    sim.tickCount = MOBILE_CRAFTING_STATION_DURATION_TICKS;
    updateFarming(sim.ctx);
    expect(sim.entities.has(id)).toBe(false);
    expect(metaOf(sim).mobileStation).toBeNull();
  });

  it('an object dropped by another path (a room teardown) releases the slot on the next sweep', () => {
    const sim = makeSim();
    sim.addItem('laden_hearth', 1);
    sim.useItem('laden_hearth');
    const id = placedObject(sim).id;
    sim.ctx.dropEntity(id);
    updateMobileStationObjects(sim.ctx);
    expect(metaOf(sim).mobileStation).toBeNull();
  });

  it('the leave path drops the object with the meta', () => {
    const sim = makeSim();
    sim.addItem('grand_cauldron', 1);
    sim.useItem('grand_cauldron');
    const id = placedObject(sim).id;
    sim.removePlayer(sim.playerId);
    expect(sim.entities.has(id)).toBe(false);
  });

  it('a dead placer places nothing and spawns nothing', () => {
    const sim = makeSim();
    sim.addItem('grand_cauldron', 1);
    const before = sim.entities.size;
    sim.player.dead = true;
    sim.useItem('grand_cauldron');
    expect(metaOf(sim).mobileStation).toBeNull();
    expect(sim.entities.size).toBe(before);
  });
});

describe('the templateId resolvers', () => {
  it('resolve an item suffix to its item and its craft', () => {
    const id = mobileStationTemplateId('grand_cauldron');
    expect(isMobileStationTemplateId(id)).toBe(true);
    expect(mobileStationItemOf(id)).toBe('grand_cauldron');
    expect(mobileStationCraftOf(id)).toBe('alchemy');
    expect(mobileStationCraftOf(mobileStationTemplateId('masters_field_forge'))).toBe(
      'weaponcrafting',
    );
  });

  it('resolve a craft suffix to the craft with no item', () => {
    const id = mobileStationTemplateId('cooking');
    expect(mobileStationItemOf(id)).toBeNull();
    expect(mobileStationCraftOf(id)).toBe('cooking');
  });

  it('answer null for anything else', () => {
    expect(isMobileStationTemplateId('farm_feast')).toBe(false);
    expect(mobileStationCraftOf('farm_feast')).toBeNull();
    expect(mobileStationCraftOf(mobileStationTemplateId('not_a_craft'))).toBeNull();
    expect(mobileStationCraftOf(null)).toBeNull();
  });
});
