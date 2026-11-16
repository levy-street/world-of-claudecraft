// What the automatic Frame Rate Limit learned last session, so a weak machine
// does not rediscover it at every login. Keyed by what would make it wrong: the
// build's verdict epoch (FRAME_CADENCE_AUTO_EPOCH), the graphics preset and the
// display's refresh class. The preset is only ever a
// KEY here, an invalidation: it never decides a ceiling (the fairness guard,
// tests/frame_cadence_fairness.test.ts, keeps the deciding modules blind to
// it). The render scale rides the settings signature below for the same reason:
// a change to either is the player's own act, and re-opens the question.

import type { FrameCadenceAutoRecord } from './frame_cadence_auto_core';
import { Settings } from './settings';

const AUTO_MEMORY_KEY = 'woc_frame_cadence_auto';

export interface FrameCadenceAutoMemory {
  load: (refreshHz: number) => FrameCadenceAutoRecord | null;
  save: (refreshHz: number, record: FrameCadenceAutoRecord) => void;
  clear: () => void;
  /** An opaque reading of the settings a verdict was formed on: the wiring
   *  compares two of them and never looks inside. */
  settingsSignature: () => string;
}

/** The build's verdict epoch, the first part of the key. A verdict says what
 *  this device held on the build that formed it, so a release that changes what
 *  a device can hold (a frame-time or preparation fix) bumps it: every stored
 *  verdict then misses once and the automatic limit judges the device again on
 *  the new build. Without it, a phone capped at 30 before the fix starts capped
 *  after it, and the limit only probes a faster rate after a long clean
 *  stretch. Keys from before the epoch existed (`preset|refresh`) never match. */
export const FRAME_CADENCE_AUTO_EPOCH = 1;

export function frameCadenceAutoMemoryKey(preset: number, refreshHz: number): string {
  return `e${FRAME_CADENCE_AUTO_EPOCH}|${preset}|${Math.round(refreshHz / 5) * 5}`;
}

function currentKey(refreshHz: number): string {
  let preset = -1;
  try {
    preset = new Settings().get('graphicsPreset');
  } catch {
    preset = -1;
  }
  return frameCadenceAutoMemoryKey(preset, refreshHz);
}

/** A stored record read back. One written before the verdict carried a
 *  confirmation (no `v`) is a settled ceiling: it loads as confirmed. */
export function parseFrameCadenceAutoRecord(
  raw: unknown,
  key: string,
): FrameCadenceAutoRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    v?: unknown;
    key?: unknown;
    ceiling?: unknown;
    confirmed?: unknown;
    failStreak?: unknown;
  };
  if (r.key !== key) return null;
  if (r.ceiling !== 30 && r.ceiling !== 60 && r.ceiling !== 0) return null;
  const streak = r.failStreak;
  return {
    ceiling: r.ceiling,
    confirmed: r.v === 2 ? r.confirmed === true : true,
    failStreak:
      r.v === 2 && typeof streak === 'number' && Number.isFinite(streak)
        ? Math.max(0, Math.min(16, Math.floor(streak)))
        : 0,
  };
}

export const localFrameCadenceAutoMemory: FrameCadenceAutoMemory = {
  load: (refreshHz) => {
    try {
      return parseFrameCadenceAutoRecord(
        JSON.parse(localStorage.getItem(AUTO_MEMORY_KEY) ?? 'null'),
        currentKey(refreshHz),
      );
    } catch {
      return null;
    }
  },
  save: (refreshHz, record) => {
    try {
      localStorage.setItem(
        AUTO_MEMORY_KEY,
        JSON.stringify({
          v: 2,
          key: currentKey(refreshHz),
          ceiling: record.ceiling,
          confirmed: record.confirmed,
          failStreak: record.failStreak,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(AUTO_MEMORY_KEY);
    } catch {
      /* storage unavailable */
    }
  },
  settingsSignature: () => {
    try {
      const settings = new Settings();
      return `${settings.get('graphicsPreset')}|${settings.get('renderScale')}`;
    } catch {
      return '';
    }
  },
};
