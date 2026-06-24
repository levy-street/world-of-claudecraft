import { describe, it, expect } from 'vitest';
import { createBotDetector } from '../server/bot_detector/stub';
import type { BotDetector } from '../server/bot_detector/contract';
import { emptyMoveInput } from '../src/sim/types';

describe('bot-detector stub (open-source no-op)', () => {
  it('satisfies the BotDetector seam and detects nothing', () => {
    const detector: BotDetector = createBotDetector();
    const ctx = detector.createTrackingContext(
      { accountId: 1, characterId: 1, name: 'X', ip: '1.2.3.4' },
      { some: 'meta-value', another: 'meta' },
    );

    // A full observation cycle is inert and never escalates.
    detector.observeCommand(ctx, 'attack', Date.now());
    detector.observeCommand(ctx, 'attack', Date.now(), {some: 'payload'});
    detector.observeEvent(ctx, { type: 'tradeDone' } as any, Date.now());
    detector.observeInput(ctx, { moveInput: emptyMoveInput(), facing: 0 }, Date.now());
    detector.observeProtocolAnomaly(ctx, 'unknown_command', '{"t":"cmd","cmd":"x"}', Date.now());
    expect(detector.handleTick(ctx, Date.now(), true)).toBe('none');

    detector.releaseTrackingContext(ctx);
  });
});
