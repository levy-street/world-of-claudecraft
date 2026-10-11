import { computeDropdownPlacement } from './dropdown_position';
import { FramePresets } from './frame_presets';
import { FRAME_PRESET_LIMIT } from './frame_presets_core';
import { formatNumber, t } from './i18n';
import type { InputDialogOpts } from './input_controller';
import { settingsCard } from './settings_controls';
import { getUiScale } from './ui_scale';

export interface FramePresetControlsDeps {
  inputDialog(opts: InputDialogOpts): void;
  confirmDialog(title: string, body: string, ok: string, cancel: string, onOk: () => void): void;
  applyFramePreset(): void;
}

/** Talent-style named loadouts, retained in the Interface panel only. */
export function renderFramePresets(
  parent: HTMLElement,
  deps?: FramePresetControlsDeps,
  applied?: () => void,
): () => void {
  const card = settingsCard(parent, t('hudChrome.framePresets.title'));
  card.classList.add('frame-preset-loadouts');
  const row = document.createElement('div');
  row.className = 'tal-foot';
  const anchor = document.createElement('div');
  anchor.className = 'frame-preset-picker';
  const actions = document.createElement('div');
  actions.className = 'frame-preset-actions';
  const picker = document.createElement('button');
  picker.type = 'button';
  picker.className = 'tal-loadout-btn ui-btn';
  picker.setAttribute('aria-haspopup', 'menu');
  picker.setAttribute('aria-expanded', 'false');
  const name = document.createElement('span');
  name.className = 'tal-loadout-name';
  const caret = document.createElement('span');
  caret.className = 'tal-loadout-caret';
  caret.setAttribute('aria-hidden', 'true');
  picker.append(name, caret);
  const status = document.createElement('div');
  status.className = 'set-note';
  status.setAttribute('role', 'status');
  let store: FramePresets | null = null;
  try {
    store = new FramePresets(localStorage);
  } catch {
    status.textContent = t('hudChrome.framePresets.failed');
  }
  let selected = store?.active() ?? -1;
  let menu: HTMLElement | null = null;
  let dismiss: AbortController | null = null;
  const close = (focus = false) => {
    menu?.remove();
    menu = null;
    dismiss?.abort();
    dismiss = null;
    picker.setAttribute('aria-expanded', 'false');
    if (focus) picker.focus({ preventScroll: true });
  };
  const refresh = () => {
    const slots = store?.list();
    const active = selected;
    name.textContent = slots?.[active]?.name ?? t('hudChrome.framePresets.current');
    picker.setAttribute(
      'aria-label',
      t('hudChrome.framePresets.pickerLabel', { name: name.textContent }),
    );
    picker.disabled = !store || !deps;
    for (const button of [applyButton, save, add, remove, importButton, exportButton])
      button.disabled = picker.disabled;
    add.disabled ||= (slots?.filter(Boolean).length ?? 0) >= FRAME_PRESET_LIMIT;
    save.disabled ||= active < 0 && !!slots?.every(Boolean);
    importButton.disabled ||= (slots?.filter(Boolean).length ?? 0) >= FRAME_PRESET_LIMIT;
    exportButton.disabled ||= active < 0;
    applyButton.disabled ||= active < 0;
    remove.disabled ||= active < 0;
    remove.setAttribute(
      'aria-label',
      slots?.[active]
        ? t('hudChrome.framePresets.deleteNamed', { name: slots[active]!.name })
        : t('hudChrome.framePresets.remove'),
    );
  };
  const result = (ok: boolean) => {
    status.textContent = t(ok ? 'hudChrome.framePresets.saved' : 'hudChrome.framePresets.failed');
    refresh();
  };
  const promptNew = () => {
    const index = store?.list().findIndex((slot) => !slot) ?? -1;
    if (index < 0) return;
    close(true);
    deps?.inputDialog({
      title: t('hudChrome.framePresets.new'),
      label: t('hudChrome.framePresets.name'),
      value: t('hudChrome.framePresets.slot', { slot: formatNumber(index + 1) }),
      selectText: true,
      okText: t('game.talents.save'),
      onOk: (value) => {
        if (value.trim()) {
          const saved = store?.save(index, value) ?? false;
          if (saved) selected = index;
          result(saved);
        }
      },
    });
  };
  const saveCurrent = () => {
    close(true);
    const active = selected;
    const preset = store?.list()[active];
    if (!preset) return promptNew();
    const saveSelected = () => result(store?.save(active, preset.name) ?? false);
    if (active === store?.active()) saveSelected();
    else
      deps?.confirmDialog(
        t('hudChrome.framePresets.overwrite'),
        t('hudChrome.framePresets.overwriteBody', { name: preset.name }),
        t('game.talents.save'),
        t('game.talents.cancel'),
        saveSelected,
      );
  };
  const action = (id: string, label: string, run: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-btn';
    button.dataset.presetAction = id;
    button.textContent = label;
    button.addEventListener('click', run);
    actions.append(button);
    return button;
  };
  const applyButton = action('apply', t('hudChrome.framePresets.apply'), () => {
    close(true);
    if (!store?.apply(selected)) {
      result(false);
      return;
    }
    const owner = card.closest('#options-menu') ?? parent;
    deps?.applyFramePreset();
    result(true);
    applied?.();
    owner
      .querySelector<HTMLButtonElement>('[data-preset-action="apply"]')
      ?.focus({ preventScroll: true });
  });
  const save = action('save', t('game.talents.save'), saveCurrent);
  const add = action('new', t('hudChrome.framePresets.new'), promptNew);
  add.classList.add('ui-btn--gold');
  const remove = action('delete', t('hudChrome.framePresets.remove'), () => {
    close(true);
    const index = selected;
    const preset = store?.list()[index];
    if (!preset) return;
    deps?.confirmDialog(
      t('hudChrome.framePresets.remove'),
      t('hudChrome.framePresets.deleteBody', { name: preset.name }),
      t('hudChrome.framePresets.remove'),
      t('game.talents.cancel'),
      () => {
        const removed = store?.remove(index) ?? false;
        if (removed) selected = -1;
        result(removed);
      },
    );
  });
  const importButton = action('import', t('game.talents.import'), () => {
    close(true);
    deps?.inputDialog({
      title: t('hudChrome.transfer.importAction'),
      label: t('hudChrome.framePresets.title'),
      placeholder: t('hudChrome.transfer.pastePlaceholder'),
      multiline: true,
      okText: t('game.talents.import'),
      onOk: (value) => {
        const imported = store?.import(value) ?? null;
        if (imported === null) {
          status.textContent = t('hudChrome.transfer.invalid');
          return;
        }
        selected = imported;
        result(true);
      },
    });
  });
  const exportButton = action('export', t('game.talents.export'), () => {
    close(true);
    deps?.inputDialog({
      title: t('hudChrome.transfer.exportAction'),
      label: t('hudChrome.framePresets.title'),
      value: store?.export(selected) ?? '',
      multiline: true,
      readOnly: true,
      copy: true,
      cancelText: t('game.talents.close'),
    });
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !menu) {
      event.preventDefault();
      picker.click();
    }
  });
  picker.addEventListener('click', (event) => {
    // This click owns the menu focus; the game must not park it on the dialog root.
    event.stopPropagation();
    if (menu) {
      close(true);
      return;
    }
    menu = document.createElement('div');
    menu.className = 'tal-loadout-menu ui-card';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('hudChrome.framePresets.title'));
    const slots = store?.list() ?? [];
    const active = selected;
    const item = (label: string, run: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tal-lo-item ui-btn';
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.addEventListener('click', run);
      return button;
    };
    if (!slots.some(Boolean)) {
      const empty = document.createElement('div');
      empty.className = 'tal-lo-empty';
      empty.textContent = t('hudChrome.framePresets.empty');
      menu.append(empty);
    }
    slots.forEach((preset, index) => {
      if (!preset) return;
      const entry = document.createElement('div');
      entry.className = `tal-lo-row${index === active ? ' active' : ''}`;
      const pick = item(preset.name, () => {
        close(true);
        selected = index;
        status.textContent = '';
        refresh();
      });
      pick.classList.add('tal-lo-pick');
      pick.setAttribute('role', 'menuitemradio');
      pick.setAttribute('aria-checked', String(index === active));
      entry.append(pick);
      menu!.append(entry);
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    anchor.append(menu);
    const trigger = anchor.getBoundingClientRect();
    const scroller = card.closest('.ui-win-body');
    const clip = scroller?.getBoundingClientRect();
    const scale = card.closest('#ui') ? getUiScale() : 1;
    const placement = computeDropdownPlacement({
      triggerTop: trigger.top,
      triggerBottom: trigger.bottom,
      containerTop: Math.max(0, clip?.top ?? 0),
      containerBottom: Math.min(window.innerHeight, clip?.bottom ?? window.innerHeight),
      preferredMaxHeight: window.innerHeight * 0.35,
      gap: 6 * scale,
      minHeight: 0,
    });
    menu.style.top = placement.side === 'below' ? 'calc(100% + 6px)' : 'auto';
    menu.style.bottom = placement.side === 'above' ? 'calc(100% + 6px)' : 'auto';
    menu.style.maxHeight = `${placement.maxHeight / scale}px`;
    picker.setAttribute('aria-expanded', 'true');
    dismiss = new AbortController();
    scroller?.addEventListener('scroll', () => close(), { signal: dismiss.signal });
    window.addEventListener('resize', () => close(), { signal: dismiss.signal });
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!card.contains(event.target as Node)) close();
      },
      { capture: true, signal: dismiss.signal },
    );
    menu.addEventListener('keydown', (event) => {
      const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      let index = current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key === 'ArrowDown') index = (current + 1) % buttons.length;
      else if (event.key === 'ArrowUp') index = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      buttons[index]?.focus({ preventScroll: true });
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  });
  card.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !card.contains(event.relatedTarget as Node)) close();
  });
  anchor.append(picker);
  row.append(anchor, actions);
  card.append(row, status);
  refresh();
  return () => close();
}
