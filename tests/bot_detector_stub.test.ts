import { describe, expect, it } from 'vitest';
import type { BotDetector, SessionRuntimeSnapshot } from '../server/bot_detector/contract';
import { createBotDetector } from '../server/bot_detector/stub';
import { emptyMoveInput } from '../src/sim/types';

const snapshot: SessionRuntimeSnapshot = {
  capturedAt: 1_000,
  simTime: 12.5,
  x: 1,
  z: 2,
  facing: 0.5,
  dead: false,
  inCombat: false,
  targetId: null,
  instanceSlot: null,
  instanceDungeonId: null,
  level: 1,
  classId: 'warrior',
  hp: 100,
  maxHp: 100,
  resource: 0,
  maxResource: 100,
  resourceType: 'rage',
  autoAttack: false,
  followTargetId: null,
  moveSpeed: 7,
  onGround: true,
};

describe('bot-detector stub (open-source no-op)', () => {
  it('satisfies the BotDetector seam and detects nothing', () => {
    const detector: BotDetector = createBotDetector();
    const ctx = detector.createTrackingContext(
      { accountId: 1, characterId: 1, name: 'X', ip: '1.2.3.4' },
      { some: 'meta-value', another: 'meta' },
    );

    // A full observation cycle is inert and never escalates.
    detector.observeCommand(ctx, 'attack', Date.now());
    detector.observeCommand(ctx, 'attack', Date.now(), { some: 'payload' });
    detector.observeEvent(ctx, { type: 'tradeDone' } as any, Date.now());
    detector.observeInput(ctx, { moveInput: emptyMoveInput(), facing: 0 }, Date.now());
    detector.observeProtocolAnomaly(ctx, 'unknown_command', '{"t":"cmd","cmd":"x"}', Date.now());
    expect(detector.handleTick(ctx, Date.now(), true, snapshot)).toBe('none');
    expect(detector.listSuspiciousPlayers()).toEqual([]);
    expect(detector.listCalibrationHistograms()).toEqual([]);

    detector.releaseTrackingContext(ctx);
  });
});
