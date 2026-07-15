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

// The full method surface of the BotDetector seam. `satisfies` ties every entry to
// a real contract member, so naming a method that does not exist reddens tsc.
const BOT_DETECTOR_METHODS = [
  'createTrackingContext',
  'setTrackingConnection',
  'releaseTrackingContext',
  'observeCommand',
  'observeEvent',
  'observeInput',
  'observeProtocolAnomaly',
  'handleTick',
  'listSuspiciousPlayers',
  'listCalibrationHistograms',
  'describeConfig',
  'applyConfig',
] as const satisfies readonly (keyof BotDetector)[];

// Compile-time exhaustiveness (same AssertNever idiom as tests/server/tick_perf_capture.test.ts):
// if the contract gains a method the array above lacks, this Exclude is non-never and
// tsc fails. This is what caught a past production incident in reverse: a call site was
// added for a method the deployed detector lacked, and nothing failed until runtime
// TypeErrors. Widening the contract now forces the array (and any call site) to keep up.
type AssertNever<T extends never> = T;
type _ExhaustBotDetectorMethods = AssertNever<
  Exclude<keyof BotDetector, (typeof BOT_DETECTOR_METHODS)[number]>
>;

describe('bot-detector stub (open-source no-op)', () => {
  it('implements every BotDetector contract method (the CI-visible completeness arm)', () => {
    // vitest transpiles without typechecking, so the compile-time pins above never run
    // in CI. This runtime arm is the one that fires there: the private clone that
    // overlays this seam in production must expose the same surface, and any call site
    // that references a method absent from the deployed detector throws a TypeError at
    // runtime. Assert the stub actually carries each listed method as a function.
    const detector = createBotDetector();
    expect(BOT_DETECTOR_METHODS).toHaveLength(12);
    for (const name of BOT_DETECTOR_METHODS) {
      expect(typeof detector[name], `${name} is not a function on the detector`).toBe('function');
    }
  });

  it('satisfies the BotDetector seam and detects nothing', () => {
    const detector: BotDetector = createBotDetector();
    const ctx = detector.createTrackingContext(
      { accountId: 1, characterId: 1, name: 'X', ip: '1.2.3.4' },
      { some: 'meta-value', another: 'meta' },
    );

    // Connection-state transitions the server drives on linkdead drop and
    // same-session resume. Guards the stub-versus-private drift class where the
    // server called setTrackingConnection but the bundled detector lacked it: a
    // missing method here is a compile error, and this call would throw at runtime.
    detector.setTrackingConnection(ctx, false);
    detector.setTrackingConnection(ctx, true, { some: 'resume-meta' });

    // A full observation cycle is inert and never escalates.
    detector.observeCommand(ctx, 'attack', Date.now());
    detector.observeCommand(ctx, 'attack', Date.now(), { some: 'payload' });
    detector.observeEvent(ctx, { type: 'tradeDone' } as any, Date.now());
    detector.observeInput(ctx, { moveInput: emptyMoveInput(), facing: 0 }, Date.now());
    detector.observeProtocolAnomaly(ctx, 'unknown_command', '{"t":"cmd","cmd":"x"}', Date.now());
    expect(detector.handleTick(ctx, Date.now(), true, snapshot)).toBe('none');
    expect(detector.listSuspiciousPlayers()).toEqual([]);
    expect(detector.listCalibrationHistograms()).toEqual([]);
    expect(detector.describeConfig()).toEqual([]);
    expect(detector.applyConfig({ anything: 1 })).toEqual({ errors: [] });

    detector.releaseTrackingContext(ctx);
  });
});
