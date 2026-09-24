// The thin device driver for aura proc rumble. All pattern decisions live in the
// pure haptic_pulse_core; this file owns only the actuator calls and the guards
// around them.
//
// Both paths are best-effort by design. Gamepad haptics are unevenly implemented
// across browsers and pads, and navigator.vibrate is ignored outright on iOS and
// on any desktop browser. A proc alert must never depend on one landing, which is
// why this channel is opt-in per proc and never the only signal a player can pick.

import { createHapticGate, type HapticShape, hapticPulse } from './haptic_pulse_core';

interface VibrationActuator {
  playEffect?(type: string, params: Record<string, number>): Promise<unknown>;
}

const gate = createHapticGate();

// The one owner of the player's haptics opt-out preference and of the
// contact-hit throttle: a melee/ranged impact lands far more often than an
// aura proc, so it gets its own, much tighter minimum gap on the same gate
// primitive above.
const HAPTICS_STORE_KEY = 'woc_haptics_on';
const contactGate = createHapticGate(90);

/** Whether the player has haptics on (defaults on; opt-out only). */
export function hapticsEnabled(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(HAPTICS_STORE_KEY) !== '0';
  } catch {
    return true; // an unavailable/blocked store is silent, not a refusal
  }
}

/** Short phone-vibrate contact-hit feedback (melee/ranged impact), independent
 *  of the gamepad-capable aura-proc pulse above: a hit lands too often to
 *  also occupy a pad's actuator every time. `durationMs` is the caller's
 *  weight-scaled buzz length; this owns only the opt-out check, the throttle,
 *  and the actuator call. */
export function playContactHaptic(durationMs: number, nowMs = performance.now()): void {
  if (!hapticsEnabled() || !contactGate.allow(nowMs)) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Blocked by a permissions policy or an engine that only pretends to support it.
  }
}

/** Fire one pulse on whatever haptic hardware is present. Silent no-op otherwise. */
export function playAuraHaptic(shape: HapticShape, nowMs = Date.now()): void {
  if (!gate.allow(nowMs)) return;
  const pulse = hapticPulse(shape);
  let delivered = false;
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    for (const pad of navigator.getGamepads()) {
      const actuator = (pad as (Gamepad & { vibrationActuator?: VibrationActuator }) | null)
        ?.vibrationActuator;
      if (!actuator?.playEffect) continue;
      // dual-rumble is the only effect type with broad support; a pad that rejects
      // it throws asynchronously, which must not surface as an unhandled rejection.
      void actuator
        .playEffect('dual-rumble', {
          duration: pulse.durationMs,
          strongMagnitude: pulse.strongMagnitude,
          weakMagnitude: pulse.weakMagnitude,
        })
        .catch(() => {});
      delivered = true;
    }
  }
  // Phone vibration is the fallback, not an addition: a device with a pad attached
  // should not also buzz in the player's hand.
  if (delivered) return;
  const vibrate = typeof navigator !== 'undefined' ? navigator.vibrate : undefined;
  if (typeof vibrate === 'function') {
    try {
      vibrate.call(navigator, pulse.vibratePattern);
    } catch {
      // Blocked by a permissions policy or an engine that only pretends to support it.
    }
  }
}
