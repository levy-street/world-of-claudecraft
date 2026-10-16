import { describe, expect, it, vi } from 'vitest';

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

import { buddyOwned } from '../src/sim/buddies';
import { buddyDef } from '../src/sim/content/buddies';
import { buddyCosmeticDef } from '../src/sim/content/buddy_cosmetics';
import {
  BUDDY_COSMETIC_DEED_REWARDS,
  BUDDY_DEED_REWARDS,
  buddyCosmeticDeedOf,
  buddyDeedOf,
} from '../src/sim/content/buddy_sources';
import { DEEDS } from '../src/sim/content/deeds';
import { grantDeed } from '../src/sim/deeds';
import { Sim } from '../src/sim/sim';
import { VENDOR_TEST_WORLD } from './sim_shared';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

describe('achievement pets and looks ride the Book of Deeds', () => {
  it('every deed reward names a real deed and a real companion or look', () => {
    for (const [deedId, key] of Object.entries(BUDDY_DEED_REWARDS)) {
      expect(DEEDS[deedId], deedId).toBeTruthy();
      expect(buddyDef(key), key).not.toBeNull();
      expect(buddyDeedOf(key)).toBe(deedId);
    }
    for (const [deedId, id] of Object.entries(BUDDY_COSMETIC_DEED_REWARDS)) {
      expect(DEEDS[deedId], deedId).toBeTruthy();
      expect(buddyCosmeticDef(id), id).not.toBeNull();
      expect(buddyCosmeticDeedOf(id)).toBe(deedId);
    }
    expect(buddyDeedOf('crystal_lich')).toBeNull();
  });

  it('the max-logging deed grants the Stag, once, alongside the deed itself', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const meta = sim.players.get(pid)!;
    expect(BUDDY_DEED_REWARDS.prog_logging_100).toBe('stag');
    expect(grantDeed(sim.ctx, meta, 'prog_logging_100')).toBe(true);
    expect(meta.deedsEarned.has('prog_logging_100')).toBe(true);
    expect(buddyOwned(meta, 'stag')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('stag');
    const revealed = sim.tick().filter((ev) => ev.type === 'buddyRevealed');
    expect(revealed).toHaveLength(1);
    // A second grant of the same deed is a no-op on both sides.
    expect(grantDeed(sim.ctx, meta, 'prog_logging_100')).toBe(false);
  });

  it('the master angler deed grants Crystal Tide, the fishing pet', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const meta = sim.players.get(pid)!;
    grantDeed(sim.ctx, meta, 'prog_master_angler');
    expect(buddyOwned(meta, 'crystal_tide')).toBe(true);
  });

  it('a deed can unlock a look too', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const meta = sim.players.get(pid)!;
    const [deedId, look] = Object.entries(BUDDY_COSMETIC_DEED_REWARDS)[0];
    grantDeed(sim.ctx, meta, deedId);
    expect(meta.buddies.cosmetics.has(look)).toBe(true);
  });

  it('a character who earned the deed before the pet existed gets it at the next login', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const meta = sim.players.get(pid)!;
    grantDeed(sim.ctx, meta, 'prog_logging_100');
    const state = sim.serializeCharacter(pid)!;
    // Simulate a save from before the reward existed: the deed stays earned,
    // the collection is empty.
    state.buddies = undefined;
    const again = makeWorld();
    const pid2 = again.addPlayer('warrior', 'Owner', { state });
    again.tick();
    // The deed evaluator's retro pass skips deeds already earned, so the
    // reward table is reconciled at join (src/sim/buddy_drops.ts).
    expect(again.players.get(pid2)!.deedsEarned.has('prog_logging_100')).toBe(true);
    expect(buddyOwned(again.players.get(pid2)!, 'stag')).toBe(true);
  });
});
