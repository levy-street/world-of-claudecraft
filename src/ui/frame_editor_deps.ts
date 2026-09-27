import {
  type BoolSettingKey,
  type NumericSettingKey,
  SETTING_RANGES,
  type Settings,
} from '../game/settings';
import type { FrameContextTarget } from './frame_context_menu';
import { t } from './i18n';
import type { InterfaceUnlockDeps } from './interface_unlock';
import {
  buildFramesMenuToggles,
  FRAME_SIZE_RESET_KEYS,
  type FramesMenuSettingsHooks,
} from './interface_unlock_menu_core';
import { buildInterfaceControls, type OptionsControl } from './options_view';

export function frameEditorMenuDeps(
  options: () => (Omit<FramesMenuSettingsHooks, 'settings'> & { settings: Settings }) | null,
  openFrameOptions: (id: string) => void,
  contextTargets?: () => readonly FrameContextTarget[],
): Partial<InterfaceUnlockDeps> {
  const controls = (): OptionsControl[] => {
    const hooks = options();
    return hooks
      ? buildInterfaceControls({
          num: (key) => hooks.settings.get(key as NumericSettingKey),
          bool: (key) => hooks.settings.get(key as BoolSettingKey),
          range: (key) => SETTING_RANGES[key as NumericSettingKey],
        }).filter(
          (row) => row.category === 'frames' && !('key' in row && row.key.startsWith('partyFrame')),
        )
      : [];
  };
  return {
    lockAllLabel: () => t('hudChrome.interfaceUnlock.lockAll'),
    lockAllTitle: () => t('hudChrome.interfaceUnlock.frozenNote'),
    framesMenuLabel: () => t('hudChrome.interfaceUnlock.framesMenu'),
    framesMenuTitle: () => t('hudChrome.interfaceUnlock.framesMenuTitle'),
    framesSubmenuLabel: () => t('hudChrome.interfaceUnlock.showHideFrames'),
    settingToggles: () => {
      const hooks = options();
      if (!hooks) return [];
      return [
        ...buildFramesMenuToggles(hooks, !!hooks.settings.get('combineActionBars')),
        ...controls()
          .filter((row) => row.control === 'boolToggle')
          .flatMap((row) =>
            row.control === 'boolToggle'
              ? [
                  {
                    id: row.key,
                    label: t(row.labelKey),
                    value: row.on,
                    set: (value: boolean) =>
                      hooks.onSettingChange(
                        row.key,
                        hooks.settings.set(row.key as BoolSettingKey, value),
                      ),
                  },
                ]
              : [],
          ),
      ];
    },
    settingSelects: () => {
      const hooks = options();
      if (!hooks) return [];
      return [
        ...controls()
          .filter((row) => row.control === 'choice')
          .flatMap((row) =>
            row.control === 'choice'
              ? [
                  {
                    id: row.key,
                    label: t(row.labelKey),
                    value: row.current,
                    options: row.options.map((choice) => ({
                      value: choice.value,
                      label: t(choice.labelKey),
                    })),
                    set: (value: number) =>
                      hooks.onSettingChange(
                        row.key,
                        hooks.settings.set(row.key as NumericSettingKey, value),
                      ),
                  },
                ]
              : [],
          ),
      ];
    },
    snapGridActive: () => !!options()?.settings.get('frameSnapToGrid'),
    resetSizeLabel: () => t('hudChrome.interfaceUnlock.resetFrameSize'),
    resetSizeLabelFor: (name) => t('hudChrome.interfaceUnlock.resetFrameSizeFor', { name }),
    onSizeReset: (id) => {
      const hooks = options();
      const keys = FRAME_SIZE_RESET_KEYS[id] as readonly NumericSettingKey[] | undefined;
      if (!hooks || !keys) return;
      hooks.settings.reset([...keys]);
      for (const key of keys) hooks.onSettingChange(key, hooks.settings.get(key));
    },
    openFrameOptions,
    contextTargets,
  };
}

/** Chat owns its geometry, but shares the editor's context actions. */
export function chatFrameContextTargets(
  doc: Document,
  resetSize: () => void,
  isActive: () => boolean,
): FrameContextTarget[] {
  const element = doc.getElementById('chatlog-wrap');
  if (!element) return [];
  const visibility = {
    value: () => !element.classList.contains('frame-user-hidden'),
    set: (visible: boolean) => {
      element.classList.toggle('frame-user-hidden', !visible);
      try {
        if (visible) doc.defaultView?.localStorage.removeItem('woc_chat_frame_hidden');
        else doc.defaultView?.localStorage.setItem('woc_chat_frame_hidden', '1');
      } catch {
        /* unavailable storage */
      }
    },
  };
  return [
    {
      id: 'chat',
      element,
      label: () => t('hudChrome.interfaceTabs.chat'),
      isActive,
      resetSize,
      visibility,
      hide: () => visibility.set(false),
    },
  ];
}
