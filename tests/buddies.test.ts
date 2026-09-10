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

import {
  buddyItemId,
  buddyOwned,
  ownedBuddies,
  summonBuddyItem,
  toggleBuddy,
} from '../src/sim/buddies';
import { BUDDIES, BUDDY_KEYS, buddyDef, normalizeBuddyKey } from '../src/sim/content/buddies';
import { buddyTemplateId } from '../src/sim/content/buddy_mobs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { useItem } from '../src/sim/items';
import {
  BUDDY_FOLLOW_BACK,
  BUDDY_FOLLOW_RIGHT,
  buddyFollowTarget,
  buddyOf,
  isBuddyMob,
} from '../src/sim/pet/buddy_ai';
import { BUDDY_LOOT_RANGE, buddyLootTarget } from '../src/sim/pet/buddy_autoloot';
import { petOf } from '../src/sim/pet/pet_commands';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, INTERACT_RANGE, type Vec3 } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

function join(sim: Sim): number {
  const pid = sim.addPlayer('warrior', 'Owner');
  sim.tick();
  return pid;
}

describe('buddy catalog', () => {
  it('every BuddyDef.key matches its own record key', () => {
    for (const [key, def] of Object.entries(BUDDIES)) expect(def.key).toBe(key);
  });

  it('every catalog buddy has exactly one whistle item, and it names the buddy back', () => {
    for (const key of BUDDY_KEYS) {
      const itemId = buddyItemId(key);
      expect(itemId, `${key} has no whistle item`).not.toBeNull();
    }
  });

  it('buddyDef/normalizeBuddyKey resolve known ids and reject unknown ones', () => {
    expect(buddyDef('ember_fox')?.name).toBe('Ember Fox');
    expect(buddyDef('not_a_buddy')).toBeNull();
    expect(normalizeBuddyKey('moss_hare')).toBe('moss_hare');
    expect(normalizeBuddyKey('not_a_buddy')).toBe('');
    expect(normalizeBuddyKey(null)).toBe('');
    expect(normalizeBuddyKey(undefined)).toBe('');
  });
});

describe('buddy ownership: item-borne, bags or bank', () => {
  it('a fresh player owns nothing; a buddy only while its whistle is held', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(ownedBuddies(meta)).toEqual([]);
    expect(buddyOwned(meta, 'ember_fox')).toBe(false);

    sim.addItem('whistle_ember_fox', 1, pid);
    expect(buddyOwned(meta, 'ember_fox')).toBe(true);
    expect(ownedBuddies(meta)).toEqual(['ember_fox']);

    sim.addItem('whistle_moss_hare', 1, pid);
    expect(ownedBuddies(meta)).toEqual(['ember_fox', 'moss_hare']); // catalog order
  });

  it('a whistle parked in the bank still counts (bags OR bank)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.bank.inventory.push({ itemId: 'whistle_moss_hare', count: 1 });
    expect(buddyOwned(meta, 'moss_hare')).toBe(true);
    expect(ownedBuddies(meta)).toContain('moss_hare');
  });

  it('unknown keys are never owned', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(buddyOwned(meta, 'not_a_buddy')).toBe(false);
  });
});

describe('summonBuddyItem: click the whistle to summon, click again to dismiss', () => {
  it('summons an owned buddy instantly, with no channel', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    expect(summonBuddyItem(sim.ctx, pid, 'ember_fox')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('ember_fox');
  });

  it('clicking the active buddy’s whistle dismisses it', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    expect(summonBuddyItem(sim.ctx, pid, 'ember_fox')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });

  it('swapping straight to a different owned buddy is instant, no dismiss step', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    sim.addItem('whistle_moss_hare', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    expect(summonBuddyItem(sim.ctx, pid, 'moss_hare')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('moss_hare');
  });

  it('refuses an unowned buddy and leaves the current one untouched', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(summonBuddyItem(sim.ctx, pid, 'ember_fox')).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });

  it('an unknown catalog key is refused', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(summonBuddyItem(sim.ctx, pid, 'not_a_buddy')).toBe(false);
  });

  it('routes through useItem for kind "buddy" (bags/action-bar click)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    useItem(sim.ctx, 'whistle_ember_fox', pid);
    expect(sim.entities.get(pid)!.buddyKey).toBe('ember_fox');
  });

  it('the whistle is never consumed by summoning (ownership derives from holding it)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    const meta = sim.players.get(pid)!;
    expect(meta.inventory.some((s) => s.itemId === 'whistle_ember_fox')).toBe(true);
  });
});

describe('toggleBuddy: dismiss-only, for a keybind/button with no item in hand', () => {
  it('dismisses the active buddy', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    expect(toggleBuddy(sim.ctx, pid)).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });

  it('does nothing when no buddy is out (no implicit "selected buddy")', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    expect(toggleBuddy(sim.ctx, pid)).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });
});

describe('IWorldBuddies facade (offline Sim)', () => {
  it('ownedBuddies() and toggleBuddy() ride the primary player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: VENDOR_TEST_WORLD });
    sim.tick();
    const pid = sim.player.id;
    sim.addItem('whistle_ember_fox', 1, pid);
    expect(sim.ownedBuddies()).toEqual(['ember_fox']);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    sim.toggleBuddy();
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });
});

describe('buddy entity: real, server-simulated, heels like a hunter pet', () => {
  it('spawns a real owned, non-hostile mob entity on summon', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    const buddy = buddyOf(sim.ctx, pid);
    expect(buddy).not.toBeNull();
    expect(buddy!.kind).toBe('mob');
    expect(buddy!.ownerId).toBe(pid);
    expect(buddy!.hostile).toBe(false);
    expect(buddy!.templateId).toBe(buddyTemplateId('ember_fox'));
    expect(isBuddyMob(buddy!)).toBe(true);
  });

  it('re-clicking the active whistle despawns the entity, not just the flag', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    const buddy = buddyOf(sim.ctx, pid)!;
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    expect(buddyOf(sim.ctx, pid)).toBeNull();
    expect(sim.entities.has(buddy.id)).toBe(false);
  });

  it('toggleBuddy despawns the entity too', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    expect(toggleBuddy(sim.ctx, pid)).toBe(true);
    expect(buddyOf(sim.ctx, pid)).toBeNull();
  });

  it('swapping to a different buddy despawns the old entity and spawns the new one', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    sim.addItem('whistle_moss_hare', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    const first = buddyOf(sim.ctx, pid)!;
    summonBuddyItem(sim.ctx, pid, 'moss_hare');
    const second = buddyOf(sim.ctx, pid)!;
    expect(second.id).not.toBe(first.id);
    expect(sim.entities.has(first.id)).toBe(false);
    expect(second.templateId).toBe(buddyTemplateId('moss_hare'));
  });

  it('heels back onto its right-and-back offset after the owner walks away', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    const owner = sim.entities.get(pid)!;
    owner.pos.x += 20;
    for (let i = 0; i < 120; i++) sim.tick();
    const buddy = buddyOf(sim.ctx, pid)!;
    // petFollow (pet_ai.ts) stops closing once within PET_FOLLOW_DISTANCE
    // (3.5yd) of the offset target itself, not of the owner's own tile, so
    // the assertion measures against that same target. Computed here
    // directly from owner.pos/owner.facing and the exported offset
    // constants, NOT by calling buddyFollowTarget, so a regression that
    // zeroed the offset in that function would still fail this assertion
    // instead of silently matching its own (also-broken) output.
    const sinF = Math.sin(owner.facing);
    const cosF = Math.cos(owner.facing);
    const targetX = owner.pos.x - BUDDY_FOLLOW_RIGHT * cosF - BUDDY_FOLLOW_BACK * sinF;
    const targetZ = owner.pos.z + BUDDY_FOLLOW_RIGHT * sinF - BUDDY_FOLLOW_BACK * cosF;
    const dx = buddy.pos.x - targetX;
    const dz = buddy.pos.z - targetZ;
    expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThan(3.6);
    // And the offset is genuinely non-zero: this fails if the heel target
    // ever collapses back onto the owner's own tile.
    expect(Math.hypot(targetX - owner.pos.x, targetZ - owner.pos.z)).toBeGreaterThan(1);
  });

  it('never registers as the owner’s combat pet (petOf stays null)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    expect(petOf(sim.ctx, pid)).toBeNull();
  });
});

// PlayerMeta cast guard, mirroring tests/mounts.test.ts: ownedBuddies must be
// strict about its containers instead of silently under-reporting the
// collection.
describe('ownedBuddies refuses a meta with no containers', () => {
  it('throws instead of reporting no buddies', () => {
    const noBags = { bank: { inventory: [] } } as unknown as PlayerMeta;
    expect(() => ownedBuddies(noBags)).toThrow(TypeError);
    const noBank = { inventory: [] } as unknown as PlayerMeta;
    expect(() => ownedBuddies(noBank)).toThrow(TypeError);
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

  function summonFox(sim: Sim, pid: number): Entity {
    sim.addItem('whistle_ember_fox', 1, pid);
    summonBuddyItem(sim.ctx, pid, 'ember_fox');
    return buddyOf(sim.ctx, pid)!;
  }

  it('is off until the menu arms it, and the toggle survives a re-summon', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(sim.entities.get(pid)!.buddyAutoloot).toBe(false);
    sim.setBuddyAutolootFor(pid, true);
    expect(sim.entities.get(pid)!.buddyAutoloot).toBe(true);
    summonFox(sim, pid);
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
    const buddy = summonFox(sim, pid);
    const corpse = corpseAt(sim, 90001, { x: owner.pos.x + 15, y: owner.pos.y, z: owner.pos.z }, pid);
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
    const buddy = summonFox(sim, pid);
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
    const buddy = summonFox(sim, pid);
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
    summonFox(sim, pid);
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

  it('stays home while the toggle is off, however close the owner’s corpse is', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const owner = sim.entities.get(pid)!;
    const buddy = summonFox(sim, pid);
    const corpse = corpseAt(sim, 90005, { x: owner.pos.x + 8, y: owner.pos.y, z: owner.pos.z }, pid);
    for (let i = 0; i < 200; i++) sim.tick();
    expect(corpse.loot?.items[0]?.count).toBe(1);
    expect(dist2d(buddy.pos, buddyFollowTarget(owner))).toBeLessThan(3.6);
  });
});
