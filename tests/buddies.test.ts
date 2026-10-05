import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so importing server/game needs no Postgres, mirroring
// tests/mounts.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { bagCapacity } from '../src/sim/bags';
import {
  attachPendingBuddy,
  buddyItemId,
  buddyOwned,
  grantBuddy,
  ownedBuddies,
  restoreBuddyCollection,
  revealPendingBuddies,
  serializeBuddyCollection,
  summonBuddy,
  toggleBuddy,
  useBuddyToken,
} from '../src/sim/buddies';
import { BUDDIES, BUDDY_KEYS, buddyDef, normalizeBuddyKey } from '../src/sim/content/buddies';
import { buddyTemplateId } from '../src/sim/content/buddy_mobs';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { useItem } from '../src/sim/items';
import {
  BUDDY_FOLLOW_BACK,
  BUDDY_FOLLOW_RIGHT,
  buddyFollowTarget,
  buddyOf,
  isBuddyMob,
} from '../src/sim/pet/buddy_ai';
import {
  advanceBuddyErrandWalk,
  BUDDY_ERRAND_GIVE_UP_SECONDS,
  BUDDY_ERRAND_SET_ASIDE_SECONDS,
  BUDDY_LOOT_RANGE,
  BUDDY_SEARCH_FIND_SECONDS,
  BUDDY_SEARCH_SECONDS,
  BUDDY_SEARCH_STALL_SECONDS,
  BUDDY_SEARCH_STAND_OFF,
  buddyLootTarget,
  isBuddySearching,
  newBuddyErrand,
  shouldBeginBuddySearch,
  shouldGiveUpBuddyErrand,
} from '../src/sim/pet/buddy_autoloot';
import { petOf } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import {
  BUDDY_SEARCH_CAST_ID,
  DT,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type SimEvent,
  type Vec3,
} from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

function join(sim: Sim): number {
  const pid = sim.addPlayer('warrior', 'Owner');
  sim.tick();
  return pid;
}

function drain(sim: Sim, type: SimEvent['type']): SimEvent[] {
  return sim.tick().filter((ev) => ev.type === type);
}

describe('buddy catalog', () => {
  it('every BuddyDef.key matches its own record key', () => {
    for (const [key, def] of Object.entries(BUDDIES)) expect(def.key).toBe(key);
  });

  it('every catalog buddy has exactly one grant token, and it names the buddy back', () => {
    for (const key of BUDDY_KEYS) {
      const itemId = buddyItemId(key);
      expect(itemId, `${key} has no whistle token`).not.toBeNull();
    }
  });

  it('buddyDef/normalizeBuddyKey resolve known ids and reject unknown ones', () => {
    expect(buddyDef('horse')?.name).toBe('Tug, the Warhorse');
    expect(buddyDef('not_a_buddy')).toBeNull();
    expect(normalizeBuddyKey('forgemaw')).toBe('forgemaw');
    expect(normalizeBuddyKey('not_a_buddy')).toBe('');
    expect(normalizeBuddyKey(null)).toBe('');
    expect(normalizeBuddyKey(undefined)).toBe('');
  });
});

describe('buddy ownership: a per-character collection flag, never an item', () => {
  it('a fresh player owns nothing; a grant attaches the companion in catalog order', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(ownedBuddies(meta)).toEqual([]);
    expect(buddyOwned(meta, 'horse')).toBe(false);

    expect(grantBuddy(sim.ctx, pid, 'forgemaw')).toBe(true);
    expect(grantBuddy(sim.ctx, pid, 'horse')).toBe(true);
    expect(ownedBuddies(meta)).toEqual(['horse', 'forgemaw']); // catalog order
    expect(buddyOwned(meta, 'horse')).toBe(true);
  });

  it('a whistle in the bags does NOT own the buddy any more', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    sim.addItem('whistle_horse', 1, pid);
    expect(buddyOwned(meta, 'horse')).toBe(false);
    meta.bank.inventory.push({ itemId: 'whistle_forgemaw', count: 1 });
    expect(buddyOwned(meta, 'forgemaw')).toBe(false);
  });

  it('a grant is idempotent, announces once, and summons the companion', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const before = meta.wireRev;
    expect(grantBuddy(sim.ctx, pid, 'horse')).toBe(true);
    expect(grantBuddy(sim.ctx, pid, 'horse')).toBe(false);
    expect(meta.wireRev).toBe(before + 1);
    const revealed = drain(sim, 'buddyRevealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toMatchObject({ type: 'buddyRevealed', pid, key: 'horse' });
    expect(sim.entities.get(pid)!.buddyKey).toBe('horse');
    expect(buddyOf(sim.ctx, pid)?.templateId).toBe(buddyTemplateId('horse'));
  });

  it('unknown keys are never owned or granted', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(grantBuddy(sim.ctx, pid, 'not_a_buddy')).toBe(false);
    expect(buddyOwned(meta, 'not_a_buddy')).toBe(false);
  });
});

describe('grant tokens: a whistle attaches the companion and is consumed', () => {
  it('using the whistle grants the buddy and removes the token', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    sim.addItem('whistle_horse', 1, pid);
    useItem(sim.ctx, 'whistle_horse', pid);
    expect(buddyOwned(meta, 'horse')).toBe(true);
    expect(meta.inventory.some((s) => s.itemId === 'whistle_horse')).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('horse');
  });

  it('a duplicate token is refused and NOT consumed', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    grantBuddy(sim.ctx, pid, 'horse');
    sim.tick();
    sim.addItem('whistle_horse', 1, pid);
    expect(useBuddyToken(sim.ctx, pid, 'whistle_horse')).toBe(false);
    expect(meta.inventory.some((s) => s.itemId === 'whistle_horse')).toBe(true);
    const errors = drain(sim, 'error');
    expect(
      errors.some((ev) => 'text' in ev && ev.text === 'You already have that companion.'),
    ).toBe(true);
  });

  it('a retired cosmetic charm is refused without consumption or an unlock', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('charm_stag_gilded', 1, pid);
    useItem(sim.ctx, 'charm_stag_gilded', pid);
    expect(sim.countItem('charm_stag_gilded', pid)).toBe(1);
  });
});

describe('summonBuddy: pick a collected buddy, pick it again to dismiss', () => {
  it('summons an owned buddy instantly, with no channel', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    toggleBuddy(sim.ctx, pid);
    expect(summonBuddy(sim.ctx, pid, 'horse')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('horse');
  });

  it('summoning the active buddy dismisses it', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    expect(summonBuddy(sim.ctx, pid, 'horse')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });

  it('swapping straight to a different owned buddy is instant, no dismiss step', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    grantBuddy(sim.ctx, pid, 'forgemaw');
    summonBuddy(sim.ctx, pid, 'horse');
    expect(summonBuddy(sim.ctx, pid, 'forgemaw')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('forgemaw');
  });

  it('refuses an uncollected buddy with the collection refusal, and leaves the current one', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(summonBuddy(sim.ctx, pid, 'horse')).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
    const errors = drain(sim, 'error');
    expect(
      errors.some((ev) => 'text' in ev && ev.text === "You haven't collected that companion."),
    ).toBe(true);
  });

  it('an unknown catalog key is refused', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(summonBuddy(sim.ctx, pid, 'not_a_buddy')).toBe(false);
  });
});

describe('toggleBuddy: dismiss, or bring the last summoned one back', () => {
  it('dismisses the active buddy, then re-summons the same one', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    expect(toggleBuddy(sim.ctx, pid)).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
    expect(toggleBuddy(sim.ctx, pid)).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('horse');
  });

  it('does nothing with nothing collected', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(toggleBuddy(sim.ctx, pid)).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });
});

describe('pending companions: the boss-roll win before its reveal', () => {
  it('attaches once with a presence line, and a reveal makes it owned and summoned', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(attachPendingBuddy(sim.ctx, pid, 'crystal_lich', 'world', { x: 1, z: 2 })).toBe(true);
    expect(attachPendingBuddy(sim.ctx, pid, 'crystal_lich', 'world', { x: 1, z: 2 })).toBe(false);
    expect(meta.buddies.pending).toEqual([{ key: 'crystal_lich', source: 'world', x: 1, z: 2 }]);
    expect(buddyOwned(meta, 'crystal_lich')).toBe(false);
    const presence = drain(sim, 'buddyPresence');
    expect(presence).toHaveLength(1);
    expect(presence[0]).toMatchObject({ pid, key: 'crystal_lich' });

    expect(revealPendingBuddies(sim.ctx, pid, () => false)).toEqual([]);
    expect(revealPendingBuddies(sim.ctx, pid)).toEqual(['crystal_lich']);
    expect(meta.buddies.pending).toEqual([]);
    expect(buddyOwned(meta, 'crystal_lich')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('crystal_lich');
    expect(drain(sim, 'buddyRevealed')).toHaveLength(1);
  });

  it('an owned companion never goes pending again', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    expect(attachPendingBuddy(sim.ctx, pid, 'crystal_lich', 'instance', { x: 0, z: 0 })).toBe(
      false,
    );
  });
});

describe('persistence: the collection round-trips through the character save', () => {
  it('serializes absent while empty, and restores exactly what was saved', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(serializeBuddyCollection(meta.buddies)).toBeNull();
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    attachPendingBuddy(sim.ctx, pid, 'forgemaw', 'instance', { x: 3, z: 4 });
    const saved = serializeBuddyCollection(meta.buddies)!;
    expect(saved).toEqual({
      owned: ['crystal_lich'],
      pending: [{ key: 'forgemaw', source: 'instance', x: 3, z: 4 }],
      last: 'crystal_lich',
    });
    const restored = restoreBuddyCollection(JSON.parse(JSON.stringify(saved)));
    expect([...restored.owned]).toEqual(['crystal_lich']);
    expect(restored.pending).toEqual([{ key: 'forgemaw', source: 'instance', x: 3, z: 4 }]);
    expect(restored.last).toBe('crystal_lich');
  });

  it('drops retired ownership and all legacy cosmetic state', () => {
    const restored = restoreBuddyCollection({
      owned: ['crystal_lich', 'retired_buddy'],
      cosmetics: ['crystal_lich_frostbound', 'no_such_look'],
      equipped: { crystal_lich: 'no_such_look', forgemaw: 'forgemaw_ashen' },
      pending: [
        { key: 'crystal_lich', source: 'world' },
        { key: 'gone', source: 'world' },
      ],
      last: 'retired_buddy',
    });
    expect([...restored.owned]).toEqual(['crystal_lich']);
    // An owned companion is never also pending.
    expect(restored.pending).toEqual([]);
    expect(restored.last).toBe('');
    expect(serializeBuddyCollection(restored)).toEqual({ owned: ['crystal_lich'] });
  });

  it('rides Sim.serializeCharacter and comes back through addPlayer', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    const state = sim.serializeCharacter(pid)!;
    expect(state.buddies).toEqual({
      owned: ['crystal_lich'],
      last: 'crystal_lich',
    });
    const again = makeWorld();
    const pid2 = again.addPlayer('warrior', 'Owner', { state });
    again.tick();
    expect(again.ownedBuddiesFor(pid2)).toEqual(['crystal_lich']);
  });
});

describe('legacy buddy cosmetics', () => {
  it('loads an owned companion in its base color and drops the archived wardrobe', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const state = sim.serializeCharacter(pid)!;
    state.buddies = {
      owned: ['crystal_lich'],
      cosmetics: ['crystal_lich_frostbound'],
      equipped: { crystal_lich: 'crystal_lich_frostbound' },
      last: 'crystal_lich',
    };
    const again = makeWorld();
    const restoredId = again.addPlayer('warrior', 'Owner', { state });
    expect(buddyOf(again.ctx, restoredId)?.color).toBe(MOBS.buddy_crystal_lich.color);
    expect(again.serializeCharacter(restoredId)!.buddies).toEqual({
      owned: ['crystal_lich'],
      last: 'crystal_lich',
    });
  });
});

describe('IWorldBuddies facade (offline Sim)', () => {
  it('the collection reads and the two commands ride the primary player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: VENDOR_TEST_WORLD });
    sim.tick();
    const pid = sim.player.id;
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    expect(sim.ownedBuddies()).toEqual(['crystal_lich']);
    expect(sim.pendingBuddies()).toEqual([]);
    sim.toggleBuddy();
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
    sim.summonBuddy('crystal_lich');
    expect(sim.entities.get(pid)!.buddyKey).toBe('crystal_lich');
  });
});

describe('buddy entity: real, server-simulated, heels like a hunter pet', () => {
  it('spawns a real owned, non-hostile mob entity on summon', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    const buddy = buddyOf(sim.ctx, pid);
    expect(buddy).not.toBeNull();
    expect(buddy!.kind).toBe('mob');
    expect(buddy!.ownerId).toBe(pid);
    expect(buddy!.hostile).toBe(false);
    expect(buddy!.templateId).toBe(buddyTemplateId('horse'));
    expect(isBuddyMob(buddy!)).toBe(true);
  });

  it('dismissing despawns the entity, not just the flag', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    const buddy = buddyOf(sim.ctx, pid)!;
    summonBuddy(sim.ctx, pid, 'horse');
    expect(buddyOf(sim.ctx, pid)).toBeNull();
    expect(sim.entities.has(buddy.id)).toBe(false);
  });

  it('swapping to a different buddy despawns the old entity and spawns the new one', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    grantBuddy(sim.ctx, pid, 'forgemaw');
    summonBuddy(sim.ctx, pid, 'horse');
    const first = buddyOf(sim.ctx, pid)!;
    summonBuddy(sim.ctx, pid, 'forgemaw');
    const second = buddyOf(sim.ctx, pid)!;
    expect(second.id).not.toBe(first.id);
    expect(sim.entities.has(first.id)).toBe(false);
    expect(second.templateId).toBe(buddyTemplateId('forgemaw'));
  });

  it('heels back onto its right-and-back offset after the owner walks away', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    const owner = sim.entities.get(pid)!;
    owner.pos.x += 20;
    for (let i = 0; i < 120; i++) sim.tick();
    const buddy = buddyOf(sim.ctx, pid)!;
    const sinF = Math.sin(owner.facing);
    const cosF = Math.cos(owner.facing);
    const targetX = owner.pos.x - BUDDY_FOLLOW_RIGHT * cosF - BUDDY_FOLLOW_BACK * sinF;
    const targetZ = owner.pos.z + BUDDY_FOLLOW_RIGHT * sinF - BUDDY_FOLLOW_BACK * cosF;
    const dx = buddy.pos.x - targetX;
    const dz = buddy.pos.z - targetZ;
    expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThan(3.6);
    expect(Math.hypot(targetX - owner.pos.x, targetZ - owner.pos.z)).toBeGreaterThan(1);
  });

  it('never registers as the owner’s combat pet (petOf stays null)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'horse');
    expect(petOf(sim.ctx, pid)).toBeNull();
  });
});

// Buddy autoloot (2026-09-08 owner request): the toggle on the buddy's own
// target-frame menu sends the buddy out to loot the OWNER'S OWN corpses inside
// BUDDY_LOOT_RANGE and bring the loot back to the owner's bags. The rules that
// matter are the ownership rule ("no otros": never a stranger's corpse, never
// even a party-mate's tap) and the leash rule (range measured from the OWNER,
// so the buddy cannot be baited off across the map).
describe('buddy autoloot', () => {
  // A dead, lootable wolf at `pos`, tapped by `tappedBy` (null = untapped).
  function corpseAt(sim: Sim, id: number, pos: Vec3, tappedBy: number | null): Entity {
    const template = MOBS.forest_wolf;
    const mob = createMob(id, template, template.maxLevel, { ...pos });
    mob.dead = true;
    mob.aiState = 'dead';
    mob.corpseTimer = 9999;
    mob.respawnTimer = 9999;
    mob.lootable = true;
    mob.tappedById = tappedBy;
    mob.loot = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] };
    sim.ctx.addEntity(mob);
    return mob;
  }

  function summonHorse(sim: Sim, pid: number): Entity {
    grantBuddy(sim.ctx, pid, 'horse');
    return buddyOf(sim.ctx, pid)!;
  }

  it('is off until the menu arms it, and the toggle survives a re-summon', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(sim.entities.get(pid)!.buddyAutoloot).toBe(false);
    sim.setBuddyAutolootFor(pid, true);
    expect(sim.entities.get(pid)!.buddyAutoloot).toBe(true);
    summonHorse(sim, pid);
    toggleBuddy(sim.ctx, pid);
    // Dismissing the buddy is not "disable autoloot": the preference is the
    // player's, not the individual follower's.
    expect(sim.entities.get(pid)!.buddyAutoloot).toBe(true);
    sim.setBuddyAutolootFor(pid, false);
    expect(sim.entities.get(pid)!.buddyAutoloot).toBe(false);
  });

  it('walks to the owner’s own corpse and loots it into the OWNER’s bags', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90001,
      { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    sim.setBuddyAutolootFor(pid, true);
    const before = sim.countItem('wolf_fang', pid);
    for (let i = 0; i < 200 && sim.entities.get(corpse.id)?.loot; i++) sim.tick();
    // The loot is the owner's; the buddy carries nothing of its own.
    expect(sim.countItem('wolf_fang', pid)).toBe(before + 1);
    expect(corpse.loot).toBeNull();
    // And it was the BUDDY that made the trip, not the owner.
    expect(dist2d(buddy.pos, corpse.pos)).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(dist2d(owner.pos, corpse.pos)).toBeGreaterThan(INTERACT_RANGE);
  });

  it('heels home again once there is nothing left to fetch', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    corpseAt(sim, 90002, { x: owner.pos.x + 12, y: owner.pos.y, z: owner.pos.z }, pid);
    sim.setBuddyAutolootFor(pid, true);
    for (let i = 0; i < 400; i++) sim.tick();
    const target = buddyFollowTarget(owner);
    expect(dist2d(buddy.pos, target)).toBeLessThan(3.6);
  });

  it('never touches a corpse that is not the owner’s, even armed and in range', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const stranger = sim.addPlayer('warrior', 'Stranger');
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90003,
      { x: owner.pos.x + 10, y: owner.pos.y, z: owner.pos.z },
      stranger,
    );
    sim.setBuddyAutolootFor(pid, true);
    for (let i = 0; i < 200; i++) sim.tick();
    expect(corpse.loot?.items[0]?.count).toBe(1);
    expect(sim.countItem('wolf_fang', pid)).toBe(0);
    // It did not even set out: it is still standing on its heel offset.
    expect(dist2d(buddy.pos, buddyFollowTarget(owner))).toBeLessThan(3.6);
    expect(buddyLootTarget(sim.ctx, owner)).toBeNull();
  });

  it('ignores an owned corpse beyond BUDDY_LOOT_RANGE of the OWNER', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    summonHorse(sim, pid);
    const far = corpseAt(
      sim,
      90004,
      { x: owner.pos.x + BUDDY_LOOT_RANGE + 10, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    sim.setBuddyAutolootFor(pid, true);
    expect(buddyLootTarget(sim.ctx, owner)).toBeNull();
    // Walk the owner close enough and the same corpse becomes the errand.
    owner.pos.x = far.pos.x - 10;
    sim.ctx.rebucket(owner);
    expect(buddyLootTarget(sim.ctx, owner)?.id).toBe(far.id);
  });

  // The search (2026-10-05 owner request): the errand has a visible middle. The
  // buddy walks right up to the corpse, stands on it under the
  // BUDDY_SEARCH_CAST_ID cast (the state the renderer plays the Search clip
  // off), and the loot lands at the clip's "found it" beat.
  function tickUntilSearching(sim: Sim, buddy: Entity, max = 300): void {
    for (let i = 0; i < max && !isBuddySearching(buddy); i++) sim.tick();
  }
  const FIND_TICKS = Math.round(BUDDY_SEARCH_FIND_SECONDS / DT);
  const SEARCH_TICKS = Math.round(BUDDY_SEARCH_SECONDS / DT);

  it('walks right up to the corpse and searches it, standing still and facing it', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90010,
      { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    sim.setBuddyAutolootFor(pid, true);
    tickUntilSearching(sim, buddy);
    expect(buddy.castingAbility).toBe(BUDDY_SEARCH_CAST_ID);
    expect(buddy.castTotal).toBe(BUDDY_SEARCH_SECONDS);
    expect(buddy.castRemaining).toBe(BUDDY_SEARCH_SECONDS);
    expect(buddy.castTargetId).toBe(corpse.id);
    // ON the corpse, not parked at the generic heel distance.
    const d = dist2d(buddy.pos, corpse.pos);
    expect(d).toBeLessThanOrEqual(BUDDY_SEARCH_STAND_OFF);
    // Nose to the corpse: forward is (sin f, cos f).
    const toward =
      Math.sin(buddy.facing) * (corpse.pos.x - buddy.pos.x) +
      Math.cos(buddy.facing) * (corpse.pos.z - buddy.pos.z);
    expect(toward).toBeCloseTo(d, 5);
    // And it does not shuffle while it searches.
    const at = { x: buddy.pos.x, z: buddy.pos.z };
    for (let i = 0; i < 20; i++) sim.tick();
    expect(isBuddySearching(buddy)).toBe(true);
    expect(buddy.pos.x).toBe(at.x);
    expect(buddy.pos.z).toBe(at.z);
  });

  it('lands the loot at the find beat, not on arrival, then holds until the clip ends', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90011,
      { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    sim.setBuddyAutolootFor(pid, true);
    tickUntilSearching(sim, buddy);
    expect(FIND_TICKS).toBeLessThan(SEARCH_TICKS);
    for (let i = 0; i < FIND_TICKS - 1; i++) sim.tick();
    // One tick short of the beat: standing on it is not having found it.
    expect(sim.countItem('wolf_fang', pid)).toBe(0);
    expect(corpse.loot?.items[0]?.count).toBe(1);
    sim.tick();
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
    expect(corpse.loot).toBeNull();
    // The rest of the clip is the buddy enjoying the find: still searching,
    // found latch cleared so nothing can loot twice.
    expect(isBuddySearching(buddy)).toBe(true);
    expect(buddy.castTargetId).toBeNull();
    for (let i = 0; i < SEARCH_TICKS - FIND_TICKS - 1; i++) sim.tick();
    expect(isBuddySearching(buddy)).toBe(true);
    sim.tick();
    expect(isBuddySearching(buddy)).toBe(false);
    expect(buddy.castingAbility).toBeNull();
    expect(buddy.castRemaining).toBe(0);
    expect(buddy.castTotal).toBe(0);
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
  });

  it('clears a pile in one search: every owner corpse within reach comes up together', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const near = corpseAt(sim, 90012, { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z }, pid);
    const beside = corpseAt(
      sim,
      90013,
      { x: owner.pos.x + 15.5, y: owner.pos.y, z: owner.pos.z + 2 },
      pid,
    );
    // A stranger's corpse in the same pile stays exactly as it was.
    const stranger = sim.addPlayer('warrior', 'Stranger');
    const theirs = corpseAt(
      sim,
      90014,
      { x: owner.pos.x + 15.5, y: owner.pos.y, z: owner.pos.z - 2 },
      stranger,
    );
    sim.setBuddyAutolootFor(pid, true);
    tickUntilSearching(sim, buddy);
    for (let i = 0; i < FIND_TICKS; i++) sim.tick();
    expect(sim.countItem('wolf_fang', pid)).toBe(2);
    expect(near.loot).toBeNull();
    expect(beside.loot).toBeNull();
    expect(theirs.loot?.items[0]?.count).toBe(1);
  });

  it('abandons the search the moment the errand’s own rules lapse', () => {
    // Toggle off mid-search.
    {
      const sim = makeWorld();
      const pid = join(sim);
      const owner = sim.entities.get(pid)!;
      const buddy = summonHorse(sim, pid);
      const corpse = corpseAt(
        sim,
        90015,
        { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
        pid,
      );
      sim.setBuddyAutolootFor(pid, true);
      tickUntilSearching(sim, buddy);
      sim.setBuddyAutolootFor(pid, false);
      sim.tick();
      expect(isBuddySearching(buddy)).toBe(false);
      for (let i = 0; i < SEARCH_TICKS; i++) sim.tick();
      expect(corpse.loot?.items[0]?.count).toBe(1);
      expect(sim.countItem('wolf_fang', pid)).toBe(0);
    }
    // The owner walks off past the leash while the buddy is head-down.
    {
      const sim = makeWorld();
      const pid = join(sim);
      const owner = sim.entities.get(pid)!;
      const buddy = summonHorse(sim, pid);
      const corpse = corpseAt(
        sim,
        90016,
        { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
        pid,
      );
      sim.setBuddyAutolootFor(pid, true);
      tickUntilSearching(sim, buddy);
      owner.pos.x = corpse.pos.x - (BUDDY_LOOT_RANGE + 5);
      sim.ctx.rebucket(owner);
      sim.tick();
      expect(isBuddySearching(buddy)).toBe(false);
      expect(corpse.loot?.items[0]?.count).toBe(1);
    }
    // The corpse stops being lootable (the owner took it themselves).
    {
      const sim = makeWorld();
      const pid = join(sim);
      const owner = sim.entities.get(pid)!;
      const buddy = summonHorse(sim, pid);
      const corpse = corpseAt(
        sim,
        90017,
        { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
        pid,
      );
      sim.setBuddyAutolootFor(pid, true);
      tickUntilSearching(sim, buddy);
      corpse.loot = null;
      corpse.lootable = false;
      sim.tick();
      expect(isBuddySearching(buddy)).toBe(false);
      expect(sim.countItem('wolf_fang', pid)).toBe(0);
    }
  });

  // Pin a buddy where it stands: a rooted follower still runs its errand, it
  // just cannot take a step (petFollow refuses to move it). Stands in for a
  // wall between it and the corpse.
  function pin(e: Entity): void {
    e.auras.push({
      id: 'test_root',
      name: 'Root',
      kind: 'root',
      remaining: 9999,
      duration: 9999,
      value: 0,
      sourceId: 0,
      school: 'nature',
    });
  }
  const STALL_TICKS = Math.round(BUDDY_SEARCH_STALL_SECONDS / DT);
  const GIVE_UP_TICKS = Math.round(BUDDY_ERRAND_GIVE_UP_SECONDS / DT);
  const SET_ASIDE_TICKS = Math.round(BUDDY_ERRAND_SET_ASIDE_SECONDS / DT);

  it('reads the walk by PROGRESS: only a new closest approach resets the clock', () => {
    // Reached the corpse: search at once, no stall needed.
    expect(shouldBeginBuddySearch(BUDDY_SEARCH_STAND_OFF, 0)).toBe(true);
    // Inside loot reach but short of the corpse: only a FULL stall searches from here.
    expect(shouldBeginBuddySearch(INTERACT_RANGE - 0.1, 0)).toBe(false);
    expect(shouldBeginBuddySearch(INTERACT_RANGE - 0.1, BUDDY_SEARCH_STALL_SECONDS - DT)).toBe(
      false,
    );
    expect(shouldBeginBuddySearch(INTERACT_RANGE - 0.1, BUDDY_SEARCH_STALL_SECONDS)).toBe(true);
    // Outside loot reach no amount of stalling is a search: the loot could not land.
    expect(shouldBeginBuddySearch(INTERACT_RANGE + 0.1, 99)).toBe(false);
    expect(BUDDY_SEARCH_STAND_OFF).toBeLessThan(INTERACT_RANGE);
    // Out there a long stall is a give-up instead, and only a FULL one.
    expect(shouldGiveUpBuddyErrand(INTERACT_RANGE + 0.1, BUDDY_ERRAND_GIVE_UP_SECONDS - DT)).toBe(
      false,
    );
    expect(shouldGiveUpBuddyErrand(INTERACT_RANGE + 0.1, BUDDY_ERRAND_GIVE_UP_SECONDS)).toBe(true);
    // Inside reach the errand never gives up: it searches.
    expect(shouldGiveUpBuddyErrand(INTERACT_RANGE - 0.1, 999)).toBe(false);
    expect(BUDDY_ERRAND_GIVE_UP_SECONDS).toBeGreaterThan(BUDDY_SEARCH_STALL_SECONDS);

    // The first read of a corpse sets the reference and runs no clock.
    const walk = newBuddyErrand();
    advanceBuddyErrandWalk(walk, 7, 4);
    expect(walk).toMatchObject({ corpseId: 7, best: 4, stall: 0 });
    // Sliding along a fence: on the move every tick, never closer than it has
    // already been. The clock runs through all of it (a clock that reset on
    // any movement never would), and a hair's gain is not progress either.
    for (const d of [4.2, 3.99, 4.1, 3.98, 4.3]) advanceBuddyErrandWalk(walk, 7, d);
    expect(walk.best).toBe(4);
    expect(walk.stall).toBeCloseTo(5 * DT, 9);
    // Real ground made: a new closest approach, and the clock starts over.
    advanceBuddyErrandWalk(walk, 7, 3.5);
    expect(walk).toMatchObject({ corpseId: 7, best: 3.5, stall: 0 });
    // A different corpse is a fresh read, even though it is farther away.
    advanceBuddyErrandWalk(walk, 7, 3.6);
    advanceBuddyErrandWalk(walk, 8, 20);
    expect(walk).toMatchObject({ corpseId: 8, best: 20, stall: 0 });
  });

  it('searches from where it stands when it cannot close the last few yards', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const buddy = summonHorse(sim, pid);
    pin(buddy);
    // Inside loot reach of the buddy, outside the stand-off it would walk to.
    const corpse = corpseAt(
      sim,
      90020,
      { x: buddy.pos.x + 3, y: buddy.pos.y, z: buddy.pos.z },
      pid,
    );
    const at = { x: buddy.pos.x, z: buddy.pos.z };
    sim.setBuddyAutolootFor(pid, true);
    // Tick one takes the first read; the clock then needs its full window.
    for (let i = 0; i < STALL_TICKS; i++) sim.tick();
    expect(isBuddySearching(buddy)).toBe(false);
    sim.tick();
    expect(isBuddySearching(buddy)).toBe(true);
    expect(buddy.castTargetId).toBe(corpse.id);
    expect(buddy.pos.x).toBe(at.x);
    expect(buddy.pos.z).toBe(at.z);
    // The loot still lands: the search began inside the loot's own reach.
    for (let i = 0; i < FIND_TICKS; i++) sim.tick();
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
    expect(corpse.loot).toBeNull();
    expect(buddy.buddyErrand?.setAside).toEqual([]);
  });

  it('gives up a corpse it cannot get within reach of, fetches the others, and tries it again later', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    pin(buddy);
    // The corpse nearest the OWNER, so it is the one the errand picks, placed
    // on the far side of the owner from the buddy: out of the buddy's reach.
    const away = Math.sign(owner.pos.x - buddy.pos.x) || 1;
    const walled = corpseAt(
      sim,
      90021,
      { x: owner.pos.x + away * 6, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    const open = corpseAt(
      sim,
      90022,
      { x: owner.pos.x - away * 16, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    expect(dist2d(buddy.pos, walled.pos)).toBeGreaterThan(INTERACT_RANGE);
    expect(buddyLootTarget(sim.ctx, owner)).toBe(walled);
    sim.setBuddyAutolootFor(pid, true);
    for (let i = 0; i < GIVE_UP_TICKS; i++) sim.tick();
    expect(buddy.buddyErrand?.setAside).toEqual([]);
    expect(isBuddySearching(buddy)).toBe(false);
    sim.tick();
    expect(buddy.buddyErrand?.setAside).toEqual([walled.id]);
    expect(isBuddySearching(buddy)).toBe(false);
    // Set aside, the corpse is passed over: the owner's other corpse is next,
    // although it is the farther of the two.
    expect(buddyLootTarget(sim.ctx, owner, buddy.buddyErrand?.setAside)).toBe(open);
    buddy.auras.length = 0;
    // Every tick from here is counted, to pin how long the memory lasts.
    let sinceSetAside = 0;
    const tick = (): void => {
      sim.tick();
      sinceSetAside++;
    };
    while (!isBuddySearching(buddy) && sinceSetAside < 300) tick();
    expect(buddy.castTargetId).toBe(open.id);
    for (let i = 0; i < SEARCH_TICKS; i++) tick();
    expect(open.loot).toBeNull();
    expect(walled.loot?.items[0]?.count).toBe(1);
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
    // The memory lapses exactly one window after the corpse was set aside (a
    // clean fetch in between does not extend it), and the walled corpse gets
    // another go. Free to move now, the buddy walks up and loots it.
    while ((buddy.buddyErrand?.setAside.length ?? 0) > 0 && sinceSetAside < SET_ASIDE_TICKS + 5) {
      tick();
    }
    expect(buddy.buddyErrand?.setAside).toEqual([]);
    expect(sinceSetAside).toBe(SET_ASIDE_TICKS);
    tickUntilSearching(sim, buddy);
    expect(buddy.castTargetId).toBe(walled.id);
    for (let i = 0; i < SEARCH_TICKS; i++) sim.tick();
    expect(walled.loot).toBeNull();
    expect(sim.countItem('wolf_fang', pid)).toBe(2);
  });

  it('sets aside a corpse the search took nothing off, instead of rummaging it forever', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const stranger = sim.addPlayer('mage', 'Stranger');
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    // A stranger's kill holding a personal drop for the owner, and copper. The
    // pre-check counts the copper as takeable; the loot rules pay copper only
    // on the tapping side, and the owner's bags are full for the drop. So the
    // corpse looks worth the walk and the rummage comes up empty.
    const dud = corpseAt(
      sim,
      90023,
      { x: owner.pos.x + 12, y: owner.pos.y, z: owner.pos.z },
      stranger,
    );
    dud.loot = { copper: 40, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [pid] }] };
    const meta = sim.meta(pid)!;
    const gear = Object.values(ITEMS)
      .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
      .map((d) => d.id);
    for (let i = 0; meta.inventory.length < bagCapacity(meta.bags); i++) {
      sim.addItem(gear[i % gear.length], 1, pid);
    }
    expect(sim.ctx.canAddItem('wolf_fang', 1, pid)).toBe(false);
    expect(buddyLootTarget(sim.ctx, owner)).toBe(dud);
    const copper = meta.copper;

    sim.setBuddyAutolootFor(pid, true);
    tickUntilSearching(sim, buddy);
    expect(buddy.castTargetId).toBe(dud.id);
    for (let i = 0; i < FIND_TICKS; i++) sim.tick();
    // Nothing came off it, and it is set aside from that moment.
    expect(meta.copper).toBe(copper);
    expect(dud.loot?.copper).toBe(40);
    expect(buddy.buddyErrand?.setAside).toEqual([dud.id]);
    // The rummage plays out, and is NOT followed by another one.
    let searches = 0;
    let wasSearching = isBuddySearching(buddy);
    for (let i = 0; i < SET_ASIDE_TICKS - FIND_TICKS - 20; i++) {
      sim.tick();
      const searching = isBuddySearching(buddy);
      if (searching && !wasSearching) searches++;
      wasSearching = searching;
    }
    expect(searches).toBe(0);
    expect(isBuddySearching(buddy)).toBe(false);
    // Left alone, it heeled home rather than standing over the corpse.
    expect(dist2d(buddy.pos, buddyFollowTarget(owner))).toBeLessThan(3.6);
  });

  it('holds a search on a corpse at exactly the leash distance instead of flapping', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90024,
      { x: owner.pos.x + BUDDY_LOOT_RANGE, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    expect(dist2d(owner.pos, corpse.pos)).toBe(BUDDY_LOOT_RANGE);
    expect(buddyLootTarget(sim.ctx, owner)).toBe(corpse);
    sim.setBuddyAutolootFor(pid, true);
    tickUntilSearching(sim, buddy);
    // Picked at the leash, it must also pass the search's own re-check there.
    for (let i = 0; i < FIND_TICKS - 1; i++) {
      sim.tick();
      expect(isBuddySearching(buddy)).toBe(true);
    }
    sim.tick();
    expect(corpse.loot).toBeNull();
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
  });

  it('ends the search the moment its owner dies', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90025,
      { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    sim.setBuddyAutolootFor(pid, true);
    tickUntilSearching(sim, buddy);
    owner.dead = true;
    sim.tick();
    expect(isBuddySearching(buddy)).toBe(false);
    expect(buddy.castRemaining).toBe(0);
    for (let i = 0; i < SEARCH_TICKS; i++) sim.tick();
    expect(corpse.loot?.items[0]?.count).toBe(1);
    expect(sim.countItem('wolf_fang', pid)).toBe(0);
  });

  it('stays home while the toggle is off, however close the owner’s corpse is', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonHorse(sim, pid);
    const corpse = corpseAt(
      sim,
      90005,
      { x: owner.pos.x + 8, y: owner.pos.y, z: owner.pos.z },
      pid,
    );
    for (let i = 0; i < 200; i++) sim.tick();
    expect(corpse.loot?.items[0]?.count).toBe(1);
    expect(dist2d(buddy.pos, buddyFollowTarget(owner))).toBeLessThan(3.6);
  });
});
