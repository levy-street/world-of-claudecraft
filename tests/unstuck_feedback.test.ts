import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { t } from '../src/ui/i18n';
import { unstuckFeedback } from '../src/ui/unstuck_feedback';

type Event = Extract<SimEvent, { type: 'unstuck' }>;

const area = { kind: 'overworld', id: 'eastbrook_vale' } as const;
const origin = { x: 0, y: 0, z: 0, localX: 0, localZ: 0 };

describe('unstuck feedback', () => {
  it('uses a short countdown banner, a detailed start log, and terminal completion', () => {
    const started = unstuckFeedback({ type: 'unstuck', phase: 'started', seconds: 10 });
    expect(started).toEqual({
      key: 'hudChrome.unstuck.started',
      bannerKey: 'hudChrome.unstuck.countdown',
      values: { seconds: '10' },
      kind: 'progress',
      banner: true,
      log: true,
      clearBanner: false,
    });
    expect(t(started.bannerKey ?? started.key, started.values)).toBe('Unstuck: 10');
    expect(t(started.key, started.values)).toContain('Moving, fighting, taking damage');
    expect(unstuckFeedback({ type: 'unstuck', phase: 'countdown', seconds: 4 })).toEqual({
      key: 'hudChrome.unstuck.countdown',
      values: { seconds: '4' },
      kind: 'progress',
      banner: true,
      log: false,
      clearBanner: false,
    });
    const completed = unstuckFeedback({
      type: 'unstuck',
      phase: 'completed',
      reason: 'moved_to_graveyard',
      area,
      origin,
      destination: { ...origin, z: 1, localZ: 1 },
      duration: 10,
      distance: 1,
    });
    expect(completed).toEqual({
      key: 'hudChrome.unstuck.movedToGraveyard',
      kind: 'success',
      banner: true,
      log: true,
      clearBanner: true,
    });
    // A living player was moved, not killed: nothing may send them to the Pale Keeper,
    // and the debuff named must be the shorter Unstuck one.
    expect(t(completed.key)).toContain('Unstuck Sickness');
    expect(t(completed.key)).not.toContain('Pale Keeper');
    expect(t(completed.key)).not.toContain("Keeper's Toll");
  });

  it('separates the revive completion from the living move so neither text misleads', () => {
    const revived = unstuckFeedback({
      type: 'unstuck',
      phase: 'completed',
      reason: 'revived_at_graveyard',
      area,
      origin,
      destination: { ...origin, z: 1, localZ: 1 },
      duration: 10,
      distance: 1,
    });
    expect(revived).toEqual({
      key: 'hudChrome.unstuck.revivedAtGraveyardUnstuck',
      kind: 'success',
      banner: true,
      log: true,
      clearBanner: true,
    });
    // Only this outcome raised the player, so only it says so; and like the move above
    // it charges Unstuck Sickness rather than routing anyone to the Pale Keeper.
    expect(t(revived.key)).toContain('revived');
    expect(t('hudChrome.unstuck.movedToGraveyard')).not.toContain('revived');
    expect(t(revived.key)).toContain('Unstuck Sickness');
    expect(t(revived.key)).not.toContain('Pale Keeper');
  });

  it('keeps the retired safe-spot outcome on its own legacy key', () => {
    const legacy = unstuckFeedback({
      type: 'unstuck',
      phase: 'completed',
      reason: 'nearest_safe_position',
      area,
      origin,
      destination: { ...origin, z: 1, localZ: 1 },
      duration: 10,
      distance: 1,
    });
    expect(legacy.key).toBe('hudChrome.unstuck.completed');
    expect(legacy.key).not.toBe('hudChrome.unstuck.movedToGraveyard');
  });

  it('renders the pre-0.32.1 kill-and-release reason from a stale server on its shipped key', () => {
    const legacy = unstuckFeedback({
      type: 'unstuck',
      phase: 'completed',
      reason: 'nearest_graveyard',
      area,
      origin,
      destination: { ...origin, z: 1, localZ: 1 },
      duration: 10,
      distance: 1,
    });
    // A 0.32.0 server really did kill and release the invoker, so the shipped
    // release copy (go accept the Toll at the Pale Keeper) is the correct text.
    expect(legacy.key).toBe('hudChrome.unstuck.completedAtGraveyard');
    expect(t(legacy.key)).toContain('Pale Keeper');
  });

  it('formats visible countdown numbers through the active locale formatter', () => {
    expect(
      unstuckFeedback({ type: 'unstuck', phase: 'countdown', seconds: 1000 }).values?.seconds,
    ).toBe('1,000');
  });

  it.each([
    ['moved', 'hudChrome.unstuck.cancelledMoved'],
    ['damaged', 'hudChrome.unstuck.cancelledDamaged'],
    ['combat', 'hudChrome.unstuck.cancelledCombat'],
    ['busy', 'hudChrome.unstuck.cancelledBusy'],
    ['state_changed', 'hudChrome.unstuck.cancelledState'],
    ['disconnected', 'hudChrome.unstuck.cancelledDisconnected'],
  ] as const)('maps cancelled reason %s', (reason, key) => {
    const event: Event = {
      type: 'unstuck',
      phase: 'cancelled',
      reason,
      area,
      origin,
      duration: 2,
    };
    expect(unstuckFeedback(event)).toEqual({
      key,
      kind: 'error',
      banner: false,
      log: false,
      clearBanner: true,
    });
  });

  it.each([
    ['already_active', 'hudChrome.unstuck.alreadyActive'],
    ['already_safe', 'hudChrome.unstuck.alreadySafe'],
    ['dead', 'hudChrome.unstuck.dead'],
    ['ghost', 'hudChrome.unstuck.dead'],
    ['combat', 'hudChrome.unstuck.combat'],
    ['controlled', 'hudChrome.unstuck.controlled'],
    ['falling', 'hudChrome.unstuck.standStill'],
    ['moving', 'hudChrome.unstuck.standStillAnywhere'],
    ['busy', 'hudChrome.unstuck.busy'],
    ['jailed', 'hudChrome.unstuck.unavailable'],
    ['spectating', 'hudChrome.unstuck.unavailable'],
    ['competitive', 'hudChrome.unstuck.unavailable'],
    ['trading', 'hudChrome.unstuck.unavailable'],
    ['invalid_area', 'hudChrome.unstuck.unavailable'],
  ] as const)('maps blocked reason %s', (reason, key) => {
    const event: Event = { type: 'unstuck', phase: 'blocked', reason };
    expect(unstuckFeedback(event)).toEqual({
      key,
      kind: 'error',
      banner: false,
      log: false,
      clearBanner: false,
    });
  });

  it('preserves cooldown seconds and maps a failed search', () => {
    expect(
      unstuckFeedback({
        type: 'unstuck',
        phase: 'blocked',
        reason: 'cooldown',
        seconds: 73,
      }),
    ).toEqual({
      key: 'hudChrome.unstuck.cooldown',
      values: { seconds: '73' },
      kind: 'error',
      banner: false,
      log: false,
      clearBanner: false,
    });

    expect(
      unstuckFeedback({
        type: 'unstuck',
        phase: 'failed',
        reason: 'no_safe_position',
        area,
        origin,
        duration: 10,
      }),
    ).toEqual({
      key: 'hudChrome.unstuck.noSafePosition',
      kind: 'error',
      banner: false,
      log: false,
      clearBanner: true,
    });
  });
});
