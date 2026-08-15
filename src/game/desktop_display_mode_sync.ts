// The desktop shell's window display mode, seen from the renderer.
//
// A desktop window is either borderless fullscreen (the shipped default) or a
// normal resizable window, and ONLY the shell can change that: the browser
// Fullscreen API would open a second fullscreen layer inside a window the OS
// already owns fullscreen, and the two fight over the monitor. This module owns
// the renderer half of the contract: whether the installed shell exposes the
// mode at all, and reflecting the STORED mode into the local setting so the
// options row reads what the window is actually doing.
//
// The two sides speak different types on purpose: the options panel's choice
// control is numeric (displayMode, 1 = borderless, 0 = windowed) and the shell
// prefs store holds the string union. BOTH crossings live here, one mapping
// each (the boot read below and the options write push), so main.ts stays a
// thin consumer and a Vitest can pin either direction without a DOM or a live
// shell.
//
// Lives in src/game so main.ts stays a firewall (composition only), beside the
// other bridge consumers (desktop_gpu_pref_sync.ts, desktop_presentation.ts).

import type { DesktopBridge, DesktopDisplayMode } from '../runtime';

/** The minimal settings writer this module needs (the live Settings store). */
export interface DesktopDisplayModeSettings {
  set(key: 'displayMode', value: number): number;
}

/**
 * True when the installed shell exposes BOTH halves of the mode. The options
 * row is gated on this, never on isNativeAppShell(): that flag is also true in
 * the mobile Capacitor shells, and a desktop shell installed before display
 * modes shipped exposes neither method, so the row would be dead there while
 * its browser-fullscreen predecessor was the thing that actually worked.
 */
export function desktopDisplayModeSupported(bridge: DesktopBridge | null | undefined): boolean {
  return (
    typeof bridge?.getDisplayMode === 'function' && typeof bridge?.setDisplayMode === 'function'
  );
}

/**
 * Push a player's choice to the shell, which owns the window. Fire and forget
 * by design (the shell resizes the window itself and nothing in the running
 * frame loop waits on the answer) and total: an older shell without the setter,
 * a dead IPC channel that throws synchronously, and a rejected write all leave
 * the options window undisturbed rather than throwing out of a click handler.
 */
export function pushDesktopDisplayMode(
  bridge: DesktopBridge | null | undefined,
  mode: DesktopDisplayMode,
): void {
  const write = bridge?.setDisplayMode;
  if (typeof write !== 'function') return;
  try {
    // Promise.resolve also covers a shell that answers synchronously; without
    // the catch a rejected write would surface as an unhandled rejection.
    void Promise.resolve(write.call(bridge, mode)).catch(() => {});
  } catch {
    /* the shell's channel is gone; the stored setting is still the player's */
  }
}

/**
 * Reflect the shell's stored display mode into the local setting at boot, so
 * the options row reads the real window state rather than a local guess (the
 * shell restores the mode before the renderer exists, and a player can also
 * leave fullscreen through the OS).
 *
 * Writes settings.set DIRECTLY and deliberately NOT through the options
 * onSettingChange path: that arm pushes the value back to the shell, so routing
 * the reflection through it would echo the shell's own mode straight back at
 * it, resizing the window during boot. Absent method (older shell or plain
 * browser), a rejected read, or an answer outside the union all write nothing
 * and leave the stored value alone.
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
export async function syncDesktopDisplayModeSetting(
  bridge: DesktopBridge | null | undefined,
  createSettings: () => DesktopDisplayModeSettings,
): Promise<void> {
  const read = bridge?.getDisplayMode;
  if (typeof read !== 'function') return;
  let mode: unknown;
  try {
    mode = await read.call(bridge);
  } catch {
    // The shell is an independently updated binary: a failed read must leave
    // the stored setting untouched rather than assert a default over it.
    return;
  }
  // Checked against the union members themselves, not coerced: an unknown mode
  // string from a newer shell must not collapse into "windowed" and shrink the
  // window on the next options interaction.
  if (mode !== 'borderless' && mode !== 'windowed') return;
  createSettings().set('displayMode', mode === 'borderless' ? 1 : 0);
}
