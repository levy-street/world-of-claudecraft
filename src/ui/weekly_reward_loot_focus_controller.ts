import { talentsFor } from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';
import type { IWorld } from '../world_api';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { t } from './i18n';
import { roleLabel, tTalent } from './talent_i18n';

export function weeklyLootSpecLabel(cls: PlayerClass, id?: string): string {
  const spec = talentsFor(cls)?.specs.find((entry) => entry.id === id);
  if (!spec) return t('hudChrome.weeklyRewards.allClassGear');
  const mixed = (cls === 'druid' && id === 'feral') || (cls === 'shaman' && id === 'enhancement');
  const role = mixed
    ? t('hudChrome.weeklyRewards.mixedRole', {
        first: roleLabel('dps'),
        second: roleLabel('tank'),
      })
    : roleLabel(spec.role);
  return t('hudChrome.weeklyRewards.specRole', {
    name: tTalent({ kind: 'talentSpec', spec, field: 'name' }),
    role,
  });
}

/** The host rebuilds on the acknowledged ledger; the server owns the preference. */
export function appendWeeklyLootFocus(host: HTMLElement, world: IWorld): void {
  const field = document.createElement('div');
  field.className = 'weekly-loot-focus';
  const label = document.createElement('label');
  label.htmlFor = 'weekly-loot-focus';
  label.textContent = t('hudChrome.weeklyRewards.lootFocus');
  const select = document.createElement('select');
  select.id = 'weekly-loot-focus';
  select.className = 'ui-input';
  select.setAttribute(FOCUS_KEY_ATTR, 'weekly-loot-focus');
  select.setAttribute('aria-describedby', 'weekly-loot-focus-help');
  for (const id of [
    undefined,
    ...(talentsFor(world.cfg.playerClass)?.specs.map((spec) => spec.id) ?? []),
  ]) {
    const option = document.createElement('option');
    option.value = id ?? '';
    option.textContent = weeklyLootSpecLabel(world.cfg.playerClass, id);
    select.append(option);
  }
  select.value = world.weeklyRewardInfo?.state.lootSpec ?? '';
  select.addEventListener('change', () => world.setWeeklyLootSpec(select.value || null));
  const help = document.createElement('span');
  help.id = 'weekly-loot-focus-help';
  help.className = 'weekly-loot-focus-help ui-muted';
  help.textContent = t('hudChrome.weeklyRewards.lootFocusHelp');
  field.append(label, select, help);
  host.append(field);
}
