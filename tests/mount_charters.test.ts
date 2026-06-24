import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { ITEMS } from '../src/sim/data';
import { isCharterEligible } from '../src/sim/content/mounts';

// Phase 4 — the Mount Charter economy: the EARNED ownership track that lets a
// non-$WOC player permanently own a mount, without weakening the holder premise.

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function mount(sim: Sim, pid: number, mountId: string): void {
  // summon + ride out the 1.5s cast (no move input ⇒ the cast completes)
  expect(sim.summonMount(mountId, pid)).toBe(true);
  for (let i = 0; i < 40 && sim.entities.get(pid)!.mountId !== mountId; i++) sim.tick();
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}
function standAtMerchant(sim: Sim, pid: number): void {
  const m = merchant(sim);
  const e = sim.entities.get(pid)!;
  e.pos.x = m.pos.x; e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

describe('Mount Charters — the earned ownership track', () => {
  it('redeeming a Charter permanently grants the mount and consumes the deed', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Free'); // no $WOC: mountTier 0
    expect(sim.entities.get(pid)!.mountTier ?? 0).toBe(0);
    sim.addItem('charter_goldcrest', 1, pid);

    sim.useItem('charter_goldcrest', pid);

    expect(sim.players.get(pid)!.earnedMounts.has('goldcrest')).toBe(true);
    expect(sim.countItem('charter_goldcrest', pid)).toBe(0); // deed consumed
    // a tier-0 wallet can now summon the earned flyer
    expect(sim.summonMount('goldcrest', pid)).toBe(true);
  });

  it('an earned mount survives holdings dropping to zero (never downgraded)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Earner');
    sim.grantEarnedMount('emberhoof', pid); // earned, not held
    mount(sim, pid, 'emberhoof');
    expect(sim.entities.get(pid)!.mountId).toBe('emberhoof');

    sim.entities.get(pid)!.mountTier = 0; // wallet emptied
    sim.enforceMountEligibility(pid);

    expect(sim.entities.get(pid)!.mountId).toBe('emberhoof'); // still astride
  });

  it('a holder-only mount still gracefully downgrades when holdings fall', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Whale');
    sim.entities.get(pid)!.mountTier = 3; // covers Bronzeflank
    mount(sim, pid, 'bronzeflank');

    sim.entities.get(pid)!.mountTier = 1; // sold down to the entry rung
    sim.enforceMountEligibility(pid);

    expect(sim.entities.get(pid)!.mountId).toBe('ashmane'); // downgraded, not dismounted
  });

  it('minting is gated by holdings and lands a tradeable deed in the bags', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Holder');
    sim.entities.get(pid)!.mountTier = 2; // covers Emberhoof, not above

    expect(sim.mintCharter('emberhoof', pid)).toBe(true);
    expect(sim.countItem('charter_emberhoof', pid)).toBe(1);

    // a mount above the wallet's rung cannot be minted
    expect(sim.mintCharter('voidstrider', pid)).toBe(false);
    expect(sim.countItem('charter_voidstrider', pid)).toBe(0);
  });

  it('the tier-11 dragon is holder-exclusive — no Charter, no earning', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'NoDragon');
    sim.entities.get(pid)!.mountTier = 11; // even a full whale

    expect(isCharterEligible('sovereign')).toBe(false);
    expect(ITEMS['charter_sovereign']).toBeUndefined();
    expect(ITEMS['charter_goldcrest']).toBeDefined();
    expect(sim.mintCharter('sovereign', pid)).toBe(false);
    expect(sim.grantEarnedMount('sovereign', pid)).toBe(false);
    expect(sim.players.get(pid)!.earnedMounts.has('sovereign')).toBe(false);
  });

  it('a Charter changes hands for gold on the World Market, then redeems', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer('warrior', 'Seller');
    const buyer = sim.addPlayer('warrior', 'Buyer');
    standAtMerchant(sim, seller);
    standAtMerchant(sim, buyer);
    sim.addItem('charter_goldcrest', 1, seller);
    sim.players.get(buyer)!.copper = 100_000;
    sim.events.length = 0;

    sim.marketList('charter_goldcrest', 1, 5000, seller);
    const listing = sim.marketListings.find((l) => l.sellerKey === String(seller) && l.itemId === 'charter_goldcrest');
    expect(listing).toBeDefined();
    expect(sim.events.some((e) => e.type === 'error')).toBe(false);

    sim.marketBuy(listing!.id, buyer);
    expect(sim.countItem('charter_goldcrest', buyer)).toBe(1);

    sim.useItem('charter_goldcrest', buyer);
    expect(sim.players.get(buyer)!.earnedMounts.has('goldcrest')).toBe(true);
  });

  it('earned mounts persist across a save/load round-trip', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Saver');
    sim.grantEarnedMount('verdant', pid);
    const state = sim.serializeCharacter(pid)!;
    expect(state.earnedMounts).toContain('verdant');

    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state });
    expect(sim2.players.get(pid2)!.earnedMounts.has('verdant')).toBe(true);
    expect(sim2.summonMount('verdant', pid2)).toBe(true); // tier-0 wallet, earned flyer
  });

  it('redeeming a Charter you already own is rejected and keeps the deed', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Dup');
    sim.grantEarnedMount('goldcrest', pid);
    sim.addItem('charter_goldcrest', 1, pid);
    sim.events.length = 0;

    sim.useItem('charter_goldcrest', pid);

    expect(sim.events.some((e) => e.type === 'error')).toBe(true);
    expect(sim.countItem('charter_goldcrest', pid)).toBe(1); // not consumed
  });
});
