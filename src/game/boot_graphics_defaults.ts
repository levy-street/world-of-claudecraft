// The boot-time graphics defaults main.ts persists into the settings store
// before the renderer reads it: the first-run device preset, and the render
// scale an untouched Render Quality slider boots at. Both are decided ONCE per
// boot from static hints (the adapter string, the stored preset), never from
// the FPS governor. Thin host glue over the pure cores; the decision tables live
// in gfx.ts (resolveDefaultGraphicsPreset) and render_scale_default_core.ts.

import { activeGpuRendererName, classifyGpuRenderer, firstRunGraphicsPreset } from '../render/gfx';
import { bootRenderScaleDefault } from './render_scale_default_core';
import { SETTING_RANGES, type Settings } from './settings';

/** Mirrors gfx.ts PRESET_LOW (1 low, 2 medium, 3 high, 4 ultra, 5 advanced, 6 insane);
 *  tests/render_scale_default.test.ts pins the mirror through tierFromHints. */
export const GRAPHICS_PRESET_LOW = 1;

/**
 * First-run graphics default: until a device default has been applied (the
 * dedicated graphicsDefaultApplied marker, NOT the graphicsPreset key, which
 * save() def-fills the moment any unrelated setting is stored), probe the device
 * (GPU name, memory, cores, touch) and PERSIST a device-appropriate preset over
 * the medium default, so the 3D tier, the data-fx-level cadence (nameplates),
 * and the options UI all agree. A masked or inconclusive device resolves to
 * medium and returns null, so it stays on the medium default and re-detects
 * next boot; only a CONCLUSIVE result is persisted and marked. An explicit
 * player choice is never overridden: a recognized device is marked applied on
 * its first boot so it never re-detects, and an inconclusive device returns
 * null so it never overwrites a stored preset.
 */
export function applyFirstRunGraphicsPreset(settings: Settings): void {
  const autoPreset = firstRunGraphicsPreset(settings.get('graphicsDefaultApplied'));
  if (autoPreset === null) return;
  settings.set('graphicsPreset', autoPreset);
  settings.set('graphicsDefaultApplied', true);
}

/**
 * The Render Quality slider's boot default (render_scale_default_core.ts):
 * called AFTER the preset is final for this boot (first-run detection and the
 * iOS startup cap both included), keyed on the SAME adapter classifier the
 * preset detector uses, so one classifier decides both. Returns the persisted
 * value, or null when the stored one was left alone.
 */
export function applyBootRenderScaleDefault(
  settings: Settings,
  gpuRenderer: string | undefined = activeGpuRendererName(),
): number | null {
  const next = bootRenderScaleDefault({
    weakGpu: classifyGpuRenderer(gpuRenderer) === 'weak',
    lowPreset: settings.get('graphicsPreset') === GRAPHICS_PRESET_LOW,
    renderScaleTouched: settings.get('renderScaleTouched'),
    storedRenderScale: settings.get('renderScale'),
    stockRenderScale: SETTING_RANGES.renderScale.def,
  });
  if (next === null) return null;
  return settings.set('renderScale', next);
}
