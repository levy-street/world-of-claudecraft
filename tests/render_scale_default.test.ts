// The Render Quality slider's boot default on weak integrated GPUs: the pure
// decision table (render_scale_default_core.ts), the thin boot applier
// (boot_graphics_defaults.ts), and the wiring that makes the default a DEFAULT
// (the slider commit stamps the touched flag, main.ts applies it once the
// preset is final, and nothing reads the FPS governor). The fairness contract
// it lives under: docs/design/graphics-settings-fairness.md.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyBootRenderScaleDefault,
  applyFirstRunGraphicsPreset,
} from '../src/game/boot_graphics_defaults';
import {
  bootRenderScaleDefault,
  inferRenderScaleTouched,
  WEAK_GPU_LOW_RENDER_SCALE,
} from '../src/game/render_scale_default_core';
import { BOOL_SETTINGS, SETTING_RANGES, Settings } from '../src/game/settings';
import { GFX_BUDGETS, PRESET_LOW, tierFromHints } from '../src/render/gfx';
import { stripComments } from './helpers/strip_comments';

const STOCK = SETTING_RANGES.renderScale.def;
const HD_530 = 'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0)';
const UHD_630 = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)';
const HD_4400 = 'ANGLE (Intel, Intel(R) HD Graphics 4400 Direct3D11 vs_5_0 ps_5_0)';
const IRIS_XE = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)';
const RADEON_IGPU = 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)';
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)';
const SWIFTSHADER = 'Google SwiftShader';
const PRESET_MEDIUM = PRESET_LOW + 1;

function installStorage(): void {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

function storedBlob(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('woc_settings') ?? '{}') as Record<string, unknown>;
}

const untouched = {
  weakGpu: true,
  lowPreset: true,
  renderScaleTouched: false,
  storedRenderScale: STOCK,
  stockRenderScale: STOCK,
};

describe('render_scale_default_core: the decision table', () => {
  it('pins the weak-GPU LOW default to the low preset desktop governor floor, inside the slider range', () => {
    expect(WEAK_GPU_LOW_RENDER_SCALE).toBe(0.65);
    // One number, not two: the value the low preset already declares acceptable
    // for the governor to render at. Re-derive both together if either moves.
    expect(WEAK_GPU_LOW_RENDER_SCALE).toBe(GFX_BUDGETS.low.minRenderScaleDesktop);
    expect(WEAK_GPU_LOW_RENDER_SCALE).toBeGreaterThanOrEqual(SETTING_RANGES.renderScale.min);
    expect(WEAK_GPU_LOW_RENDER_SCALE).toBeLessThan(SETTING_RANGES.renderScale.max);
    // A slider stop (the options slider steps by 0.05), so the readout is a real position.
    expect(Math.round(WEAK_GPU_LOW_RENDER_SCALE / 0.05) * 0.05).toBeCloseTo(
      WEAK_GPU_LOW_RENDER_SCALE,
      10,
    );
  });

  it('weak GPU + LOW + untouched slider => the weak default', () => {
    expect(bootRenderScaleDefault(untouched)).toBe(WEAK_GPU_LOW_RENDER_SCALE);
  });

  it('never overrides a touched slider, whatever the device', () => {
    expect(bootRenderScaleDefault({ ...untouched, renderScaleTouched: true })).toBeNull();
    expect(
      bootRenderScaleDefault({
        ...untouched,
        renderScaleTouched: true,
        storedRenderScale: 0.5,
      }),
    ).toBeNull();
    expect(
      bootRenderScaleDefault({
        ...untouched,
        renderScaleTouched: true,
        weakGpu: false,
        storedRenderScale: 0.75,
      }),
    ).toBeNull();
  });

  it('leaves every other machine and preset on the stock default', () => {
    expect(bootRenderScaleDefault({ ...untouched, weakGpu: false })).toBeNull();
    expect(bootRenderScaleDefault({ ...untouched, lowPreset: false })).toBeNull();
    expect(bootRenderScaleDefault({ ...untouched, weakGpu: false, lowPreset: false })).toBeNull();
  });

  it('returns null when the stored value already matches, so an ordinary boot writes nothing', () => {
    expect(
      bootRenderScaleDefault({ ...untouched, storedRenderScale: WEAK_GPU_LOW_RENDER_SCALE }),
    ).toBeNull();
  });

  it('gives an untouched slider the stock default back once the device class or preset no longer qualifies', () => {
    expect(
      bootRenderScaleDefault({
        ...untouched,
        lowPreset: false,
        storedRenderScale: WEAK_GPU_LOW_RENDER_SCALE,
      }),
    ).toBe(STOCK);
    expect(
      bootRenderScaleDefault({
        ...untouched,
        weakGpu: false,
        storedRenderScale: WEAK_GPU_LOW_RENDER_SCALE,
      }),
    ).toBe(STOCK);
  });

  it('infers the touched flag once for installs that predate it: only a non-stock stored value counts', () => {
    expect(inferRenderScaleTouched(0.75, STOCK)).toBe(true);
    expect(inferRenderScaleTouched(0.5, STOCK)).toBe(true);
    expect(inferRenderScaleTouched(STOCK, STOCK)).toBe(false);
    expect(inferRenderScaleTouched(undefined, STOCK)).toBe(false);
    expect(inferRenderScaleTouched('1', STOCK)).toBe(false);
  });
});

describe('boot_graphics_defaults: the applier over the live settings store', () => {
  beforeEach(() => {
    installStorage();
    localStorage.clear();
  });

  function bootWith(stored: Record<string, unknown>, gpu: string | undefined) {
    localStorage.setItem('woc_settings', JSON.stringify(stored));
    const settings = new Settings();
    const applied = applyBootRenderScaleDefault(settings, gpu);
    return { settings, applied };
  }

  it('re-defaults a fresh LOW install on each recognised weak Intel part, and persists it', () => {
    for (const gpu of [HD_530, UHD_630, HD_4400]) {
      localStorage.clear();
      const { settings, applied } = bootWith({ graphicsPreset: PRESET_LOW }, gpu);
      expect(applied).toBe(WEAK_GPU_LOW_RENDER_SCALE);
      expect(settings.get('renderScale')).toBe(WEAK_GPU_LOW_RENDER_SCALE);
      // The flag stays false: the game, not the player, chose this value.
      expect(settings.get('renderScaleTouched')).toBe(false);
      expect(storedBlob().renderScale).toBe(WEAK_GPU_LOW_RENDER_SCALE);
    }
  });

  it('leaves the mid integrated, discrete, software and masked adapters at the stock value', () => {
    for (const gpu of [IRIS_XE, RADEON_IGPU, RTX, SWIFTSHADER, undefined, '']) {
      localStorage.clear();
      const { settings, applied } = bootWith({ graphicsPreset: PRESET_LOW }, gpu);
      expect(applied).toBeNull();
      expect(settings.get('renderScale')).toBe(STOCK);
    }
  });

  it('applies only on the LOW preset', () => {
    const { settings, applied } = bootWith({ graphicsPreset: PRESET_MEDIUM }, HD_530);
    expect(applied).toBeNull();
    expect(settings.get('renderScale')).toBe(STOCK);
  });

  it('an existing install whose slider sits at the old default is re-defaulted exactly once', () => {
    // Pre-flag blob: renderScale 1.0 with no renderScaleTouched key.
    const first = bootWith({ graphicsPreset: PRESET_LOW, renderScale: STOCK }, HD_530);
    expect(first.applied).toBe(WEAK_GPU_LOW_RENDER_SCALE);
    expect(storedBlob().renderScaleTouched).toBe(false);
    // The player puts it back to 1.0 through the slider (the painter stamps the flag).
    first.settings.set('renderScaleTouched', true);
    first.settings.set('renderScale', STOCK);
    // Every later boot leaves that choice alone.
    const second = new Settings();
    expect(applyBootRenderScaleDefault(second, HD_530)).toBeNull();
    expect(second.get('renderScale')).toBe(STOCK);
  });

  it('an existing install whose slider was moved before the flag existed is never touched', () => {
    const { settings, applied } = bootWith(
      { graphicsPreset: PRESET_LOW, renderScale: 0.8 },
      HD_530,
    );
    expect(applied).toBeNull();
    expect(settings.get('renderScale')).toBe(0.8);
    expect(settings.get('renderScaleTouched')).toBe(true);
  });

  it('an untouched slider follows the preset: raising LOW to MEDIUM by hand restores the stock value at the next boot', () => {
    const first = bootWith({ graphicsPreset: PRESET_LOW }, HD_530);
    expect(first.settings.get('renderScale')).toBe(WEAK_GPU_LOW_RENDER_SCALE);
    first.settings.set('graphicsPreset', PRESET_MEDIUM);
    const second = new Settings();
    expect(applyBootRenderScaleDefault(second, HD_530)).toBe(STOCK);
    expect(second.get('renderScale')).toBe(STOCK);
  });

  it('Reset to Defaults on the slider clears the touched flag, so the device default returns at the next boot', () => {
    const first = bootWith({ graphicsPreset: PRESET_LOW }, HD_530);
    first.settings.set('renderScaleTouched', true);
    first.settings.set('renderScale', 0.9);
    first.settings.reset(['renderScale']);
    expect(first.settings.get('renderScale')).toBe(STOCK);
    expect(first.settings.get('renderScaleTouched')).toBe(false);
    const second = new Settings();
    expect(applyBootRenderScaleDefault(second, HD_530)).toBe(WEAK_GPU_LOW_RENDER_SCALE);
  });

  it('the moved first-run preset step still leaves an inconclusive (Node, no GPU) device unmarked', () => {
    const settings = new Settings();
    applyFirstRunGraphicsPreset(settings);
    expect(settings.get('graphicsPreset')).toBe(SETTING_RANGES.graphicsPreset.def);
    expect(settings.get('graphicsDefaultApplied')).toBe(false);
  });
});

describe('render scale default: wiring', () => {
  const read = (rel: string) =>
    stripComments(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));

  it('main.ts applies the default once the preset is final for the boot, before the renderer exists', () => {
    const main = read('src/main.ts');
    const firstRun = main.indexOf('applyFirstRunGraphicsPreset(settings);');
    const safe = main.indexOf('safeStartupGraphicsPreset(');
    const scale = main.indexOf('applyBootRenderScaleDefault(settings);');
    const renderer = main.indexOf('let renderer!: Renderer;');
    expect(firstRun).toBeGreaterThan(-1);
    expect(safe).toBeGreaterThan(firstRun);
    expect(scale).toBeGreaterThan(safe);
    expect(renderer).toBeGreaterThan(scale);
    // The old inline block is gone (module-first: main.ts is a firewall, not a home).
    expect(main).not.toContain('firstRunGraphicsPreset(settings.get(');
  });

  it('the applier keys on the ONE adapter classifier the preset detector uses', () => {
    const boot = read('src/game/boot_graphics_defaults.ts');
    expect(boot).toContain("classifyGpuRenderer(gpuRenderer) === 'weak'");
    expect(boot).not.toMatch(/isWeakIntegratedGpu|isSoftware|renderBudget|governor/i);
  });

  it('the core is a static decision table: no imports, no governor, no clock', () => {
    const core = read('src/game/render_scale_default_core.ts');
    expect(core).not.toMatch(/^\s*import\b/m);
    expect(core).not.toMatch(/governor|performance\.now|Date\.now|frameMs/i);
  });

  it('the Render Quality slider carries the touched flag and the painter stamps it on every commit', () => {
    const view = read('src/ui/options_view.ts');
    expect(view).toContain(
      "{ ...slider(s, 'renderScale', 'hud.options.renderQuality'), touchedFlag: 'renderScaleTouched' }",
    );
    const painter = read('src/ui/options_window.ts');
    const commit = painter.indexOf('const commit = () => {');
    expect(commit).toBeGreaterThan(-1);
    const body = painter.slice(commit, painter.indexOf('};', commit));
    expect(body).toContain(
      'if (c.touchedFlag) hooks.settings.set(c.touchedFlag as BoolSettingKey, true);',
    );
    expect(body).toContain('hooks.onSettingChange(key, sliderDispatchValue(slider.value));');
    // The stamp precedes the live apply, so a listener on the change already sees a touched slider.
    expect(body.indexOf('touchedFlag')).toBeLessThan(body.indexOf('onSettingChange'));
  });

  it('every touchedFlag a slider declares is a real bool setting, so the cast at the commit cannot miss', () => {
    const view = read('src/ui/options_view.ts');
    const flags = [...view.matchAll(/touchedFlag: '([^']+)'/g)].map((m) => m[1]);
    expect(flags).toEqual(['renderScaleTouched']);
    for (const flag of flags) expect(Object.keys(BOOL_SETTINGS)).toContain(flag);
  });

  it('the boot apply path in main.ts never stamps the flag (a restored value is not a choice)', () => {
    const main = read('src/main.ts');
    expect(main).not.toContain('renderScaleTouched');
  });
});
