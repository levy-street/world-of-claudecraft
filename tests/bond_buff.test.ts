// Refer-a-friend bond buff + Summon a Friend (src/sim/bond_buff.ts,
// docs/prd/refer-a-friend.md): the server-stamped session entitlement, the
// partied + same-place XP multiplier on the grantXp funnel, and the cooldown
// teleport. The server-side stamping service is tested separately in
// tests/server/referral_bond.test.ts.
import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, zoneAt } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import { SUMMON_FRIEND_COOLDOWN_ID } from '../src/sim/summon_friend_cooldown';
import { clearCooldownsPreservingUnstuck, UNSTUCK_COOLDOWN_ID } from '../src/sim/unstuck_cooldown';
import { makeWorld, mustEntity, teleport } from './social_shared';

const BOND = (partnerCharacterIds: number[]) => ({
  partnerCharacterIds,
  multiplier: 2,
  summonCooldownSeconds: 60,
});

function mustMeta(sim: Sim, pid: number) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing meta for ${pid}`);
  return meta;
}

function makeBondedDuo(opts: { party?: boolean; stamp?: boolean } = {}) {
  const sim = makeWorld();
  const a = sim.addPlayer('warrior', 'Refa', { characterId: 101 });
  const b = sim.addPlayer('priest', 'Recb', { characterId: 202 });
  if (opts.party !== false) {
    sim.partyInvite(b, a);
    sim.partyAccept(b);
  }
  if (opts.stamp !== false) {
    sim.setPlayerBond(a, BOND([202]));
    sim.setPlayerBond(b, BOND([101]));
  }
  return { sim, a, b };
}

/** A probed overworld coordinate in a different zone than (fromX, fromZ). */
function otherZoneCoord(fromX: number, fromZ: number): { x: number; z: number } {
  const home = zoneAt(fromX, fromZ).id;
  for (let x = -1000; x < DUNGEON_X_THRESHOLD; x += 50) {
    for (let z = -1000; z <= 1000; z += 50) {
      if (zoneAt(x, z).id !== home) return { x, z };
    }
  }
  throw new Error('no second zone found');
}

describe('bond XP multiplier', () => {
  it('doubles XP for both sides while partied in the same zone', () => {
    const { sim, a, b } = makeBondedDuo();
    sim.grantXp(100, mustMeta(sim, a));
    sim.grantXp(100, mustMeta(sim, b));
    expect(mustMeta(sim, a).xp).toBe(200);
    expect(mustMeta(sim, b).xp).toBe(200);
  });

  it('grants base XP with no stamp (offline shape)', () => {
    const { sim, a } = makeBondedDuo({ stamp: false });
    sim.grantXp(100, mustMeta(sim, a));
    expect(mustMeta(sim, a).xp).toBe(100);
  });

  it('grants base XP when the partners are not partied', () => {
    const { sim, a } = makeBondedDuo({ party: false });
    sim.grantXp(100, mustMeta(sim, a));
    expect(mustMeta(sim, a).xp).toBe(100);
  });

  it('grants base XP when the partners are in different zones', () => {
    const { sim, a, b } = makeBondedDuo();
    const pa = mustEntity(sim, a);
    const away = otherZoneCoord(pa.pos.x, pa.pos.z);
    teleport(sim, b, away.x, away.z);
    sim.grantXp(100, mustMeta(sim, a));
    expect(mustMeta(sim, a).xp).toBe(100);
  });

  it('grants base XP when the stamped partner character is not in the party', () => {
    const { sim, a } = makeBondedDuo({ stamp: false });
    sim.setPlayerBond(a, BOND([999]));
    sim.grantXp(100, mustMeta(sim, a));
    expect(mustMeta(sim, a).xp).toBe(100);
  });

  it('multiplies the base award before rested draws down (kill XP)', () => {
    const { sim, a } = makeBondedDuo();
    const meta = mustMeta(sim, a);
    meta.restedXp = 50;
    sim.grantXp(100, meta, { fromKill: true });
    // base 100 doubles to 200, then rested tops up its full 50 pool.
    expect(meta.xp).toBe(250);
    expect(meta.restedXp).toBe(0);
  });

  it('a malformed stamp normalizes to null and grants base XP', () => {
    const { sim, a } = makeBondedDuo({ stamp: false });
    sim.setPlayerBond(a, { partnerCharacterIds: [], multiplier: 2, summonCooldownSeconds: 60 });
    expect(mustMeta(sim, a).bondBuff).toBeNull();
    sim.setPlayerBond(a, { partnerCharacterIds: [202], multiplier: 1, summonCooldownSeconds: 60 });
    expect(mustMeta(sim, a).bondBuff).toBeNull();
    sim.grantXp(100, mustMeta(sim, a));
    expect(mustMeta(sim, a).xp).toBe(100);
  });
});

describe('summon a friend', () => {
  it('teleports the partied partner to the summoner and starts the cooldown', () => {
    const { sim, a, b } = makeBondedDuo();
    const pa = mustEntity(sim, a);
    const pb = mustEntity(sim, b);
    teleport(sim, b, pa.pos.x + 200, pa.pos.z + 200);
    sim.summonFriend(a);
    const dx = pb.pos.x - pa.pos.x;
    const dz = pb.pos.z - pa.pos.z;
    expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThan(5);
    expect(pa.cooldowns.get(SUMMON_FRIEND_COOLDOWN_ID)).toBe(60);
    const texts = sim
      .tick()
      .filter((e) => e.type === 'log')
      .map((e) => (e as { text: string }).text);
    expect(texts).toContain('Recb answers your summons.');
    expect(texts).toContain('Refa summons you to their side.');
  });

  it('refuses while the cooldown is running', () => {
    const { sim, a, b } = makeBondedDuo();
    const pa = mustEntity(sim, a);
    teleport(sim, b, pa.pos.x + 200, pa.pos.z + 200);
    sim.summonFriend(a);
    sim.tick();
    teleport(sim, b, pa.pos.x + 200, pa.pos.z + 200);
    sim.summonFriend(a);
    const errors = sim
      .tick()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    expect(errors).toContain('Summon a Friend is still recovering.');
  });

  it('refuses with no bond, and with the partner outside the party', () => {
    const noBond = makeBondedDuo({ stamp: false });
    noBond.sim.summonFriend(noBond.a);
    expect(
      noBond.sim
        .tick()
        .filter((e) => e.type === 'error')
        .map((e) => (e as { text: string }).text),
    ).toContain('You have no recruit bond.');

    const noParty = makeBondedDuo({ party: false });
    noParty.sim.summonFriend(noParty.a);
    expect(
      noParty.sim
        .tick()
        .filter((e) => e.type === 'error')
        .map((e) => (e as { text: string }).text),
    ).toContain('Your bonded friend is not in your party.');
  });

  it('refuses to summon into or out of an instance', () => {
    const { sim, a, b } = makeBondedDuo();
    teleport(sim, b, DUNGEON_X_THRESHOLD + 50, 0);
    sim.summonFriend(a);
    const errors = sim
      .tick()
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    expect(errors).toContain('You cannot summon into or out of an instance.');
    // The partner did not move back to the overworld.
    expect(mustEntity(sim, b).pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
  });
});

describe('referral ladder title deeds', () => {
  it('grants every rung at or below the tier, idempotently', () => {
    const { sim, a } = makeBondedDuo({ stamp: false });
    const meta = mustMeta(sim, a);
    sim.grantReferralLadder(a, 1);
    expect(meta.deedsEarned.has('soc_recruiter')).toBe(true);
    expect(meta.deedsEarned.has('soc_realm_builder')).toBe(false);
    // Tier 3 back-fills the earlier rung and re-application is free.
    sim.grantReferralLadder(a, 3);
    sim.grantReferralLadder(a, 3);
    expect(meta.deedsEarned.has('soc_recruiter')).toBe(true);
    expect(meta.deedsEarned.has('soc_realm_builder')).toBe(true);
  });

  it('a zero or malformed tier grants nothing', () => {
    const { sim, a } = makeBondedDuo({ stamp: false });
    sim.grantReferralLadder(a, 0);
    sim.grantReferralLadder(a, -1);
    expect(mustMeta(sim, a).deedsEarned.has('soc_recruiter')).toBe(false);
  });
});

describe('summon cooldown across competitive resets', () => {
  it('clearCooldownsPreservingUnstuck preserves both hidden system timers', () => {
    const cooldowns = new Map<string, number>([
      ['some_ability', 10],
      [UNSTUCK_COOLDOWN_ID, 120],
      [SUMMON_FRIEND_COOLDOWN_ID, 300],
    ]);
    clearCooldownsPreservingUnstuck(cooldowns);
    expect(cooldowns.get('some_ability')).toBeUndefined();
    expect(cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(120);
    expect(cooldowns.get(SUMMON_FRIEND_COOLDOWN_ID)).toBe(300);
  });
});
