import { afterEach, describe, expect, it } from 'vitest';
import { MOUNT_KEYS } from '../src/sim/content/mounts';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { MOUNT_DESC_KEYS, MOUNT_NAME_KEYS, mountDisplayName } from '../src/ui/mount_labels';

afterEach(() => setLanguage('en'));

describe('mount label maps', () => {
  it('cover every mount key and nothing else', () => {
    expect(Object.keys(MOUNT_NAME_KEYS).sort()).toEqual([...MOUNT_KEYS].sort());
    expect(Object.keys(MOUNT_DESC_KEYS).sort()).toEqual([...MOUNT_KEYS].sort());
  });

  it('resolves the tank name and description through a non-English locale', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    expect(mountDisplayName('terrorspark_groundshaker')).toBe('惊雷撼地者');
    expect(t(MOUNT_DESC_KEYS.terrorspark_groundshaker)).toContain('重型履带');
  });
});
