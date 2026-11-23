// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createFriendshipArmourClaim } from '../src/ui/friendship_armour_claim';
import type { IWorld } from '../src/world_api';

function fixture(inviter: string | null, member = false) {
  return {
    player: { referralInviterName: inviter, membershipActive: member } as IWorld['player'],
    claimMembershipArmour: vi.fn(),
  };
}

it.each([false, true])('offers eligible friends recovery with membership=%s', (member) => {
  const world = fixture('Aldric', member);
  const button = createFriendshipArmourClaim(() => world)!;
  expect(button.textContent).toBe('Claim friendship armour');
  expect(button.type).toBe('button');
  expect(button.getAttribute('data-focus-key')).toBe('friendship-armour');
  button.click();
  expect(world.claimMembershipArmour).toHaveBeenCalledOnce();
});

it.each([false, true])('does not offer unearned referral gear with membership=%s', (member) => {
  expect(createFriendshipArmourClaim(() => fixture(null, member))).toBeNull();
});

it('reads the current character and rejects a stale claim after eligibility disappears', () => {
  let world = fixture('Aldric');
  const original = world;
  const button = createFriendshipArmourClaim(() => world)!;
  world = fixture(null);
  button.click();
  expect(original.claimMembershipArmour).not.toHaveBeenCalled();
  expect(world.claimMembershipArmour).not.toHaveBeenCalled();
  world = fixture('Bran');
  button.click();
  expect(world.claimMembershipArmour).toHaveBeenCalledOnce();
});
