import { describe, expect, it, vi } from 'vitest';
import type { OtaUpdateHandlers } from '../src/net/native_ota';
import {
  initialOtaGateState,
  installOtaUpdateGate,
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
  it('tracks a download through progress to ready', () => {
    let s = initialOtaGateState();
    s = reduceOtaGateEvent(s, { type: 'progress', percent: 12 });
    expect(s).toMatchObject({ phase: 'downloading', percent: 12 });
    s = reduceOtaGateEvent(s, { type: 'progress', percent: 80 });
    expect(s.percent).toBe(80);
    s = reduceOtaGateEvent(s, { type: 'complete' });
    expect(s).toMatchObject({ phase: 'ready', percent: 100 });
  });

  it('never demotes a ready or applying bundle on a trailing progress tick', () => {
    const ready = stateWith({ phase: 'ready', percent: 100 });
    expect(reduceOtaGateEvent(ready, { type: 'progress', percent: 99 })).toBe(ready);
    const applying = stateWith({ phase: 'applying', percent: 100 });
    expect(reduceOtaGateEvent(applying, { type: 'progress', percent: 99 })).toBe(applying);
    expect(reduceOtaGateEvent(applying, { type: 'complete' })).toBe(applying);
    expect(reduceOtaGateEvent(applying, { type: 'failed' })).toBe(applying);
  });

  it('dismiss is sticky until the incompatible rejection overrides it', () => {
    let s = stateWith({ phase: 'downloading', percent: 40 });
    s = reduceOtaGateEvent(s, { type: 'dismiss' });
    expect(s.dismissed).toBe(true);
    s = reduceOtaGateEvent(s, { type: 'incompatible' });
    expect(s).toMatchObject({ fatal: true, dismissed: false });
  });
});

describe('otaOverlayModel', () => {
  it('shows nothing while idle, failed, dismissed, or in-world', () => {
    expect(otaOverlayModel(initialOtaGateState(), false)).toBeNull();
    expect(otaOverlayModel(stateWith({ phase: 'failed' }), false)).toBeNull();
    expect(otaOverlayModel(stateWith({ phase: 'downloading', dismissed: true }), false)).toBeNull();
    expect(otaOverlayModel(stateWith({ phase: 'downloading' }), true)).toBeNull();
  });

  it('renders a downloading model with the continue escape hatch', () => {
    expect(otaOverlayModel(stateWith({ phase: 'downloading', percent: 55 }), false)).toEqual({
      phase: 'downloading',
      percent: 55,
      showContinue: true,
      fatal: false,
    } satisfies OtaOverlayModel);
  });

  it('fatal mode loses the continue action and outranks dismissal and in-world', () => {
    const fatal = stateWith({ phase: 'downloading', percent: 70, fatal: true });
    expect(otaOverlayModel(fatal, true)).toMatchObject({ showContinue: false, fatal: true });
  });

  it('a ready bundle renders as applying (auto-apply fires in the same turn)', () => {
    expect(otaOverlayModel(stateWith({ phase: 'ready' }), false)).toMatchObject({
      phase: 'applying',
      showContinue: false,
    });
  });
});

describe('shouldAutoApplyOta', () => {
  it('applies a ready bundle pre-world unless dismissed, and always in fatal mode', () => {
    expect(shouldAutoApplyOta(stateWith({ phase: 'ready' }), false)).toBe(true);
    expect(shouldAutoApplyOta(stateWith({ phase: 'ready' }), true)).toBe(false);
    expect(shouldAutoApplyOta(stateWith({ phase: 'ready', dismissed: true }), false)).toBe(false);
    expect(shouldAutoApplyOta(stateWith({ phase: 'ready', fatal: true }), true)).toBe(true);
    expect(shouldAutoApplyOta(stateWith({ phase: 'downloading' }), false)).toBe(false);
  });
});

interface Rig {
  handlers: OtaUpdateHandlers;
  render: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
  onFatalRecoveryFailed: ReturnType<typeof vi.fn>;
  gate: ReturnType<typeof installOtaUpdateGate>;
  setInWorld(value: boolean): void;
}

function makeRig(overrides: Partial<OtaUpdateGateDeps> = {}): Rig {
  let handlers: OtaUpdateHandlers | null = null;
  let inWorld = false;
  const render = vi.fn();
  const hide = vi.fn();
  const apply = vi.fn(async () => true);
  const onFatalRecoveryFailed = vi.fn();
  const gate = installOtaUpdateGate({
    native: true,
    watch: (h) => {
      handlers = h;
      return () => {};
    },
    apply,
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
    onFatalRecoveryFailed,
    gate,
    setInWorld: (value) => {
      inWorld = value;
    },
  };
}

describe('installOtaUpdateGate', () => {
  it('is inert off the native shells', () => {
    const watch = vi.fn();
    const gate = installOtaUpdateGate({
      native: false,
      watch,
      overlay: { render: vi.fn(), hide: vi.fn() },
      isInWorld: () => false,
    });
    expect(watch).not.toHaveBeenCalled();
    expect(gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(false);
  });

  it('paints live progress while a pre-world download runs', () => {
    const rig = makeRig();
    rig.handlers.onProgress(10);
    rig.handlers.onProgress(35);
    expect(rig.render).toHaveBeenLastCalledWith({
      phase: 'downloading',
      percent: 35,
      showContinue: true,
      fatal: false,
    });
    expect(rig.hide).not.toHaveBeenCalled();
  });

  it('suppresses the overlay during live play and leaves the apply to backgrounding', async () => {
    const rig = makeRig();
    rig.setInWorld(true);
    rig.handlers.onProgress(50);
    rig.handlers.onComplete();
    await flushMicrotasks();
    expect(rig.render).not.toHaveBeenCalled();
    expect(rig.hide).toHaveBeenCalled();
    expect(rig.apply).not.toHaveBeenCalled();
  });

  it('applies a completed pre-world download immediately, painting the applying state', async () => {
    const rig = makeRig();
    rig.handlers.onProgress(90);
    rig.handlers.onComplete();
    expect(rig.render).toHaveBeenLastCalledWith({
      phase: 'applying',
      percent: 100,
      showContinue: false,
      fatal: false,
    });
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledTimes(1);
  });

  it('dismiss stops the overlay and disarms the auto-apply', async () => {
    const rig = makeRig();
    rig.handlers.onProgress(20);
    rig.gate.dismiss();
    expect(rig.hide).toHaveBeenCalled();
    rig.handlers.onComplete();
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
  });

  it('falls back silently to apply-on-background when the reload path is unavailable', async () => {
    const rig = makeRig({ apply: vi.fn(async () => false) });
    rig.handlers.onComplete();
    await flushMicrotasks();
    expect(rig.hide).toHaveBeenCalled();
    expect(rig.onFatalRecoveryFailed).not.toHaveBeenCalled();
  });

  it('claims the incompatible-version disconnect only while an update is in flight', () => {
    const idle = makeRig();
    expect(idle.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(false);
    expect(idle.gate.handleIncompatibleDisconnect('rejected by server')).toBe(false);

    const downloading = makeRig();
    downloading.handlers.onProgress(60);
    expect(downloading.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(
      true,
    );
    expect(downloading.render).toHaveBeenLastCalledWith({
      phase: 'downloading',
      percent: 60,
      showContinue: false,
      fatal: true,
    });
  });

  it('never claims a non-incompatible fatal reason mid-download', () => {
    const rig = makeRig();
    rig.handlers.onProgress(60);
    expect(rig.gate.handleIncompatibleDisconnect('message rate exceeded')).toBe(false);
    expect(rig.gate.handleIncompatibleDisconnect(undefined)).toBe(false);
  });

  it('a staged bundle applies immediately when the incompatible rejection lands', async () => {
    const rig = makeRig();
    rig.setInWorld(true); // completed mid-session: apply deferred to backgrounding
    rig.handlers.onComplete();
    await flushMicrotasks();
    expect(rig.apply).not.toHaveBeenCalled();
    rig.setInWorld(false); // the rejection ends the session
    expect(rig.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE)).toBe(true);
    await flushMicrotasks();
    expect(rig.apply).toHaveBeenCalledTimes(1);
  });

  it('fatal-mode dead ends hand the screen back through onFatalRecoveryFailed', async () => {
    const applyFails = makeRig({ apply: vi.fn(async () => false) });
    applyFails.handlers.onProgress(80);
    applyFails.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
    applyFails.handlers.onComplete();
    await flushMicrotasks();
    expect(applyFails.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);

    const downloadFails = makeRig();
    downloadFails.handlers.onProgress(80);
    downloadFails.gate.handleIncompatibleDisconnect(ONLINE_WORLD_INCOMPATIBLE_MESSAGE);
    downloadFails.handlers.onFailed();
    expect(downloadFails.hide).toHaveBeenCalled();
    expect(downloadFails.onFatalRecoveryFailed).toHaveBeenCalledTimes(1);
  });
});
