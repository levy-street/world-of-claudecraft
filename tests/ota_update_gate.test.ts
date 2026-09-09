import { describe, expect, it, vi } from 'vitest';
import type { OtaUpdateHandlers } from '../src/net/native_ota';
import {
  initialOtaGateState,
  installOtaUpdateGate,
  OTA_STAGING_GRACE_MS,
  type OtaGateState,
  type OtaOverlayModel,
  type OtaUpdateGateDeps,
  otaOverlayModel,
  reduceOtaGateEvent,
  shouldAutoApplyOta,
} from '../src/net/ota_update_gate';
import { ONLINE_WORLD_INCOMPATIBLE_MESSAGE } from '../src/world_api';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stateWith(overrides: Partial<OtaGateState>): OtaGateState {
  return { ...initialOtaGateState(), ...overrides };
}

describe('reduceOtaGateEvent', () => {
  it('tracks a download through progress to ready, and staged marks it switchable', () => {
    let s = initialOtaGateState();
    s = reduceOtaGateEvent(s, { type: 'progress', percent: 12 });
    expect(s).toMatchObject({ phase: 'downloading', percent: 12 });
    s = reduceOtaGateEvent(s, { type: 'progress', percent: 80 });
    expect(s.percent).toBe(80);
    s = reduceOtaGateEvent(s, { type: 'complete' });
    // The bytes are down but the plugin has not verified or recorded them.
    expect(s).toMatchObject({ phase: 'ready', percent: 100, staged: false, stagedId: null });
    s = reduceOtaGateEvent(s, { type: 'staged', bundleId: 'b2' });
    expect(s).toMatchObject({ phase: 'ready', percent: 100, staged: true, stagedId: 'b2' });
  });

  it('staged can arrive without a prior complete (a bundle found by the probe)', () => {
    const s = reduceOtaGateEvent(initialOtaGateState(), { type: 'staged', bundleId: 'b7' });
    expect(s).toMatchObject({ phase: 'ready', percent: 100, staged: true, stagedId: 'b7' });
  });

  it('a staged event without an id keeps any id already known', () => {
    const known = stateWith({ phase: 'ready', staged: true, stagedId: 'b2' });
    expect(reduceOtaGateEvent(known, { type: 'staged', bundleId: null }).stagedId).toBe('b2');
    expect(
      reduceOtaGateEvent(initialOtaGateState(), { type: 'staged', bundleId: null }),
    ).toMatchObject({ staged: true, stagedId: null });
  });

  it('never demotes a ready or applying bundle on a trailing progress tick', () => {
    const ready = stateWith({ phase: 'ready', percent: 100 });
    expect(reduceOtaGateEvent(ready, { type: 'progress', percent: 99 })).toBe(ready);
    const applying = stateWith({ phase: 'applying', percent: 100 });
    expect(reduceOtaGateEvent(applying, { type: 'progress', percent: 99 })).toBe(applying);
    expect(reduceOtaGateEvent(applying, { type: 'complete' })).toBe(applying);
    expect(reduceOtaGateEvent(applying, { type: 'staged', bundleId: 'x' })).toBe(applying);
    expect(reduceOtaGateEvent(applying, { type: 'failed' })).toBe(applying);
  });

  it('a staged bundle outlives a later failure report', () => {
    const staged = stateWith({ phase: 'ready', staged: true, stagedId: 'b2' });
    expect(reduceOtaGateEvent(staged, { type: 'failed' })).toBe(staged);
    const unstaged = stateWith({ phase: 'ready' });
    expect(reduceOtaGateEvent(unstaged, { type: 'failed' }).phase).toBe('failed');
  });
});

describe('otaOverlayModel', () => {
  it('shows nothing while idle, failed, or in-world', () => {
    expect(otaOverlayModel(initialOtaGateState(), false)).toBeNull();
    expect(otaOverlayModel(stateWith({ phase: 'failed' }), false)).toBeNull();
    expect(otaOverlayModel(stateWith({ phase: 'downloading' }), true)).toBeNull();
  });

  it('renders a downloading model carrying no cancel/continue affordance', () => {
    expect(otaOverlayModel(stateWith({ phase: 'downloading', percent: 55 }), false)).toEqual({
      phase: 'downloading',
      percent: 55,
      fatal: false,
    } satisfies OtaOverlayModel);
  });

  it('fatal mode outranks in-world suppression', () => {
    const fatal = stateWith({ phase: 'downloading', percent: 70, fatal: true });
    expect(otaOverlayModel(fatal, true)).toMatchObject({ fatal: true });
  });

  it('a ready bundle renders as applying, staged or not (the plugin is verifying it)', () => {
    expect(otaOverlayModel(stateWith({ phase: 'ready' }), false)).toMatchObject({
      phase: 'applying',
    });
    expect(otaOverlayModel(stateWith({ phase: 'ready', staged: true }), false)).toMatchObject({
      phase: 'applying',
    });
  });
});

describe('shouldAutoApplyOta', () => {
  it('applies only a STAGED ready bundle: pre-world, and always in fatal mode', () => {
    const staged = stateWith({ phase: 'ready', staged: true });
    expect(shouldAutoApplyOta(staged, false)).toBe(true);
    expect(shouldAutoApplyOta(staged, true)).toBe(false);
    expect(shouldAutoApplyOta({ ...staged, fatal: true }, true)).toBe(true);
    expect(shouldAutoApplyOta(stateWith({ phase: 'downloading' }), false)).toBe(false);
  });

  it('never applies on downloadComplete alone: there is nothing to switch to yet', () => {
    const unstaged = stateWith({ phase: 'ready' });
    expect(shouldAutoApplyOta(unstaged, false)).toBe(false);
    expect(shouldAutoApplyOta({ ...unstaged, fatal: true }, false)).toBe(false);
  });
});

interface Timer {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

type ApplyFn = NonNullable<OtaUpdateGateDeps['apply']>;
type PendingFn = NonNullable<OtaUpdateGateDeps['pending']>;

interface Rig {
  handlers: OtaUpdateHandlers;
  render: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  apply: ApplyFn;
  pending: PendingFn;
  onFatalRecoveryFailed: ReturnType<typeof vi.fn>;
  gate: ReturnType<typeof installOtaUpdateGate>;
  timers: Timer[];
  fireTimers(): void;
  setInWorld(value: boolean): void;
}

function makeRig(overrides: Partial<OtaUpdateGateDeps> = {}): Rig {
  let handlers: OtaUpdateHandlers | null = null;
  let inWorld = false;
  const render = vi.fn();
  const hide = vi.fn();
  // Overrides win, and the rig hands back the EFFECTIVE mocks so a test that
  // scripts its own apply/pending can still assert on them.
  const apply: ApplyFn = overrides.apply ?? vi.fn(async () => true);
  const pending: PendingFn = overrides.pending ?? vi.fn(async () => null);
  const onFatalRecoveryFailed = vi.fn();
  const timers: Timer[] = [];
  const gate = installOtaUpdateGate({
    native: true,
    watch: (h) => {
      handlers = h;
      return () => {};
    },
    apply,
    pending,
    schedule: (fn, ms) => {
      const timer: Timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    overlay: { render, hide },
    isInWorld: () => inWorld,
    onFatalRecoveryFailed,
    ...overrides,
  });
  if (!handlers) throw new Error('gate did not subscribe to OTA updates');
  return {
    handlers,
    render,
    hide,
    apply,
    pending,
    onFatalRecoveryFailed,
    gate,
    timers,
    fireTimers: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
    },
    setInWorld: (value) => {
      inWorld = value;
    },
  };
}

describe('installOtaUpdateGate', () => {
  it('is inert off the native shells', () => {
    const watch = vi.fn();
    const pending = vi.fn();
    const gate = installOtaUpdateGate({
      native: false,
      watch,
      pending,
      overlay: { render: vi.fn(), hide: vi.fn() },
      isInWorld: () => false,
    });
    expect(watch).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    expect(gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(false);
  });

  it('paints live progress while a pre-world download runs', () => {
    const rig = makeRig();
    rig.handlers.onProgress(10);
    rig.handlers.onProgress(35);
    expect(rig.render).toHaveBeenLastCalledWith({
      phase: 'downloading',
      percent: 35,
      fatal: false,
    });
    expect(rig.hide).not.toHaveBeenCalled();
  });

  it('suppresses the overlay during live play and leaves the apply to backgrounding', async () => {
    const rig = makeRig();
    rig.setInWorld(true);
    rig.handlers.onProgress(50);
    rig.handlers.onComplete();
    rig.handlers.onStaged('b2');
    await flushMicrotasks();
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.hide).toHaveBeenCalled();
    expect(rig.apply).not.toHaveBeenCalled();
  });

  it('holds the applying screen on downloadComplete and applies only once the bundle is staged', async () => {
    // The regression this pins: applying on downloadComplete switched to
    // nothing (the plugin had not recorded the bundle yet) and rebooted the
    // same stale client, which then met the incompatible-version rejection.
    const rig = makeRig();
    rig.handlers.onProgress(90);
    rig.handlers.onComplete();
    expect(rig.render).toHaveBeenLastCalledWith({
      phase: 'applying',
      percent: 100,
      fatal: false,
    });
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
    rig.handlers.onStaged('b2');
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: 'b2' });
  });

  it('applies a staged bundle with no id by letting the apply ask the plugin', async () => {
    const rig = makeRig();
    rig.handlers.onStaged(null);
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: null });
  });

  it('applies a bundle the plugin staged before this context existed (boot probe)', async () => {
    const rig = makeRig({ pending: vi.fn(async () => 'b7') });
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: 'b7' });
    expect(rig.render).toHaveBeenLastCalledWith({
      phase: 'applying',
      percent: 100,
      fatal: false,
    });
  });

  it('the boot probe defers to backgrounding when the player is already in-world', async () => {
    const rig = makeRig({ pending: vi.fn(async () => 'b7') });
    rig.setInWorld(true);
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
    expect(rig.gate.state()).toMatchObject({ phase: 'ready', staged: true, stagedId: 'b7' });
  });

  it('falls back silently to apply-on-background when nothing could be switched', async () => {
    const rig = makeRig({ apply: vi.fn(async () => false) });
    rig.handlers.onStaged('b2');
    await flushMicrotasks();
    expect(rig.hide).toHaveBeenCalled();
    expect(rig.onFatalRecoveryFailed).not.toHaveBeenCalled();
  });

  it('claims the incompatible-version disconnect, in flight or not, and never another reason', () => {
    const idle = makeRig();
    expect(idle.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(true);
    expect(idle.gate.handleIncompatibleDisconnect('rejected by server')).toBe(false);

    const downloading = makeRig();
    downloading.handlers.onProgress(60);
    expect(downloading.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(
      true,
    );
    expect(downloading.render).toHaveBeenLastCalledWith({
      phase: 'downloading',
      percent: 60,
      fatal: true,
    });
  });

  it('never claims a non-incompatible fatal reason mid-download', () => {
    const rig = makeRig();
    rig.handlers.onProgress(60);
    expect(rig.gate.handleIncompatibleDisconnect('message rate exceeded')).toBe(false);
    expect(rig.gate.handleIncompatibleDisconnect(undefined)).toBe(false);
    expect(rig.pending).toHaveBeenCalledTimes(1); // the boot probe only; no re-probe
  });

  it('a staged bundle applies immediately when the incompatible rejection lands', async () => {
    const rig = makeRig();
    rig.setInWorld(true); // staged mid-session: apply deferred to backgrounding
    rig.handlers.onComplete();
    rig.handlers.onStaged('b2');
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
    rig.setInWorld(false); // the rejection ends the session
    expect(rig.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(true);
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: 'b2' });
  });

  it('with nothing in flight, the rejection re-probes the plugin and applies what it finds, fatal', async () => {
    // The download finished before this context booted AND the boot probe
    // missed it (raced the plugin's own bookkeeping): the player taps Play,
    // the server rejects the stale bundle, and the plugin is asked again.
    let probes = 0;
    const rig = makeRig({
      pending: vi.fn(async () => (++probes === 1 ? null : 'b9')),
    });
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
    rig.setInWorld(true); // whatever body still says after the session died
    expect(rig.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(true);
    await flushMicrotasks();
    expect(rig.pending).toHaveBeenCalledTimes(2);
    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: 'b9' });
    expect(rig.render).toHaveBeenLastCalledWith({ phase: 'applying', percent: 100, fatal: true });
    // The caller's dead-end overlay never painted, so the resume marker it
    // clears survives and the reload lands back in the world on the new bundle.
    expect(rig.onFatalRecoveryFailed).not.toHaveBeenCalled();
  });

  it('a miss on that re-probe hands the screen back exactly once and keeps fatal for a later download', async () => {
    const rig = makeRig();
    await flushMicrotasks();
    expect(rig.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(true);
    // Claimed but nothing painted yet: the hand-back waits for the plugin's
    // answer because the caller's overlay is what clears the resume marker.
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.onFatalRecoveryFailed).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);
    // The plugin re-checks on the next foreground; that download now paints
    // and applies over the dead end without another rejection round trip.
    rig.setInWorld(true);
    rig.handlers.onProgress(40);
    expect(rig.render).toHaveBeenLastCalledWith({ phase: 'downloading', percent: 40, fatal: true });
    rig.handlers.onStaged('b3');
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: 'b3' });
  });

  it('a download that starts while the re-probe runs keeps the screen instead of handing back', async () => {
    const probe: { answer: ((id: string | null) => void) | null } = { answer: null };
    let probes = 0;
    const rig = makeRig({
      pending: vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            if (++probes === 1)
              resolve(null); // the boot probe
            else probe.answer = resolve;
          }),
      ),
    });
    await flushMicrotasks();
    expect(rig.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(true);
    rig.handlers.onProgress(20); // the plugin's foreground re-check started a download
    probe.answer?.(null);
    await flushMicrotasks();
    expect(rig.onFatalRecoveryFailed).not.toHaveBeenCalled();
    expect(rig.render).toHaveBeenLastCalledWith({ phase: 'downloading', percent: 20, fatal: true });
    rig.handlers.onFailed(); // that download's own failure is what hands back
    expect(rig.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);
  });

  it('fatal-mode dead ends hand the screen back through onFatalRecoveryFailed', async () => {
    const applyFails = makeRig({ apply: vi.fn(async () => false) });
    applyFails.handlers.onProgress(80);
    applyFails.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
    applyFails.handlers.onComplete();
    applyFails.handlers.onStaged('b2');
    await flushMicrotasks();
    expect(applyFails.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);
    // Handing the screen back means actually hiding this overlay: the caller's
    // recovery overlay stacks BELOW the OTA scrim, so a still-painted overlay
    // would bury the only remaining action (the z-order regression this pins).
    expect(applyFails.hide).toHaveBeenCalled();

    const downloadFails = makeRig();
    downloadFails.handlers.onProgress(80);
    downloadFails.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
    downloadFails.handlers.onFailed();
    expect(downloadFails.hide).toHaveBeenCalled();
    expect(downloadFails.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);
  });

  it('a completed download the plugin never stages is released after the grace window', async () => {
    const rig = makeRig();
    rig.handlers.onComplete();
    expect(rig.timers.map((t) => t.ms)).toEqual([OTA_STAGING_GRACE_MS]);
    rig.fireTimers();
    await flushMicrotasks();
    // One last look at the plugin's record, then step aside (the plugin's own
    // apply-on-background is still armed); no dead-end "applying" forever.
    expect(rig.pending).toHaveBeenCalledTimes(2);
    expect(rig.apply).not.toHaveBeenCalled();
    expect(rig.hide).toHaveBeenCalled();
    expect(rig.gate.state().phase).toBe('failed');
  });

  it('the grace-window probe applies a bundle the plugin staged without telling us', async () => {
    let probes = 0;
    const rig = makeRig({ pending: vi.fn(async () => (++probes === 1 ? null : 'b4')) });
    rig.handlers.onComplete();
    rig.fireTimers();
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledWith({ bundleId: 'b4' });
  });

  it('the grace window is disarmed once the bundle is staged or the download fails', async () => {
    const staged = makeRig();
    staged.handlers.onComplete();
    staged.handlers.onStaged('b2');
    await flushMicrotasks();
    staged.fireTimers();
    await flushMicrotasks();
    expect(staged.apply).toHaveBeenCalledTimes(1);
    expect(staged.pending).toHaveBeenCalledTimes(1); // boot probe only

    const failed = makeRig();
    failed.handlers.onComplete();
    failed.handlers.onFailed();
    failed.fireTimers();
    await flushMicrotasks();
    expect(failed.pending).toHaveBeenCalledTimes(1);
  });

  it('in fatal mode, a grace-window miss hands the screen back exactly once', async () => {
    const rig = makeRig();
    rig.handlers.onProgress(80);
    rig.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
    rig.handlers.onComplete();
    rig.fireTimers();
    await flushMicrotasks();
    expect(rig.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);
    expect(rig.hide).toHaveBeenCalled();
  });
});
