import { afterEach, describe, expect, it } from 'vitest';
import { MOUNT_KEYS } from '../src/sim/content/mounts';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
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
    expect(mountDisplayName('terrorspark_groundshaker')).toBe('骇雷撼地者');
    expect(t(MOUNT_DESC_KEYS.terrorspark_groundshaker)).toContain('重型履带');
  });

  it('pins the English identity and lore of the three authored mounts', () => {
    expect(
      ['mech_bird', 'lanternback_troll', 'chimeglass_tortoise'].map((key) => ({
        name: mountDisplayName(key),
        description: t(MOUNT_DESC_KEYS[key]),
      })),
    ).toEqual([
      {
        name: 'Cluckwork Mech Bird',
        description:
          'A hand-built clockwork war chicken that sprints on snapping servos, wind-up key still turning.',
      },
      {
        name: 'Grumbol the Lanternback',
        description:
          'A hill troll broken to the yoke by lamplighters, carrying an iron throne across his shoulders with a storm lantern burning on either arm.',
      },
      {
        name: 'Tolliver the Chimeglass',
        description:
          'A salt-flat tortoise who has outwalked three generations of caravans. Tinkers ground him spectacles from storm-glass and hung a bronze bell at his throat, so the road hears him long before it sees him.',
      },
    ]);
  });

  it('resolves the authored reins names through the runtime item-name path', () => {
    expect(
      ['reins_mech_bird', 'reins_lanternback_troll', 'reins_chimeglass_tortoise'].map((id) =>
        itemDisplayName(ITEMS[id]),
      ),
    ).toEqual([
      'Ignition Key: Cluckwork Mech Bird',
      "Lamplighter's Yoke: Grumbol",
      "Roadwarden's Bellstrap: Tolliver",
    ]);
  });

  it('pins the zh_CN names of the three authored mounts', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    expect(
      ['mech_bird', 'lanternback_troll', 'chimeglass_tortoise'].map((key) => mountDisplayName(key)),
    ).toEqual(['发条机械鸟', '提灯背者格伦博', '钟晶的托利弗']);
  });
});
