import { describe, expect, it, vi } from 'vitest';
import { filterRoutableEvents } from '../server/event_frame';
import {
  canInteractWithReferralFriend,
  canSummonReferralFriend,
  type ReferralSummonSession,
} from '../server/referral_summon';
import { ZONES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const session = (pid: number, accountId: number): ReferralSummonSession => ({
    pid,
    accountId,
    left: false,
    escrowQuarantined: false,
    jailed: null,
    spectating: null,
    blockListLoaded: true,
    blockedAccountIds: new Set(),
  });
  const a = session(sim.addPlayer('warrior', 'One'), 10);
  const b = session(sim.addPlayer('priest', 'Two'), 20);
  return { sim, a, b };
}
describe('bound friend privacy and summon admission', () => {
  it('requires both privacy caches and respects both block directions', () => {
    const { a, b } = setup();
    expect(canInteractWithReferralFriend(a, b)).toBe(true);
    for (const [actor, other] of [
      [a, b],
      [b, a],
    ]) {
      actor.blockListLoaded = false;
      expect(canInteractWithReferralFriend(a, b)).toBe(false);
      actor.blockListLoaded = true;
      actor.blockedAccountIds.add(other.accountId);
      expect(canInteractWithReferralFriend(a, b)).toBe(false);
      actor.blockedAccountIds.clear();
      actor.left = true;
      expect(canInteractWithReferralFriend(a, b)).toBe(false);
      actor.left = false;
      actor.escrowQuarantined = true;
      expect(canInteractWithReferralFriend(a, b)).toBe(false);
      actor.escrowQuarantined = false;
    }
    b.accountId = a.accountId;
    expect(canInteractWithReferralFriend(a, b)).toBe(false);
  });
  it('refuses combat, death, jail, spectating and casting on either side', () => {
    const { sim, a, b } = setup();
    expect(canSummonReferralFriend(sim, a, b)).toBe(true);
    for (const actor of [a, b]) {
      for (const flag of ['jailed', 'spectating'] as const) {
        actor[flag] = {} as NonNullable<ReferralSummonSession['jailed']> &
          NonNullable<ReferralSummonSession['spectating']>;
        expect(canSummonReferralFriend(sim, a, b)).toBe(false);
        actor[flag] = null;
      }
      const entity = sim.entities.get(actor.pid)!;
      for (const flag of ['dead', 'inCombat'] as const) {
        entity[flag] = true;
        expect(canSummonReferralFriend(sim, a, b)).toBe(false);
        entity[flag] = false;
      }
      entity.castingAbility = 'fireball';
      expect(canSummonReferralFriend(sim, a, b)).toBe(false);
      entity.castingAbility = null;
    }
    vi.spyOn(sim.ctx, 'duelFor').mockReturnValue({} as never);
    expect(canSummonReferralFriend(sim, a, b)).toBe(false);
  });
  it('cannot cross the tutorial exit or summon into an instance', () => {
    const { sim, a, b } = setup();
    const target = sim.entities.get(b.pid)!;
    const other = ZONES.find((zone) => zone.id === 'zone2') ?? ZONES[1];
    target.pos.x = ((other.xMin ?? -100) + (other.xMax ?? 100)) / 2;
    target.pos.z = (other.zMin + other.zMax) / 2;
    expect(canSummonReferralFriend(sim, a, b)).toBe(false);
    sim.meta(a.pid)!.questsDone.add('q_ps_set_sail');
    sim.meta(b.pid)!.questsDone.add('q_ps_set_sail');
    expect(canSummonReferralFriend(sim, a, b)).toBe(true);
    target.pos.x = 1e9;
    expect(canSummonReferralFriend(sim, a, b)).toBe(false);
  });
});
it('never serializes private referral evidence to players', () => {
  const publicEvent = { type: 'error', text: 'example' } as unknown as SimEvent;
  const ordinary = [publicEvent];
  expect(filterRoutableEvents(ordinary)).toBe(ordinary);
  expect(
    filterRoutableEvents([
      ...ordinary,
      { type: 'referralEvidence', kind: 'party', participants: [] },
    ]),
  ).toEqual(ordinary);
});
