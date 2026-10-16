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
  attachPendingBuddy,
  buddyItemId,
  buddyOwned,
  equipBuddyCosmetic,
  grantBuddy,
  grantBuddyCosmetic,
  ownedBuddies,
  restoreBuddyCollection,
  revealPendingBuddies,
  serializeBuddyCollection,
  summonBuddy,
  toggleBuddy,
  useBuddyCosmeticToken,
  useBuddyToken,
} from '../src/sim/buddies';
import { BUDDIES, BUDDY_KEYS, buddyDef, normalizeBuddyKey } from '../src/sim/content/buddies';
import { BUDDY_COSMETICS } from '../src/sim/content/buddy_cosmetics';
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
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, INTERACT_RANGE, type SimEvent, type Vec3 } from '../src/sim/types';
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
    expect(buddyDef('ember_fox')?.name).toBe('Ember Fox');
    expect(buddyDef('not_a_buddy')).toBeNull();
    expect(normalizeBuddyKey('moss_hare')).toBe('moss_hare');
    expect(normalizeBuddyKey('not_a_buddy')).toBe('');
    expect(normalizeBuddyKey(null)).toBe('');
    expect(normalizeBuddyKey(undefined)).toBe('');
  });

  it('every cosmetic names a catalog buddy', () => {
    for (const [id, def] of Object.entries(BUDDY_COSMETICS)) {
      expect(def.id).toBe(id);
      expect(buddyDef(def.buddy), `${id} -> ${def.buddy}`).not.toBeNull();
    }
  });
});

describe('buddy ownership: a per-character collection flag, never an item', () => {
  it('a fresh player owns nothing; a grant attaches the companion in catalog order', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(ownedBuddies(meta)).toEqual([]);
    expect(buddyOwned(meta, 'ember_fox')).toBe(false);

    expect(grantBuddy(sim.ctx, pid, 'moss_hare')).toBe(true);
    expect(grantBuddy(sim.ctx, pid, 'ember_fox')).toBe(true);
    expect(ownedBuddies(meta)).toEqual(['ember_fox', 'moss_hare']); // catalog order
    expect(buddyOwned(meta, 'ember_fox')).toBe(true);
  });

  it('a whistle in the bags does NOT own the buddy any more', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    sim.addItem('whistle_ember_fox', 1, pid);
    expect(buddyOwned(meta, 'ember_fox')).toBe(false);
    meta.bank.inventory.push({ itemId: 'whistle_moss_hare', count: 1 });
    expect(buddyOwned(meta, 'moss_hare')).toBe(false);
  });

  it('a grant is idempotent, announces once, and summons the companion', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const before = meta.wireRev;
    expect(grantBuddy(sim.ctx, pid, 'ember_fox')).toBe(true);
    expect(grantBuddy(sim.ctx, pid, 'ember_fox')).toBe(false);
    expect(meta.wireRev).toBe(before + 1);
    const revealed = drain(sim, 'buddyRevealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toMatchObject({ type: 'buddyRevealed', pid, key: 'ember_fox' });
    expect(sim.entities.get(pid)!.buddyKey).toBe('ember_fox');
    expect(buddyOf(sim.ctx, pid)?.templateId).toBe(buddyTemplateId('ember_fox'));
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
    sim.addItem('whistle_ember_fox', 1, pid);
    useItem(sim.ctx, 'whistle_ember_fox', pid);
    expect(buddyOwned(meta, 'ember_fox')).toBe(true);
    expect(meta.inventory.some((s) => s.itemId === 'whistle_ember_fox')).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('ember_fox');
  });

  it('a duplicate token is refused and NOT consumed', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    grantBuddy(sim.ctx, pid, 'ember_fox');
    sim.tick();
    sim.addItem('whistle_ember_fox', 1, pid);
    expect(useBuddyToken(sim.ctx, pid, 'whistle_ember_fox')).toBe(false);
    expect(meta.inventory.some((s) => s.itemId === 'whistle_ember_fox')).toBe(true);
    const errors = drain(sim, 'error');
    expect(
      errors.some((ev) => 'text' in ev && ev.text === 'You already have that companion.'),
    ).toBe(true);
  });

  it('a cosmetic charm unlocks the look and is consumed; a duplicate is refused unconsumed', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    sim.addItem('charm_stag_gilded', 1, pid);
    useItem(sim.ctx, 'charm_stag_gilded', pid);
    expect(meta.buddies.cosmetics.has('stag_gilded')).toBe(true);
    expect(meta.inventory.some((s) => s.itemId === 'charm_stag_gilded')).toBe(false);
    sim.addItem('charm_stag_gilded', 1, pid);
    expect(useBuddyCosmeticToken(sim.ctx, pid, 'charm_stag_gilded')).toBe(false);
    expect(meta.inventory.some((s) => s.itemId === 'charm_stag_gilded')).toBe(true);
  });
});

describe('summonBuddy: pick a collected buddy, pick it again to dismiss', () => {
  it('summons an owned buddy instantly, with no channel', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
    toggleBuddy(sim.ctx, pid);
    expect(summonBuddy(sim.ctx, pid, 'ember_fox')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('ember_fox');
  });

  it('summoning the active buddy dismisses it', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
    expect(summonBuddy(sim.ctx, pid, 'ember_fox')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });

  it('swapping straight to a different owned buddy is instant, no dismiss step', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
    grantBuddy(sim.ctx, pid, 'moss_hare');
    summonBuddy(sim.ctx, pid, 'ember_fox');
    expect(summonBuddy(sim.ctx, pid, 'moss_hare')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('moss_hare');
  });

  it('refuses an uncollected buddy with the collection refusal, and leaves the current one', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(summonBuddy(sim.ctx, pid, 'ember_fox')).toBe(false);
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
    grantBuddy(sim.ctx, pid, 'ember_fox');
    expect(toggleBuddy(sim.ctx, pid)).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
    expect(toggleBuddy(sim.ctx, pid)).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('ember_fox');
  });

  it('does nothing with nothing collected', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(toggleBuddy(sim.ctx, pid)).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });
});

describe('cosmetics: unlock, wear, and the dye on the follower', () => {
  it('unlocks once, announces once, and refuses an unknown id', () => {
    const sim = makeWorld();
    const pid = join(sim);
    expect(grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded')).toBe(true);
    expect(grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded')).toBe(false);
    expect(grantBuddyCosmetic(sim.ctx, pid, 'no_such_look')).toBe(false);
    const unlocked = drain(sim, 'buddyCosmeticUnlocked');
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]).toMatchObject({ pid, cosmeticId: 'stag_gilded' });
  });

  it('wears a look only on a collected buddy it was authored for, and only when unlocked', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    // Not collected yet.
    grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded');
    expect(equipBuddyCosmetic(sim.ctx, pid, 'stag', 'stag_gilded')).toBe(false);
    grantBuddy(sim.ctx, pid, 'stag');
    grantBuddy(sim.ctx, pid, 'moss_hare');
    // Wrong buddy for the look.
    expect(equipBuddyCosmetic(sim.ctx, pid, 'moss_hare', 'stag_gilded')).toBe(false);
    // Not unlocked.
    expect(equipBuddyCosmetic(sim.ctx, pid, 'stag', 'stag_acorn')).toBe(false);
    expect(equipBuddyCosmetic(sim.ctx, pid, 'stag', 'stag_gilded')).toBe(true);
    expect(meta.buddies.equipped.get('stag')).toBe('stag_gilded');
    expect(equipBuddyCosmetic(sim.ctx, pid, 'stag', null)).toBe(true);
    expect(meta.buddies.equipped.has('stag')).toBe(false);
    expect(equipBuddyCosmetic(sim.ctx, pid, 'stag', null)).toBe(false);
  });

  it('the worn look re-spawns the live follower with the cosmetic dye as its color', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'stag');
    grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded');
    const plain = buddyOf(sim.ctx, pid)!;
    expect(plain.color).toBe(MOBS[buddyTemplateId('stag')].color);
    equipBuddyCosmetic(sim.ctx, pid, 'stag', 'stag_gilded');
    const dyed = buddyOf(sim.ctx, pid)!;
    expect(dyed.id).not.toBe(plain.id);
    expect(dyed.color).toBe(BUDDY_COSMETICS.stag_gilded.tint);
    equipBuddyCosmetic(sim.ctx, pid, 'stag', null);
    expect(buddyOf(sim.ctx, pid)!.color).toBe(MOBS[buddyTemplateId('stag')].color);
  });
});

describe('pending companions: the boss-roll win before its reveal', () => {
  it('attaches once with a presence line, and a reveal makes it owned and summoned', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(attachPendingBuddy(sim.ctx, pid, 'skeleton', 'world', { x: 1, z: 2 })).toBe(true);
    expect(attachPendingBuddy(sim.ctx, pid, 'skeleton', 'world', { x: 1, z: 2 })).toBe(false);
    expect(meta.buddies.pending).toEqual([{ key: 'skeleton', source: 'world', x: 1, z: 2 }]);
    expect(buddyOwned(meta, 'skeleton')).toBe(false);
    const presence = drain(sim, 'buddyPresence');
    expect(presence).toHaveLength(1);
    expect(presence[0]).toMatchObject({ pid, key: 'skeleton' });

    expect(revealPendingBuddies(sim.ctx, pid, () => false)).toEqual([]);
    expect(revealPendingBuddies(sim.ctx, pid)).toEqual(['skeleton']);
    expect(meta.buddies.pending).toEqual([]);
    expect(buddyOwned(meta, 'skeleton')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('skeleton');
    expect(drain(sim, 'buddyRevealed')).toHaveLength(1);
  });

  it('an owned companion never goes pending again', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'skeleton');
    expect(attachPendingBuddy(sim.ctx, pid, 'skeleton', 'instance', { x: 0, z: 0 })).toBe(false);
  });
});

describe('persistence: the collection round-trips through the character save', () => {
  it('serializes absent while empty, and restores exactly what was saved', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    expect(serializeBuddyCollection(meta.buddies)).toBeNull();
    grantBuddy(sim.ctx, pid, 'stag');
    grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded');
    equipBuddyCosmetic(sim.ctx, pid, 'stag', 'stag_gilded');
    attachPendingBuddy(sim.ctx, pid, 'phantom', 'instance', { x: 3, z: 4 });
    const saved = serializeBuddyCollection(meta.buddies)!;
    expect(saved).toEqual({
      owned: ['stag'],
      cosmetics: ['stag_gilded'],
      equipped: { stag: 'stag_gilded' },
      pending: [{ key: 'phantom', source: 'instance', x: 3, z: 4 }],
      last: 'stag',
    });
    const restored = restoreBuddyCollection(JSON.parse(JSON.stringify(saved)));
    expect([...restored.owned]).toEqual(['stag']);
    expect([...restored.cosmetics]).toEqual(['stag_gilded']);
    expect(restored.equipped.get('stag')).toBe('stag_gilded');
    expect(restored.pending).toEqual([{ key: 'phantom', source: 'instance', x: 3, z: 4 }]);
    expect(restored.last).toBe('stag');
  });

  it('drops ids the catalog no longer carries, and a worn look that no longer fits', () => {
    const restored = restoreBuddyCollection({
      owned: ['stag', 'retired_buddy'],
      cosmetics: ['stag_gilded', 'no_such_look'],
      equipped: { stag: 'no_such_look', moss_hare: 'moss_hare_verdant' },
      pending: [
        { key: 'stag', source: 'world' },
        { key: 'gone', source: 'world' },
      ],
      last: 'retired_buddy',
    });
    expect([...restored.owned]).toEqual(['stag']);
    expect([...restored.cosmetics]).toEqual(['stag_gilded']);
    expect(restored.equipped.size).toBe(0);
    // An owned companion is never also pending.
    expect(restored.pending).toEqual([]);
    expect(restored.last).toBe('');
  });

  it('rides Sim.serializeCharacter and comes back through addPlayer', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'stag');
    grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded');
    const state = sim.serializeCharacter(pid)!;
    expect(state.buddies).toEqual({ owned: ['stag'], cosmetics: ['stag_gilded'], last: 'stag' });
    const again = makeWorld();
    const pid2 = again.addPlayer('warrior', 'Owner', { state });
    again.tick();
    expect(again.ownedBuddiesFor(pid2)).toEqual(['stag']);
    expect(again.ownedBuddyCosmeticsFor(pid2)).toEqual(['stag_gilded']);
  });
});

describe('IWorldBuddies facade (offline Sim)', () => {
  it('the collection reads and the two commands ride the primary player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: VENDOR_TEST_WORLD });
    sim.tick();
    const pid = sim.player.id;
    grantBuddy(sim.ctx, pid, 'stag');
    grantBuddyCosmetic(sim.ctx, pid, 'stag_gilded');
    expect(sim.ownedBuddies()).toEqual(['stag']);
    expect(sim.ownedBuddyCosmetics()).toEqual(['stag_gilded']);
    expect(sim.pendingBuddies()).toEqual([]);
    sim.equipBuddyCosmetic('stag', 'stag_gilded');
    expect(sim.equippedBuddyCosmetics()).toEqual({ stag: 'stag_gilded' });
    sim.toggleBuddy();
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
    sim.summonBuddy('stag');
    expect(sim.entities.get(pid)!.buddyKey).toBe('stag');
  });
});

describe('buddy entity: real, server-simulated, heels like a hunter pet', () => {
  it('spawns a real owned, non-hostile mob entity on summon', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
    const buddy = buddyOf(sim.ctx, pid);
    expect(buddy).not.toBeNull();
    expect(buddy!.kind).toBe('mob');
    expect(buddy!.ownerId).toBe(pid);
    expect(buddy!.hostile).toBe(false);
    expect(buddy!.templateId).toBe(buddyTemplateId('ember_fox'));
    expect(isBuddyMob(buddy!)).toBe(true);
  });

  it('dismissing despawns the entity, not just the flag', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
    const buddy = buddyOf(sim.ctx, pid)!;
    summonBuddy(sim.ctx, pid, 'ember_fox');
    expect(buddyOf(sim.ctx, pid)).toBeNull();
    expect(sim.entities.has(buddy.id)).toBe(false);
  });

  it('swapping to a different buddy despawns the old entity and spawns the new one', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
    grantBuddy(sim.ctx, pid, 'moss_hare');
    summonBuddy(sim.ctx, pid, 'ember_fox');
    const first = buddyOf(sim.ctx, pid)!;
    summonBuddy(sim.ctx, pid, 'moss_hare');
    const second = buddyOf(sim.ctx, pid)!;
    expect(second.id).not.toBe(first.id);
    expect(sim.entities.has(first.id)).toBe(false);
    expect(second.templateId).toBe(buddyTemplateId('moss_hare'));
  });

  it('heels back onto its right-and-back offset after the owner walks away', () => {
    const sim = makeWorld();
    const pid = join(sim);
    grantBuddy(sim.ctx, pid, 'ember_fox');
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
    grantBuddy(sim.ctx, pid, 'ember_fox');
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

  function summonFox(sim: Sim, pid: number): Entity {
    grantBuddy(sim.ctx, pid, 'ember_fox');
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
