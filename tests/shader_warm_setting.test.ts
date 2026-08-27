// The player's shader warm-up option (src/game/shader_warm_setting.ts): the
// stored number to the client's setting, and the registration the client
// reads at its first policy call.

import { afterEach, describe, expect, it } from 'vitest';
import {
  registerShaderWarmSetting,
  SHADER_WARM_SETTING_VALUES,
  shaderWarmSettingFromValue,
} from '../src/game/shader_warm_setting';
import {
  resetShaderWarmForTest,
  setShaderWarmStoredSettingSource,
  shaderWarmDecide,
  shaderWarmSnapshot,
} from '../src/render/shader_warm_client';

afterEach(() => {
  setShaderWarmStoredSettingSource(() => null);
  resetShaderWarmForTest();
});

describe('shaderWarmSettingFromValue', () => {
  it('maps the three stored numbers, nearest wins, anything else is auto', () => {
    expect(shaderWarmSettingFromValue(SHADER_WARM_SETTING_VALUES.auto)).toBe('auto');
    expect(shaderWarmSettingFromValue(SHADER_WARM_SETTING_VALUES.off)).toBe('off');
    expect(shaderWarmSettingFromValue(SHADER_WARM_SETTING_VALUES.on)).toBe('reveal');
    expect(shaderWarmSettingFromValue(1.4)).toBe('off');
    expect(shaderWarmSettingFromValue(7)).toBe('auto');
    expect(shaderWarmSettingFromValue(Number.NaN)).toBe('auto');
  });

  it('never yields the probe-only all mode', () => {
    for (let value = -2; value <= 6; value += 0.5) {
      expect(shaderWarmSettingFromValue(value)).not.toBe('all');
    }
  });
});

describe('registerShaderWarmSetting', () => {
  it('hands the client the stored option, read at configure time', () => {
    let stored: number = SHADER_WARM_SETTING_VALUES.off;
    registerShaderWarmSetting(() => stored);
    resetShaderWarmForTest({ search: '' });
    expect(shaderWarmSnapshot().setting).toBe('off');
    stored = SHADER_WARM_SETTING_VALUES.on;
    resetShaderWarmForTest({ search: '' });
    expect(shaderWarmSnapshot().setting).toBe('reveal');
  });

  it('lets a probe query pin an arm over the stored option', () => {
    registerShaderWarmSetting(() => SHADER_WARM_SETTING_VALUES.off);
    resetShaderWarmForTest({ search: '?shaderwarm=all' });
    expect(shaderWarmSnapshot().setting).toBe('all');
  });

  it('reads the store once per configure, not per policy call', () => {
    let reads = 0;
    registerShaderWarmSetting(() => {
      reads++;
      return SHADER_WARM_SETTING_VALUES.off;
    });
    resetShaderWarmForTest({ search: '' });
    const context = { getContextAttributes: () => null, getExtension: () => null };
    for (let i = 0; i < 5; i++) shaderWarmDecide(context, 0, false);
    expect(reads).toBe(1);
    expect(shaderWarmSnapshot().mode).toBe('off');
  });

  it('answers OFF when the store throws, like an entry that never registered one', () => {
    registerShaderWarmSetting(() => {
      throw new Error('no store yet');
    });
    resetShaderWarmForTest({ search: '' });
    expect(shaderWarmSnapshot().setting).toBe('off');
  });
});
