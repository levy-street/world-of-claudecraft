// The desktop shell's GPU preference, seen from the renderer.
//
// The Electron shell asks the OS for the dedicated gaming GPU at launch. A
// MUXless laptop panel cannot always drive that adapter, so the shell prefs
// store keeps an opt-out that applies on the NEXT launch. This module owns the
// renderer half of that contract: whether the installed shell exposes the
// preference at all, and reflecting the STORED value into the local setting so
// the options row shows what the next launch will do.
//
// The renderer setting (forceHighPerfGpu, default true) and the shell store
// field (gpuForceOptOut, default false) are INVERSES: forcing the GPU on means
// opting out is off. BOTH crossings live here, one inversion each (the boot
// read below and the options write push), so main.ts stays a thin consumer and
// a Vitest can pin either polarity without a DOM or a live shell.
//
// Lives in src/game so main.ts stays a firewall (composition only), beside the
// other bridge consumers (desktop_gpu_status.ts, desktop_presentation.ts).

import type { DesktopBridge } from '../runtime';

/** The minimal settings writer this module needs (the live Settings store). */
export interface DesktopGpuPrefSettings {
  set(key: 'forceHighPerfGpu', value: boolean): boolean;
}

/**
 * True when the installed shell exposes BOTH halves of the preference. The
 * options row is gated on this, never on isNativeAppShell(): that flag is also
 * true in the mobile Capacitor shells, and a desktop shell installed before the
 * preference shipped exposes neither method, so the row would be dead there.
 */
export function desktopGpuPrefSupported(bridge: DesktopBridge | null | undefined): boolean {
  return (
    typeof bridge?.getGpuForceOptOut === 'function' &&
    typeof bridge?.setGpuForceOptOut === 'function'
  );
}

/**
 * Push a player's choice to the shell store, inverting once: the row reads
 * "force the dedicated GPU", the shell stores the opt-out. Fire and forget by
 * design, since the shell applies it at the NEXT launch and nothing in the
 * running session depends on the answer, and total: an older shell without the
 * setter, a dead IPC channel that throws synchronously, and a rejected write
 * all leave the options window undisturbed.
 */
export function pushDesktopGpuPref(
  bridge: DesktopBridge | null | undefined,
  forceHighPerfGpu: boolean,
): void {
  const write = bridge?.setGpuForceOptOut;
  if (typeof write !== 'function') return;
  try {
    // Promise.resolve also covers a shell that answers synchronously; without
    // the catch a rejected write would surface as an unhandled rejection.
    void Promise.resolve(write.call(bridge, !forceHighPerfGpu)).catch(() => {});
  } catch {
    /* the shell's channel is gone; the stored setting is still the player's */
  }
}

/**
 * Reflect the shell's stored GPU preference into the local setting at boot, so
 * the options row reads what the next launch will do rather than a local guess.
 *
 * Writes settings.set DIRECTLY and deliberately NOT through the options
 * onSettingChange path: that arm pushes the value back to the shell, so routing
 * the reflection through it would echo the shell's own value straight back at
 * it. Absent method (older shell or plain browser), a rejected read, or a
 * non-boolean answer all write nothing and leave the stored value alone.
 *
 * Takes a settings FACTORY, not a store: Settings snapshots localStorage in its
 * constructor and save() rewrites the whole blob, so a store built before the
 * bridge round trip would revert every write that landed during it (the
 * first-run graphics preset, the entry-crash safe-preset step-down). Building
 * it after the read shrinks that window to a single microtask. The caller's
 * half of the contract: once a LONG-LIVED store exists (startGame's), the
 * factory must answer with that instance, or its next unrelated whole-blob
 * save() reverts a reflection that resolved after it was built (main.ts
 * settingsForShellReflection; the fast-entry boot race).
 */
export async function syncDesktopGpuPrefSetting(
  bridge: DesktopBridge | null | undefined,
  createSettings: () => DesktopGpuPrefSettings,
): Promise<void> {
  const read = bridge?.getGpuForceOptOut;
  if (typeof read !== 'function') return;
  let optOut: unknown;
  try {
    optOut = await read.call(bridge);
  } catch {
    // The shell is an independently updated binary: a failed read must leave
    // the stored setting untouched rather than assert a default over it.
    return;
  }
  if (typeof optOut !== 'boolean') return;
  createSettings().set('forceHighPerfGpu', !optOut);
}
