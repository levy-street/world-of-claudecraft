import { describe, expect, it, vi } from 'vitest';
import { createReferralCard } from '../src/sim/referral_cards';
import { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';

const snapshot = {
  revision: 1,
  accountId: 1,
  characterId: 11,
  characterName: 'One',
  inviteUrl: null,
  links: [
    {
      card: createReferralCard(7, 1, 2),
      friendName: 'Two',
      canMove: false,
      summonRemainingSeconds: 0,
    },
  ],
  completedFriends: 0,
  rewardedTiers: [],
  notices: [],
};
describe('referral account mirror', () => {
  it('accepts only valid frames and clears stale character state on hello', () => {
    const world = bareClient(5, { referralCardsState: null });
    const receive = (world as unknown as { onMessage(raw: string): void }).onMessage.bind(world);
    receive(JSON.stringify({ t: 'referralCards', snapshot }));
    expect(world.referralCardsSnapshot()).toEqual(snapshot);
    receive(
      JSON.stringify({ t: 'referralCards', snapshot: { ...snapshot, characterId: 'invalid' } }),
    );
    expect(world.referralCardsSnapshot()).toEqual(snapshot);
    receive(JSON.stringify({ t: 'hello', pid: 6, seed: 42 }));
    expect(world.referralCardsSnapshot()).toBeNull();
  });
  it('sends actions as intent without predicting reward state', () => {
    const world = bareClient(5, { referralCardsState: snapshot });
    const send = vi.fn();
    (world as unknown as { cmd: typeof send }).cmd = send;
    const action = { type: 'start' as const, linkId: 7, expectedRevision: 0 };
    world.referralCardsAction(action);
    expect(send).toHaveBeenCalledWith({ cmd: 'referralCards', action });
    expect(world.referralCardsSnapshot()).toBe(snapshot);
  });
  it('keeps referral account actions inert offline', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    sim.referralCardsAction({ type: 'page' });
    expect(sim.referralCardsSnapshot()).toBeNull();
  });
});
