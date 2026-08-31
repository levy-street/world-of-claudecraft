import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, LootSlot, WorldContent } from '../src/sim/types';

// End-to-end: a stranger cannot loot a tapped corpse until LOOT_FFA_DELAY seconds
// after it became lootable; once the owner-lock lapses, the loot goes free-for-all.

// The corpse under test is hand-built (createMob below), so none of the ambient
// world mobs/NPCs/objects matter here, and the FFA timeline ticks a minute-plus
// of world time. Strip the constructor-spawned entity content, keep the rest of
// BUILTIN_WORLD identical.
const LOOT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

function setup() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, world: LOOT_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const tapper = sim.addPlayer('warrior', 'Tapper');
  const stranger = sim.addPlayer('warrior', 'Stranger');
  sim.tick();

  // Both standing on the corpse so the interact-range gate is satisfied.
  for (const pid of [tapper, stranger]) {
    const e = internals.entities.get(pid)!;
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }

  // A dead, lootable wolf tapped (and not partied) by Tapper, holding shared loot.
  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.tappedById = tapper;
  mob.loot = { copper: 50, items: [{ itemId: 'minor_health_potion', count: 1 }] };
  mob.lootable = true;
  mob.lootFfaTimer = LOOT_FFA_DELAY;
  // keep the corpse present well past the FFA window so lootFfaTimer is the only gate
  // (despawn needs corpseTimer<=0 AND respawnTimer<=0).
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);

  return { sim, internals, tapper, stranger, mob };
}

const copperOf = (meta: PlayerMeta | undefined) => meta?.copper ?? 0;

describe('loot goes FFA one minute after a corpse becomes lootable', () => {
  it('blocks a stranger while the corpse is still owner-locked', () => {
    const { sim, internals, stranger, mob } = setup();
    expect(mob.lootFfaTimer).toBeGreaterThan(0);
    const before = copperOf(internals.players.get(stranger));
    sim.lootCorpse(mob.id, stranger);
    expect(copperOf(internals.players.get(stranger))).toBe(before); // nothing taken
    expect(mob.loot?.copper).toBe(50); // loot untouched
  });

  it('still lets the tapper loot during the lock', () => {
    const { sim, internals, tapper, mob } = setup();
    const before = copperOf(internals.players.get(tapper));
    sim.lootCorpse(mob.id, tapper);
    expect(copperOf(internals.players.get(tapper))).toBeGreaterThan(before);
  });

  it('lets a stranger loot once the owner-lock has lapsed', () => {
    const { sim, internals, stranger, mob } = setup();
    // Drive the dead-mob tick until the owner-lock lapses (just over one minute).
    for (let i = 0; i < 20 * (LOOT_FFA_DELAY + 1) && mob.lootFfaTimer > 0; i++) sim.tick();
    expect(mob.lootFfaTimer).toBeLessThanOrEqual(0);
    expect(mob.lootable).toBe(true); // corpse still present to be looted

    const before = copperOf(internals.players.get(stranger));
    sim.lootCorpse(mob.id, stranger);
    expect(copperOf(internals.players.get(stranger))).toBeGreaterThan(before);
  });

  it('is deterministic: same seed yields the same FFA timeline', () => {
    const run = () => {
      const { sim, mob } = setup();
      for (let i = 0; i < 20 * (LOOT_FFA_DELAY + 1) && mob.lootFfaTimer > 0; i++) sim.tick();
      return Math.max(0, Math.round(mob.lootFfaTimer * 1000));
    };
    expect(run()).toEqual(run());
    // two full FFA-delay runs: headroom under suite load
  }, 90_000);
});

// Regression: the FFA rights model and the loot-distribution strategies must agree.
// A corpse tapped by a PARTIED player and left to lapse used to be drained by the
// stranger who opened it while the party's own strategies (fair-split / round-robin /
// need-greed) handed the contents to the absent party, so the looter got nothing.

const COMMON_ITEM = 'worn_sword';
const PREMIUM_ITEM = 'greyjaw_hide_boots';

function setupPartiedTap(items: LootSlot[] = [{ itemId: COMMON_ITEM, count: 1 }]) {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, world: LOOT_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const tapper = sim.addPlayer('warrior', 'Tapper');
  const mate = sim.addPlayer('mage', 'Mate');
  const stranger = sim.addPlayer('rogue', 'Stranger');
  sim.partyInvite(mate, tapper);
  sim.partyAccept(mate);
  sim.tick();

  for (const pid of [tapper, mate, stranger]) {
    const e = internals.entities.get(pid)!;
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
  }

  const template = MOBS.forest_wolf;
  const mob = createMob(9999, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.tappedById = tapper;
  mob.lootRecipientIds = [tapper, mate];
  mob.loot = { copper: 50, items };
  mob.lootable = true;
  mob.lootFfaTimer = LOOT_FFA_DELAY;
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);

  return { sim, internals, tapper, mate, stranger, mob };
}

function runOutFfaLock(sim: Sim, mob: Entity): void {
  for (let i = 0; i < 20 * (LOOT_FFA_DELAY + 1) && mob.lootFfaTimer > 0; i++) sim.tick();
  expect(mob.lootFfaTimer).toBeLessThanOrEqual(0);
}

describe('an FFA corpse pays the looter, not the absent tapping party', () => {
  it('gives the stranger the copper and the common item, and the party nothing', () => {
    const { sim, internals, tapper, mate, stranger, mob } = setupPartiedTap();
    runOutFfaLock(sim, mob);

    const before = [tapper, mate, stranger].map((pid) => copperOf(internals.players.get(pid)));
    expect(sim.lootCorpse(mob.id, stranger)).toBe(true);

    expect(copperOf(internals.players.get(stranger)) - before[2]).toBe(50);
    expect(copperOf(internals.players.get(tapper))).toBe(before[0]);
    expect(copperOf(internals.players.get(mate))).toBe(before[1]);
    expect(sim.countItem(COMMON_ITEM, stranger)).toBe(1);
    expect(sim.countItem(COMMON_ITEM, tapper)).toBe(0);
    expect(sim.countItem(COMMON_ITEM, mate)).toBe(0);
    expect(mob.loot?.copper ?? 0).toBe(0);
    expect(mob.loot?.items.some((s) => s.itemId === COMMON_ITEM && s.count > 0) ?? false).toBe(
      false,
    );
  });

  it('hands a premium drop straight over instead of opening a need/greed roll', () => {
    const { sim, tapper, mate, stranger, mob } = setupPartiedTap([
      { itemId: PREMIUM_ITEM, count: 1 },
    ]);
    runOutFfaLock(sim, mob);
    sim.events.length = 0;

    expect(sim.lootCorpse(mob.id, stranger)).toBe(true);

    expect(sim.events.some((e) => e.type === 'lootRoll' || e.type === 'masterLoot')).toBe(false);
    expect(sim.ctx.pendingLootRolls.size).toBe(0);
    expect(sim.countItem(PREMIUM_ITEM, stranger)).toBe(1);
    expect(sim.countItem(PREMIUM_ITEM, tapper)).toBe(0);
    expect(sim.countItem(PREMIUM_ITEM, mate)).toBe(0);
  });

  it('still runs the party strategies when the tapper loots before the lock lapses', () => {
    const { sim, internals, tapper, mate, mob } = setupPartiedTap();

    const before = [tapper, mate].map((pid) => copperOf(internals.players.get(pid)));
    expect(sim.lootCorpse(mob.id, tapper)).toBe(true);

    // fair-split: 50 copper over the two kill-time recipients.
    expect(copperOf(internals.players.get(tapper)) - before[0]).toBe(25);
    expect(copperOf(internals.players.get(mate)) - before[1]).toBe(25);
    // round-robin: the common item goes to exactly one of them, by the party cursor.
    expect(sim.countItem(COMMON_ITEM, tapper) + sim.countItem(COMMON_ITEM, mate)).toBe(1);
  });

  it('still runs the party strategies when a member loots after the lock lapses', () => {
    const { sim, internals, tapper, mate, mob } = setupPartiedTap();
    runOutFfaLock(sim, mob);

    const before = [tapper, mate].map((pid) => copperOf(internals.players.get(pid)));
    expect(sim.lootCorpse(mob.id, mate)).toBe(true);

    expect(copperOf(internals.players.get(tapper)) - before[0]).toBe(25);
    expect(copperOf(internals.players.get(mate)) - before[1]).toBe(25);
    expect(sim.countItem(COMMON_ITEM, tapper) + sim.countItem(COMMON_ITEM, mate)).toBe(1);
  });

  it('still opens a need/greed roll for a premium drop the tapping party loots', () => {
    const { sim, tapper, mob } = setupPartiedTap([{ itemId: PREMIUM_ITEM, count: 1 }]);
    runOutFfaLock(sim, mob);
    sim.events.length = 0;

    expect(sim.lootCorpse(mob.id, tapper)).toBe(true);

    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(true);
    expect(sim.ctx.pendingLootRolls.size).toBe(1);
  });
});
