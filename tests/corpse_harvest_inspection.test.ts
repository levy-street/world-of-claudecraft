// Intentional Gathering (PR3): the shared COLD corpse-harvest read
// (src/sim/professions/corpse_harvest_inspection.ts), driven through a REAL
// Sim exactly like tests/corpse_harvest_cast.test.ts (same fixture shape:
// EMPTY_TEST_WORLD, a Field-Kit-carrying player, a tagged forest_wolf
// corpse). Covers the public `corpseHarvestInfo` read: agreement with the
// real `startCorpseHarvest` admission, zero side effects on repeat, the
// unavailable-preference no-fallback rule, reservation display identity,
// output cloning, cross-instance disclosure refusal, the popup-vs-interact
// range split, and the shared tierBonus formula.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  CORPSE_HARVEST_POPUP_RANGE,
  corpseHarvestInfo,
} from '../src/sim/professions/corpse_harvest_inspection';
import { startCorpseHarvest } from '../src/sim/professions/corpse_harvest_session';
import { harvestConcentrationBonus } from '../src/sim/professions/gathering';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, type WorldContent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { placeInDungeon } from './helpers/instanced_contexts';
import { EMPTY_TEST_WORLD } from './sim_shared';

const CORPSE_TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

beforeAll(() => setActiveWorldContent(CORPSE_TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

function mustEntity(sim: Sim, pid: number): Entity {
  return expectDefined(sim.entities.get(pid));
}

function mustMeta(sim: Sim, pid: number): PlayerMeta {
  return expectDefined(sim.players.get(pid));
}

function placeCoherently(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
}

/** A dead, tagged (hide + fang) forest_wolf corpse. */
function spawnWolfCorpse(sim: Sim, id: number, x = 0, z = 0): Entity {
  const template = MOBS.forest_wolf;
  const pos = sim.groundPos(x, z);
  const mob = createMob(id, template, template.maxLevel, pos);
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  sim.entities.set(mob.id, mob);
  return mob;
}

function setup(seed = 21) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: CORPSE_TEST_WORLD });
  const a = sim.addPlayer('warrior', 'Alpha');
  const b = sim.addPlayer('warrior', 'Bravo');
  sim.tick();
  for (const pid of [a, b]) {
    placeCoherently(sim, mustEntity(sim, pid), 0, 0);
    sim.addItem('field_kit', 1, pid);
  }
  const mob = spawnWolfCorpse(sim, 9999);
  return { sim, a, b, mob };
}

function fillBags(sim: Sim, pid: number): void {
  const m = mustMeta(sim, pid);
  const cap = bagCapacity(m.bags);
  const gearIds = Object.values(ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(gearIds[i % gearIds.length], 1, pid);
    i++;
  }
}

function drawCounter(sim: Sim): { stop(): number } {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  return {
    stop() {
      sim.rng.setObserver(null);
      return draws;
    },
  };
}

/** Spies on `ctx.countItem` itself (the SimContext callback `evaluateCorpseHarvest`
 *  actually calls for the field-kit/bag-adjacent scan), not `sim.countItem`:
 *  `ctx` binds that method once at construction, so patching the instance
 *  method afterward would silently miss every call routed through `ctx`. */
function countItemSpy(sim: Sim): { calls(): number } {
  let calls = 0;
  const real = sim.ctx.countItem.bind(sim.ctx);
  sim.ctx.countItem = (...args: Parameters<typeof sim.ctx.countItem>) => {
    calls++;
    return real(...args);
  };
  return { calls: () => calls };
}

describe('agreement with the real start admission', () => {
  it('a fully eligible actor reads a null denial, matching a real successful start', () => {
    const { sim, a, mob } = setup();
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info?.denial).toBeNull();
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
  });

  it('no Field Kit: reads no_field_kit, matching the real refusal', () => {
    const { sim, a, mob } = setup();
    sim.removeItem('field_kit', 1, a);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)?.denial).toBe('no_field_kit');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });

  it('dead actor: reads actor_dead, matching the real refusal', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).dead = true;
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)?.denial).toBe('actor_dead');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });

  it('in combat: reads actor_in_combat, matching the real refusal', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).inCombat = true;
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)?.denial).toBe('actor_in_combat');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });

  it('already reserved by another actor: reads reserved, matching the real refusal', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)?.denial).toBe('reserved');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });

  it('full bags: reads bags_full, matching the real refusal', () => {
    const { sim, a, mob } = setup();
    fillBags(sim, a);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)?.denial).toBe('bags_full');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });

  it('a preference naming a material this body does not carry: reads material_unavailable, matching the real refusal', () => {
    const { sim, a, mob } = setup();
    sim.setHarvestPreference('homespun_cloth', a);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)?.denial).toBe('material_unavailable');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });
});

describe('missing/non-corpse guard: null, never a disclosed view, and no bag/tool scan paid', () => {
  it('a living mob (not a corpse at all) reads null, not a view with a denial', () => {
    const { sim, a, mob } = setup();
    mob.dead = false;
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });

  it('an owned pet corpse reads null', () => {
    const { sim, a, mob } = setup();
    mob.ownerId = a;
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });

  it('a non-mob entity id (a player) reads null', () => {
    const { sim, a, mob } = setup();
    mob.kind = 'player';
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });

  it('an already-decayed corpse reads null', () => {
    const { sim, a, mob } = setup();
    mob.corpseTimer = 0;
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });

  it('a non-finite (NaN) actor position reads null, even in the open world', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).pos.x = Number.NaN;
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });

  it('rejected queries never scan bags/tools or draw rng: field-kit/inventory reads and rng stay untouched', () => {
    const { sim, a, mob } = setup();
    mob.dead = false; // living: refused before evaluateCorpseHarvest's bag/tool scan runs
    const invBefore = mustMeta(sim, a).inventory.length;
    const spy = countItemSpy(sim);

    const counter = drawCounter(sim);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
    expect(counter.stop()).toBe(0);
    expect(spy.calls()).toBe(0);
    expect(mustMeta(sim, a).inventory.length).toBe(invBefore);
  });

  it('the same scan-spy stays untouched for a nonfinite-position rejection too', () => {
    const { sim, a, mob } = setup();
    mustEntity(sim, a).pos.x = Number.NaN;
    const spy = countItemSpy(sim);

    const counter = drawCounter(sim);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
    expect(counter.stop()).toBe(0);
    expect(spy.calls()).toBe(0);
  });
});

describe('zero side effects: a repeated read never mutates anything', () => {
  it('reading the same corpse many times draws no rng and leaves claim/reservation/cast/inventory untouched', () => {
    const { sim, a, mob } = setup();
    const meta = mustMeta(sim, a);
    const before = sim.countItem('rough_hide', a) + sim.countItem('wolf_fang', a);

    const counter = drawCounter(sim);
    for (let i = 0; i < 10; i++) corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(counter.stop()).toBe(0);

    expect(mob.harvestClaimedBy).toBeNull();
    expect(mob.corpseHarvestState?.reservedBy ?? null).toBeNull();
    expect(mustEntity(sim, a).castingAbility).toBeNull();
    expect(meta.corpseHarvestSession).toBeNull();
    expect(sim.countItem('rough_hide', a) + sim.countItem('wolf_fang', a)).toBe(before);
    // The corpse is still fully harvestable afterward: no phantom claim.
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(true);
  });

  it('reading while a reservation is held by someone else never touches that reservation', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
    const reservedBefore = mob.corpseHarvestState?.reservedBy;

    for (let i = 0; i < 5; i++) corpseHarvestInfo(sim.ctx, mob.id, a);

    expect(mob.corpseHarvestState?.reservedBy).toBe(reservedBefore);
  });
});

describe('unavailable preference: never silently falls back to All', () => {
  it('the raw stored (unavailable) preference is reported verbatim, and tierBonus is zero', () => {
    const { sim, a, mob } = setup();
    sim.setHarvestPreference('homespun_cloth', a);
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info?.preference).toEqual({ kind: 'material', itemId: 'homespun_cloth' });
    expect(info?.tierBonus).toBe(0);
  });
});

describe('reservation display identity', () => {
  it("a non-owning viewer sees the reserving actor's public name and self:false", () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info?.reservation).toEqual({ name: mustMeta(sim, b).name, self: false });
  });

  it('the reserving actor viewing their own reservation sees self:true', () => {
    const { sim, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
    const info = corpseHarvestInfo(sim.ctx, mob.id, b);
    expect(info?.reservation).toEqual({ name: mustMeta(sim, b).name, self: true });
  });

  it('carries no entity id, character id, priority key, or corpse life token', () => {
    const { sim, a, b, mob } = setup();
    expect(startCorpseHarvest(sim.ctx, mob.id, b)).toBe(true);
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info?.reservation).toBeDefined();
    const keys = Object.keys(info?.reservation ?? {});
    expect(keys.sort()).toEqual(['name', 'self']);
  });
});

describe('cloned output: no caller can mutate sim state through the returned view', () => {
  it('mutating the returned componentTags array does not affect the real content table', () => {
    const { sim, a, mob } = setup();
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info).not.toBeNull();
    const realTags = MOBS.forest_wolf.componentTags ?? [];
    const before = [...realTags];
    const mutable = info?.componentTags as string[];
    mutable.push('mutated');
    expect(MOBS.forest_wolf.componentTags).toEqual(before);
  });

  it('two separate reads never return the same array/object instances', () => {
    const { sim, a, mob } = setup();
    const first = corpseHarvestInfo(sim.ctx, mob.id, a);
    const second = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(first?.componentTags).not.toBe(second?.componentTags);
  });
});

describe('no cross-instance disclosure', () => {
  it('an actor inside a dungeon reading an open-world corpse gets null, not a denial', () => {
    const { sim, a, mob } = setup();
    placeInDungeon(sim, a);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });
});

describe('popup range (7) vs the real start range (INTERACT_RANGE)', () => {
  it('within the popup band but beyond INTERACT_RANGE: a real denial (out_of_range), not null', () => {
    const { sim, a, mob } = setup();
    const between = (INTERACT_RANGE + CORPSE_HARVEST_POPUP_RANGE) / 2;
    placeCoherently(sim, mustEntity(sim, a), between, 0);
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info).not.toBeNull();
    expect(info?.denial).toBe('out_of_range');
    expect(startCorpseHarvest(sim.ctx, mob.id, a)).toBe(false);
  });

  it('beyond the popup band entirely: null, no usable answer at all', () => {
    const { sim, a, mob } = setup();
    placeCoherently(sim, mustEntity(sim, a), CORPSE_HARVEST_POPUP_RANGE + 1, 0);
    expect(corpseHarvestInfo(sim.ctx, mob.id, a)).toBeNull();
  });
});

describe('tierBonus matches the shared harvestConcentrationBonus formula exactly', () => {
  it('an All preference (spread) reports zero bonus', () => {
    const { sim, a, mob } = setup();
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info?.tierBonus).toBe(0);
  });

  it('concentrating on one of two tagged materials reports the same bonus harvestConcentrationBonus computes directly', () => {
    const { sim, a, mob } = setup();
    sim.setHarvestPreference('rough_hide', a);
    const tags = MOBS.forest_wolf.componentTags ?? [];
    const expected =
      harvestConcentrationBonus(tags, ['hide']) - harvestConcentrationBonus(tags, []);
    const info = corpseHarvestInfo(sim.ctx, mob.id, a);
    expect(info?.tierBonus).toBe(expected);
    expect(info?.tierBonus).toBeGreaterThan(0);
  });
});
