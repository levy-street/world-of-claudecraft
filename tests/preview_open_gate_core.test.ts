// The character sheet / Inspect cold-open gate, pure half. Behavioral: every
// case drives the real state machine and asserts what a DRAW SITE would do.
import { describe, expect, it } from 'vitest';
import {
  createPreviewOpenGate,
  PREVIEW_OPEN_GATE_ESCAPE_MS,
} from '../src/render/characters/preview_open_gate_core';

const SIG_A = '["player_warrior",null,null,null,null]';
const SIG_B = '["player_mage",null,null,null,null]';

describe('createPreviewOpenGate', () => {
  it('holds every draw from the arm until the warm finishes, then reveals', () => {
    const gate = createPreviewOpenGate();
    expect(gate.shouldRender(0)).toBe(true);

    expect(gate.arm(SIG_A, 0)).toBe(true);
    expect(gate.isArmed()).toBe(true);
    expect(gate.shouldRender(10)).toBe(false);
    expect(gate.shouldRender(200)).toBe(false);

    const token = gate.beginWarm();
    expect(token).not.toBeNull();
    expect(gate.shouldRender(200)).toBe(false);

    expect(gate.finishWarm(token as number, SIG_A)).toBe(true);
    expect(gate.isArmed()).toBe(false);
    expect(gate.shouldRender(200)).toBe(true);
    expect(gate.linkedSig()).toBe(SIG_A);
  });

  it('skips the arm entirely when that signature is already linked', () => {
    const gate = createPreviewOpenGate();
    gate.arm(SIG_A, 0);
    gate.finishWarm(gate.beginWarm() as number, SIG_A);

    // The warm open: nothing to hold, so no draw is ever withheld.
    expect(gate.arm(SIG_A, 500)).toBe(false);
    expect(gate.isArmed()).toBe(false);
    expect(gate.shouldRender(500)).toBe(true);
    expect(gate.beginWarm()).toBeNull();
    expect(gate.isLinked(SIG_A)).toBe(true);
    expect(gate.isLinked(SIG_B)).toBe(false);
  });

  it('a warm recorded by prewarm() is the same skip (one shared signature)', () => {
    const gate = createPreviewOpenGate();
    gate.noteLinked(SIG_A);
    expect(gate.arm(SIG_A, 0)).toBe(false);
    // A different visual is still cold, so the open gate arms for it.
    expect(gate.arm(SIG_B, 0)).toBe(true);
  });

  it('a rebuild forgets the linked signature, because three released its programs', () => {
    const gate = createPreviewOpenGate();
    gate.noteLinked(SIG_A);
    gate.forgetLinked();
    expect(gate.linkedSig()).toBeNull();
    // Returning to a look that was linked BEFORE the rebuild must warm again.
    expect(gate.arm(SIG_A, 0)).toBe(true);
  });

  it('never arms without a signature (no visual, nothing to compile)', () => {
    const gate = createPreviewOpenGate();
    expect(gate.arm(null, 0)).toBe(false);
    expect(gate.shouldRender(0)).toBe(true);
  });

  it('a mid-warm re-arm supersedes: the stale pass neither reveals nor records', () => {
    const gate = createPreviewOpenGate();
    gate.arm(SIG_A, 0);
    const stale = gate.beginWarm() as number;

    // The player changed gear (or opened Inspect) while the first warm ran.
    expect(gate.arm(SIG_B, 100)).toBe(true);
    const fresh = gate.beginWarm() as number;
    expect(fresh).not.toBe(stale);

    expect(gate.finishWarm(stale, SIG_A)).toBe(false);
    expect(gate.isArmed()).toBe(true);
    expect(gate.shouldRender(150)).toBe(false);
    // The superseded pass compiled a scene that is no longer on screen, so it
    // records nothing: a later open of SIG_A must warm again.
    expect(gate.linkedSig()).toBeNull();

    expect(gate.finishWarm(fresh, SIG_B)).toBe(true);
    expect(gate.shouldRender(150)).toBe(true);
    expect(gate.linkedSig()).toBe(SIG_B);
  });

  it('cancel leaves no armed state and no pass can reveal through it', () => {
    const gate = createPreviewOpenGate();
    gate.arm(SIG_A, 0);
    const token = gate.beginWarm() as number;
    gate.cancel();
    expect(gate.isArmed()).toBe(false);
    expect(gate.shouldRender(0)).toBe(true);
    expect(gate.finishWarm(token, SIG_A)).toBe(false);
    expect(gate.linkedSig()).toBeNull();
  });

  it('escapes at the soft deadline, reports the age ONCE, and draws from then on', () => {
    const gate = createPreviewOpenGate();
    gate.arm(SIG_A, 1_000);

    // Inside the deadline nothing escapes and nothing draws.
    expect(gate.takeEscape(1_000 + PREVIEW_OPEN_GATE_ESCAPE_MS - 1)).toBeNull();
    expect(gate.shouldRender(1_000 + PREVIEW_OPEN_GATE_ESCAPE_MS - 1)).toBe(false);
    expect(gate.armedAgeMs(1_200)).toBe(200);

    const at = 1_000 + PREVIEW_OPEN_GATE_ESCAPE_MS + 40;
    expect(gate.takeEscape(at)).toBe(PREVIEW_OPEN_GATE_ESCAPE_MS + 40);
    // Recorded once: a per-frame draw site must not fill the event ring.
    expect(gate.takeEscape(at + 16)).toBeNull();
    expect(gate.shouldRender(at + 16)).toBe(true);
    expect(gate.isArmed()).toBe(false);
    // The link never landed, so nothing is recorded as linked and the next
    // open still warms.
    expect(gate.linkedSig()).toBeNull();
  });

  it('reports a draw past the deadline even if the host never takes the escape', () => {
    const gate = createPreviewOpenGate({ escapeMs: 50 });
    gate.arm(SIG_A, 0);
    expect(gate.shouldRender(49)).toBe(false);
    expect(gate.shouldRender(50)).toBe(true);
  });

  it('an escaped window still lets its own warm record what it linked', () => {
    const gate = createPreviewOpenGate({ escapeMs: 50 });
    gate.arm(SIG_A, 0);
    const token = gate.beginWarm() as number;
    expect(gate.takeEscape(60)).toBe(60);
    // The driver link landed late; the signature is genuinely warm now.
    expect(gate.finishWarm(token, SIG_A)).toBe(true);
    expect(gate.isLinked(SIG_A)).toBe(true);
  });

  it('a re-arm after an escape holds again', () => {
    const gate = createPreviewOpenGate({ escapeMs: 50 });
    gate.arm(SIG_A, 0);
    gate.takeEscape(60);
    expect(gate.arm(SIG_B, 60)).toBe(true);
    expect(gate.shouldRender(70)).toBe(false);
  });
});
